/**
 * Cuentas de acceso: listar y crear.
 *
 * Hasta ahora los usuarios sólo existían porque los sembraba `prisma/seed.ts`.
 * Esta ruta abre la puerta, y con ella las precauciones que antes no hacían
 * falta: nadie concede permisos que no tiene, la contraseña inicial es temporal
 * y aleatoria, y ninguna respuesta devuelve el hash.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { z } from "zod";
import { permisosEfectivos } from "@/lib/auth/permisos";
import { puedeOtorgar } from "@/lib/auth/politica-usuarios";
import { generarPasswordTemporal, hashear } from "@/lib/auth/password";

/**
 * Campos que se devuelven de un usuario. La lista es explícita para que
 * `password` no pueda colarse nunca por omisión al añadir una columna nueva.
 */
const CAMPOS = {
  id: true,
  name: true,
  email: true,
  role: true,
  activo: true,
  debeCambiarPassword: true,
  passwordCambiadaAt: true,
  ultimoAcceso: true,
  createdAt: true,
  sucursalesIds: true,
  perfil: { select: { id: true, codigo: true, nombre: true, alcance: true, activo: true } },
  empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
} as const;

const crearSchema = z.object({
  email: z.string().trim().toLowerCase().email("correo inválido"),
  name: z.string().trim().min(1, "requerido").max(120),
  perfilId: zId.optional(),
  // `role` sigue existiendo mientras queden comprobaciones por rol sin migrar.
  // Sin perfil, es lo que decide los permisos (ver PERMISOS_POR_ROL).
  role: z.enum(UserRole).optional(),
  empleadoId: zId.optional(),
  sucursalesIds: z.array(zId).max(50).optional(),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["seguridad.usuarios_ver", "seguridad.usuarios_gestionar"]);
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const soloActivos = searchParams.get("activos") === "1";

  const where: Prisma.UserWhereInput = {
    ...(soloActivos ? { activo: true } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const usuarios = await prisma.user.findMany({
    where,
    select: CAMPOS,
    orderBy: [{ activo: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ usuarios });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("seguridad.usuarios_gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, crearSchema);
  if (!parsed.ok) return parsed.response;
  const { email, name, perfilId, role, empleadoId, sucursalesIds } = parsed.data;

  const yaExiste = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (yaExiste) {
    return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
  }

  // ─── El perfil no puede conceder más de lo que el actor tiene ──────────────
  let perfil = null;
  if (perfilId) {
    perfil = await prisma.perfilAcceso.findUnique({
      where: { id: perfilId },
      select: { id: true, nombre: true, permisos: true, activo: true },
    });
    if (!perfil) return NextResponse.json({ error: "El perfil no existe." }, { status: 400 });
  }

  const permisosResultantes = permisosEfectivos({
    role: role ?? "EMPLEADO",
    perfil: perfil ? { permisos: perfil.permisos, activo: perfil.activo } : null,
  });
  const otorga = puedeOtorgar(g.usuario, permisosResultantes);
  if (!otorga.ok) return NextResponse.json({ error: otorga.motivo }, { status: 403 });

  // ─── Vínculo con el empleado ──────────────────────────────────────────────
  if (empleadoId) {
    const empleado = await prisma.empleado.findUnique({
      where: { id: empleadoId },
      select: { id: true, userId: true },
    });
    if (!empleado) return NextResponse.json({ error: "El empleado no existe." }, { status: 400 });
    if (empleado.userId) {
      return NextResponse.json(
        { error: "Ese empleado ya tiene una cuenta de acceso." },
        { status: 409 }
      );
    }
  }

  /**
   * Contraseña temporal: se devuelve UNA sola vez, en esta respuesta, y se
   * guarda sólo su hash. `debeCambiarPassword` obliga a sustituirla en el primer
   * acceso, de modo que la clave que un administrador conoce deja de ser válida
   * en cuanto la persona entra.
   */
  const passwordTemporal = generarPasswordTemporal();

  const usuario = await prisma.user.create({
    data: {
      email,
      name,
      password: await hashear(passwordTemporal),
      role: role ?? "EMPLEADO",
      perfilId: perfil?.id,
      sucursalesIds: sucursalesIds ?? [],
      debeCambiarPassword: true,
      activo: true,
      ...(empleadoId ? { empleado: { connect: { id: empleadoId } } } : {}),
    },
    select: CAMPOS,
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "User",
    registroId: usuario.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    // Nunca la contraseña ni su hash, ni siquiera en el rastro de auditoría.
    valorNuevo: {
      email, name, role: usuario.role, perfil: perfil?.nombre ?? null,
      empleadoId: empleadoId ?? null, sucursalesIds: sucursalesIds ?? [],
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ usuario, passwordTemporal }, { status: 201 });
}
