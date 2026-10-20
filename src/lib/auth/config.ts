import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { audit, getClientInfo } from "@/lib/audit";
import { estaBloqueado, registrarFallo, limpiar, CONFIG_LOGIN_IP } from "./rate-limit";
import type { UserRole, AlcanceDatos } from "@prisma/client";
import { permisosEfectivos } from "./permisos";
import { ipParaLimite } from "@/lib/http/ip";
import { SESION } from "./middleware-config";

/**
 * Cada cuánto se revalida un JWT contra la BD. Con `strategy: "jwt"` no hay
 * consulta a BD por request; esto reintroduce una, como mucho una vez cada
 * intervalo, para que un usuario DESACTIVADO o con el rol CAMBIADO deje de tener
 * acceso sin esperar a que expire el token.
 */
const REVALIDA_MS = 5 * 60 * 1000; // 5 minutos

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).toLowerCase().trim();
        const { ip, userAgent } = request ? getClientInfo(request) : { ip: undefined, userAgent: undefined };

        // ─── Límite de intentos ──────────────────────────────────────────────
        // Primero la IP, y sin escribir en AuditLog: quien ya agotó su cupo no
        // debe poder seguir llenando la base a razón de una fila por intento.
        const ipLimite = request
          ? ipParaLimite(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"))
          : "desconocida";
        const claveIp = ipLimite === "desconocida" ? null : `login-ip:${ipLimite}`;
        if (claveIp && estaBloqueado(claveIp, Date.now(), CONFIG_LOGIN_IP)) return null;

        if (estaBloqueado(email)) {
          await audit({
            accion: "LOGIN", tabla: "User", registroId: email, usuarioEmail: email,
            valorNuevo: { exito: false, motivo: "BLOQUEADO_POR_INTENTOS" }, ip, userAgent,
          });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            empleado: { include: { sucursal: true, departamento: true, puesto: true } },
            perfil: { select: { permisos: true, activo: true, alcance: true } },
          },
        });

        const passwordOk = user?.password
          ? await bcrypt.compare(String(credentials.password), user.password)
          : false;

        // Un usuario inactivo se trata como credencial inválida (no se distingue,
        // para no filtrar qué cuentas existen).
        if (!user || !user.activo || !passwordOk) {
          const r = registrarFallo(email);
          // Un acierto no lo limpia: si no, una cuenta propia válida bastaría
          // para reiniciar el cupo entre ráfagas contra cuentas ajenas.
          if (claveIp) registrarFallo(claveIp, Date.now(), CONFIG_LOGIN_IP);
          await audit({
            accion: "LOGIN", tabla: "User", registroId: email, usuarioEmail: email,
            valorNuevo: {
              exito: false,
              motivo: !user ? "USUARIO_INEXISTENTE" : !user.activo ? "USUARIO_INACTIVO" : "PASSWORD_INCORRECTA",
              intentosRestantes: r.intentosRestantes,
            },
            ip, userAgent,
          });
          return null;
        }

        // Éxito: se limpia el contador y se deja rastro.
        limpiar(email);
        await audit({
          accion: "LOGIN", tabla: "User", registroId: user.id,
          usuarioId: user.id, usuarioEmail: user.email,
          valorNuevo: { exito: true }, ip, userAgent,
        });

        // Última entrada correcta. Se escribe sin await bloqueante del resultado
        // de negocio: es telemetría de la cuenta, no parte del login.
        prisma.user
          .update({ where: { id: user.id }, data: { ultimoAcceso: new Date() } })
          .catch((e) => console.error("[auth] no se pudo registrar ultimoAcceso", e));

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.image,
          empleadoId: user.empleado?.id ?? null,
          permisos: permisosEfectivos(user),
          // Un perfil inactivo no sólo pierde permisos: pierde también el alcance
          // amplio que traía. Se cae al más restrictivo.
          alcance: user.perfil ? (user.perfil.activo ? user.perfil.alcance : "PROPIO") : "TODO",
          sucursalesIds: user.sucursalesIds,
          departamentoId: user.empleado?.departamentoId ?? null,
          debeCambiarPassword: user.debeCambiarPassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Inicio de sesión: se sellan los datos y la próxima revalidación.
      if (user) {
        token.role = user.role;
        token.empleadoId = user.empleadoId;
        token.permisos = user.permisos;
        token.alcance = user.alcance;
        token.sucursalesIds = user.sucursalesIds;
        token.departamentoId = user.departamentoId;
        token.debeCambiarPassword = user.debeCambiarPassword;
        token.checasEn = Date.now() + REVALIDA_MS;
        return token;
      }

      // Requests posteriores: revalidar sólo cuando toca, no en cada uno.
      if (typeof token.checasEn === "number" && Date.now() < token.checasEn) {
        return token;
      }

      if (!token.sub) return token;

      try {
        const actual = await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            activo: true,
            role: true,
            sucursalesIds: true,
            debeCambiarPassword: true,
            empleado: { select: { id: true, departamentoId: true } },
            perfil: { select: { permisos: true, activo: true, alcance: true } },
          },
        });

        // Usuario borrado o desactivado → se invalida la sesión (logout forzado).
        if (!actual || !actual.activo) return null;

        // Se refresca el rol por si cambió (ascenso/descenso de permisos), y con
        // él los permisos y el alcance: es lo que hace que quitar un permiso o
        // cambiar de perfil surta efecto sin esperar a que caduque el token.
        token.role = actual.role;
        token.empleadoId = actual.empleado?.id ?? null;
        token.permisos = permisosEfectivos(actual);
        token.alcance = actual.perfil
          ? ((actual.perfil.activo ? actual.perfil.alcance : "PROPIO") as AlcanceDatos)
          : "TODO";
        token.sucursalesIds = actual.sucursalesIds;
        token.departamentoId = actual.empleado?.departamentoId ?? null;
        token.debeCambiarPassword = actual.debeCambiarPassword;
        token.checasEn = Date.now() + REVALIDA_MS;
        return token;
      } catch {
        // Si la BD falla, se conserva el token (disponibilidad): la próxima
        // ventana volverá a intentar la revalidación. No se cierra sesión a
        // todo el mundo por un hipo de la base.
        return token;
      }
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user;
        // `token.sub` es opcional en el tipo de next-auth; sin sesión no hay
        // nada que sellar y sobrescribir con undefined sería peor que no tocar.
        if (token.sub) u.id = token.sub;
        u.role = token.role as UserRole | undefined;
        u.empleadoId = (token.empleadoId as string | null | undefined) ?? null;
        u.permisos = (token.permisos as string[] | undefined) ?? [];
        u.alcance = (token.alcance as AlcanceDatos | undefined) ?? "TODO";
        u.sucursalesIds = (token.sucursalesIds as string[] | undefined) ?? [];
        u.departamentoId = (token.departamentoId as string | null | undefined) ?? null;
        u.debeCambiarPassword = token.debeCambiarPassword === true;
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      const sub = "token" in message ? message.token?.sub : undefined;
      if (sub) {
        await audit({ accion: "LOGOUT", tabla: "User", registroId: sub, usuarioId: sub });
      }
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: SESION,
};
