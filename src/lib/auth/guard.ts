/**
 * Autorización de rutas API y páginas del panel.
 *
 * HISTORIA, PORQUE EXPLICA LA FORMA. Este módulo nació con listas de roles con
 * nombre (`ROLES_NOMINA`, `ROLES_PII`) para tapar un agujero concreto: las rutas
 * de ESCRITURA verificaban el rol una por una, pero las de LECTURA sólo miraban
 * que existiera sesión, de modo que cualquier usuario autenticado —incluido el
 * rol EMPLEADO— podía leer `GET /api/empleados` y recibir el registro completo
 * de toda la plantilla: salario, cuenta bancaria, identidad, RTN y dirección.
 *
 * Aquello resolvió el agujero pero dejó dos criterios conviviendo: estas listas
 * y las decenas de `["SUPER_ADMIN", "ADMIN_RRHH"].includes(role)` escritos a
 * mano dentro de cada ruta. Ahora hay uno solo: el permiso. Las guardias por rol
 * se retiraron cuando dejó de quedar ninguna ruta que las usara, para que una
 * ruta nueva no pueda volver a elegir el camino viejo.
 *
 * El menú lateral filtra por permiso, pero eso es cosmético: escribir la URL
 * directamente sigue llegando aquí, que es donde se decide.
 */

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { UserRole, AlcanceDatos } from "@prisma/client";
import { tienePermiso, tieneAlguno, tieneTodos, type Permiso } from "./permisos";

export interface Usuario {
  id?: string;
  email?: string | null;
  /**
   * Rol heredado. Sigue existiendo porque decide los permisos de las cuentas SIN
   * perfil asignado (ver PERMISOS_POR_ROL) y porque un par de reglas de ámbito
   * lo consultan para no ampliar el acceso de las cuentas heredadas.
   */
  role?: UserRole;
  empleadoId?: string | null;
  /**
   * Permisos efectivos, ya resueltos (perfil si lo tiene, si no el mapa del rol).
   * Viajan en el token y se refrescan en el mismo ciclo de revalidación de 5
   * minutos que ya comprobaba si la cuenta seguía activa.
   */
  permisos?: string[];
  alcance?: AlcanceDatos | null;
  sucursalesIds?: string[] | null;
  departamentoId?: string | null;
  debeCambiarPassword?: boolean;
}

export type ResultadoGuardia =
  | { ok: true; usuario: Usuario }
  | { ok: false; response: NextResponse };

// ─── COMPROBACIONES ──────────────────────────────────────────────────────────
// Deciden la FORMA de una respuesta (qué columnas devolver, qué botón dibujar),
// no el acceso. Para el acceso están las guardias de más abajo.

/** ¿El usuario tiene este permiso? */
export function puede(usuario: Usuario | undefined, permiso: Permiso): boolean {
  return tienePermiso(usuario?.permisos, permiso);
}

/** ¿Tiene al menos uno? Criterio habitual para dar entrada a una pantalla. */
export function puedeAlguno(usuario: Usuario | undefined, permisos: readonly Permiso[]): boolean {
  return tieneAlguno(usuario?.permisos, permisos);
}

/** ¿Los tiene todos? Para acciones que exigen varios a la vez. */
export function puedeTodos(usuario: Usuario | undefined, permisos: readonly Permiso[]): boolean {
  return tieneTodos(usuario?.permisos, permisos);
}

// ─── CONTRASEÑA TEMPORAL ─────────────────────────────────────────────────────

/**
 * Respuesta cuando la cuenta arrastra una contraseña temporal.
 *
 * POR QUÉ BLOQUEA Y NO SÓLO AVISA: una clave temporal la fija otra persona —un
 * administrador— y por tanto hay una ventana en la que DOS personas pueden
 * entrar con ella. Mientras dure, lo que haga la cuenta no es atribuible a su
 * titular, y ese rastro es justo lo que una nómina necesita que sea fiable.
 * Un banner que se puede ignorar deja esa ventana abierta indefinidamente.
 *
 * Se responde 403 con un código que el cliente puede reconocer para llevar al
 * usuario al cambio de contraseña en vez de mostrarle un error genérico.
 */
function respuestaPasswordTemporal(): NextResponse {
  return NextResponse.json(
    {
      error: "Debe cambiar su contraseña temporal antes de usar el sistema.",
      codigo: "PASSWORD_TEMPORAL",
      destino: "/mi-cuenta",
    },
    { status: 403 }
  );
}

/** ¿La cuenta está a la espera de que su titular fije una contraseña propia? */
export function tienePasswordTemporal(usuario: Usuario | undefined): boolean {
  return usuario?.debeCambiarPassword === true;
}

// ─── GUARDIAS DE RUTA API ────────────────────────────────────────────────────

/**
 * Guardia por permiso: 401 sin sesión, 403 con permiso insuficiente.
 *
 * Se distinguen los dos códigos a propósito: 401 le dice al cliente que vuelva a
 * autenticarse; 403, que ya sabemos quién es y no le corresponde.
 *
 * Con varios permisos basta con UNO (criterio "o"): una pantalla suele ser
 * accesible por más de una vía. Cuando hagan falta todos, compruébelo con
 * `puedeTodos` dentro del handler, que es donde el matiz se lee.
 */
export async function requerirPermiso(
  permiso: Permiso | readonly Permiso[]
): Promise<ResultadoGuardia> {
  const session = await auth();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const usuario = session.user as Usuario;
  // Ninguna acción que exija un permiso se ejecuta con una contraseña prestada.
  if (tienePasswordTemporal(usuario)) {
    return { ok: false, response: respuestaPasswordTemporal() };
  }

  const pedidos = Array.isArray(permiso) ? permiso : [permiso as Permiso];
  if (!tieneAlguno(usuario.permisos, pedidos)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Permiso insuficiente" }, { status: 403 }),
    };
  }

  return { ok: true, usuario };
}

/**
 * Guardia que sólo exige sesión válida.
 *
 * Para lo que toda cuenta puede hacer sobre lo suyo: sus boletas, sus datos, sus
 * solicitudes. El filtrado por empleado lo hace el handler; aquí no hay permiso
 * del catálogo que comprobar porque no es una atribución que se conceda.
 */
export async function requerirSesion(
  opciones?: {
    /**
     * Deja pasar a una cuenta con contraseña temporal.
     *
     * Lo usa ÚNICAMENTE el cambio de contraseña: es la salida del bloqueo, así
     * que bloquearla también dejaría la cuenta sin forma de desbloquearse.
     */
    permitirPasswordTemporal?: boolean;
  }
): Promise<ResultadoGuardia> {
  const session = await auth();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  const usuario = session.user as Usuario;
  if (!opciones?.permitirPasswordTemporal && tienePasswordTemporal(usuario)) {
    return { ok: false, response: respuestaPasswordTemporal() };
  }

  return { ok: true, usuario };
}

// ─── GUARDIAS DE PÁGINA (Server Components) ──────────────────────────────────

/**
 * Redirige en vez de responder con un código: un usuario que llega a una URL que
 * no le corresponde va a su propio espacio, no a una pantalla de error.
 */
export async function requerirPermisoPagina(
  permiso: Permiso | readonly Permiso[]
): Promise<Usuario> {
  const session = await auth();
  if (!session) redirect("/login");

  const usuario = session.user as Usuario;
  if (tienePasswordTemporal(usuario)) redirect("/mi-cuenta");

  const pedidos = Array.isArray(permiso) ? permiso : [permiso as Permiso];
  if (!tieneAlguno(usuario.permisos, pedidos)) redirect("/mi-espacio");

  return usuario;
}

/** Página que toda cuenta con sesión puede abrir (su cuenta, su contraseña). */
export async function requerirSesionPagina(): Promise<Usuario> {
  const session = await auth();
  if (!session) redirect("/login");
  return session.user as Usuario;
}

/** Usuario de la sesión actual, o `undefined`. Para páginas que adaptan lo que muestran. */
export async function usuarioActual(): Promise<Usuario | undefined> {
  const session = await auth();
  return (session?.user as Usuario | undefined) ?? undefined;
}
