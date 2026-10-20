/**
 * Modificación de una cuenta de acceso.
 *
 * Todo el peso está en `validarCambioUsuario`: comprueba a la vez que nadie
 * conceda permisos que no tiene, que nadie se cierre la puerta a sí mismo y que
 * la instalación no se quede sin ningún administrador. Las tres reglas viven en
 * `lib/auth/politica-usuarios.ts` y están cubiertas por tests, porque cada una
 * tiene un caso límite que no se ve leyendo el handler.
 *
 * NO HAY BORRADO. Una cuenta se DESACTIVA: hay claves foráneas colgando de ella
 * (historial salarial, auditoría) y borrarla dejaría huérfano el rastro de quién
 * hizo qué, que es justo lo que una nómina no puede permitirse.
 */

import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { z } from "zod";
import { permisosEfectivos, tienePermiso } from "@/lib/auth/permisos";
import { validarCambioUsuario, PERMISO_LLAVE } from "@/lib/auth/politica-usuarios";

const CAMPOS = {
  id: true,
  name: true,
  email: true,
  role: true,
  activo: true,
  debeCambiarPassword: true,
  ultimoAcceso: true,
  sucursalesIds: true,
  perfil: { select: { id: true, codigo: true, nombre: true, alcance: true, activo: true } },
  empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
} as const;

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(UserRole).optional(),
  // `null` desvincula el perfil y devuelve al usuario a los permisos de su rol.
  perfilId: zId.nullable().optional(),
  activo: z.boolean().optional(),
  sucursalesIds: z.array(zId).max(50).optional(),
  empleadoId: zId.nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("seguridad.usuarios_gestionar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const cambios = parsed.data;

  const objetivo = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true, activo: true, perfilId: true,
      sucursalesIds: true,
      perfil: { select: { permisos: true, activo: true } },
      empleado: { select: { id: true } },
    },
  });
  if (!objetivo) return NextResponse.json({ error: "El usuario no existe." }, { status: 404 });

  // ─── Permisos que tendría tras el cambio ──────────────────────────────────
  let perfilDestino = objetivo.perfil;
  if (cambios.perfilId !== undefined) {
    if (cambios.perfilId === null) {
      perfilDestino = null;
    } else {
      const encontrado = await prisma.perfilAcceso.findUnique({
        where: { id: cambios.perfilId },
        select: { permisos: true, activo: true },
      });
      if (!encontrado) return NextResponse.json({ error: "El perfil no existe." }, { status: 400 });
      perfilDestino = encontrado;
    }
  }

  const permisosActuales = permisosEfectivos({ role: objetivo.role, perfil: objetivo.perfil });
  const cambiaPermisos = cambios.perfilId !== undefined || cambios.role !== undefined;
  const permisosDestino = cambiaPermisos
    ? permisosEfectivos({ role: cambios.role ?? objetivo.role, perfil: perfilDestino })
    : undefined;

  // Cuántas OTRAS cuentas activas conservan la llave de administración. Es lo
  // que decide si este cambio deja el sistema sin nadie que pueda gestionarlo.
  const otrosAdministradores = await contarAdministradores(id);

  const veredicto = validarCambioUsuario(
    g.usuario,
    { id: objetivo.id, activo: objetivo.activo, permisos: permisosActuales },
    { activo: cambios.activo, permisos: permisosDestino },
    otrosAdministradores
  );
  if (!veredicto.ok) return NextResponse.json({ error: veredicto.motivo }, { status: 409 });

  // ─── Vínculo con empleado ─────────────────────────────────────────────────
  if (cambios.empleadoId) {
    const empleado = await prisma.empleado.findUnique({
      where: { id: cambios.empleadoId },
      select: { userId: true },
    });
    if (!empleado) return NextResponse.json({ error: "El empleado no existe." }, { status: 400 });
    if (empleado.userId && empleado.userId !== id) {
      return NextResponse.json({ error: "Ese empleado ya tiene otra cuenta." }, { status: 409 });
    }
  }

  const actualizado = await prisma.user.update({
    where: { id },
    data: {
      ...(cambios.name !== undefined ? { name: cambios.name } : {}),
      ...(cambios.role !== undefined ? { role: cambios.role } : {}),
      ...(cambios.perfilId !== undefined ? { perfilId: cambios.perfilId } : {}),
      ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
      ...(cambios.sucursalesIds !== undefined ? { sucursalesIds: cambios.sucursalesIds } : {}),
      ...(cambios.empleadoId !== undefined
        ? cambios.empleadoId === null
          ? { empleado: { disconnect: true } }
          : { empleado: { connect: { id: cambios.empleadoId } } }
        : {}),
    },
    select: CAMPOS,
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "User",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: {
      role: objetivo.role, perfilId: objetivo.perfilId, activo: objetivo.activo,
      sucursalesIds: objetivo.sucursalesIds, empleadoId: objetivo.empleado?.id ?? null,
    },
    valorNuevo: {
      role: actualizado.role, perfilId: actualizado.perfil?.id ?? null,
      activo: actualizado.activo, sucursalesIds: actualizado.sucursalesIds,
      empleadoId: actualizado.empleado?.id ?? null,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ usuario: actualizado });
}

/**
 * Desactiva la cuenta. Se expone como DELETE porque es lo que el usuario
 * entiende por "eliminar", pero el registro permanece: ver la cabecera.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("seguridad.usuarios_gestionar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const objetivo = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, activo: true, role: true,
      perfil: { select: { permisos: true, activo: true } },
    },
  });
  if (!objetivo) return NextResponse.json({ error: "El usuario no existe." }, { status: 404 });
  if (!objetivo.activo) return NextResponse.json({ usuario: { id, activo: false } });

  const veredicto = validarCambioUsuario(
    g.usuario,
    {
      id: objetivo.id,
      activo: objetivo.activo,
      permisos: permisosEfectivos({ role: objetivo.role, perfil: objetivo.perfil }),
    },
    { activo: false },
    await contarAdministradores(id)
  );
  if (!veredicto.ok) return NextResponse.json({ error: veredicto.motivo }, { status: 409 });

  await prisma.user.update({ where: { id }, data: { activo: false } });

  // Las sesiones abiertas no se cortan aquí: el callback `jwt` revalida contra
  // la base cada 5 minutos y devuelve `null` para una cuenta inactiva, lo que
  // cierra la sesión sola. Se borran igualmente las de base de datos, si las hay.
  await prisma.session.deleteMany({ where: { userId: id } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "User",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { activo: true },
    valorNuevo: { activo: false, motivo: "Desactivación desde gestión de usuarios" },
    ip,
    userAgent,
  });

  return NextResponse.json({ usuario: { id, activo: false } });
}

/**
 * Cuántas cuentas ACTIVAS distintas de `excluyendo` pueden gestionar usuarios.
 *
 * Se cuenta sobre los permisos EFECTIVOS —perfil si lo hay, si no el mapa del
 * rol—, no sobre una columna: contar sólo los SUPER_ADMIN daría cero en una
 * instalación que ya reparte la administración por perfiles, y bloquearía
 * cambios perfectamente legítimos.
 */
async function contarAdministradores(excluyendo: string): Promise<number> {
  const candidatos = await prisma.user.findMany({
    where: { activo: true, id: { not: excluyendo } },
    select: { role: true, perfil: { select: { permisos: true, activo: true } } },
  });
  return candidatos.filter((u) => tienePermiso(permisosEfectivos(u), PERMISO_LLAVE)).length;
}
