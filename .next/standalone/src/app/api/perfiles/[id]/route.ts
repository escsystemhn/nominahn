/**
 * Edición y eliminación de un perfil de acceso.
 *
 * Editar un perfil cambia de golpe lo que pueden hacer todas las cuentas que lo
 * tienen asignado; por eso la auditoría guarda el antes y el después de la lista
 * de permisos, y la respuesta dice a cuántos usuarios afecta.
 *
 * Los perfiles marcados como de sistema no se tocan: son la red de seguridad
 * para que la instalación no se quede sin un perfil capaz de administrar.
 */

import { NextRequest, NextResponse } from "next/server";
import { AlcanceDatos } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { z } from "zod";
import { esPermisoValido, tienePermiso, TODOS_LOS_PERMISOS } from "@/lib/auth/permisos";
import { puedeOtorgar, puedeBorrarPerfil, PERMISO_LLAVE } from "@/lib/auth/politica-usuarios";

const schema = z.object({
  nombre: z.string().trim().min(1).max(80).optional(),
  descripcion: z.string().trim().max(300).nullable().optional(),
  alcance: z.enum(AlcanceDatos).optional(),
  permisos: z.array(z.string()).max(200).optional(),
  activo: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("seguridad.perfiles");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const cambios = parsed.data;

  const perfil = await prisma.perfilAcceso.findUnique({
    where: { id },
    include: { _count: { select: { usuarios: true } } },
  });
  if (!perfil) return NextResponse.json({ error: "El perfil no existe." }, { status: 404 });
  if (perfil.esSistema) {
    return NextResponse.json(
      { error: "Los perfiles de sistema no se pueden modificar. Duplíquelo si necesita variantes." },
      { status: 409 }
    );
  }

  if (cambios.permisos) {
    const invalidos = cambios.permisos.filter((p) => !esPermisoValido(p));
    if (invalidos.length > 0) {
      return NextResponse.json({ error: `Permisos desconocidos: ${invalidos.join(", ")}` }, { status: 400 });
    }
    const otorga = puedeOtorgar(g.usuario, cambios.permisos);
    if (!otorga.ok) return NextResponse.json({ error: otorga.motivo }, { status: 403 });
  }

  /**
   * Si el actor usa ESTE perfil, no puede quitarle —ni desactivándolo ni
   * recortando permisos— la llave desde la que administra: se quedaría al otro
   * lado de la puerta que acaba de cerrar.
   */
  const usuariosDelPerfil = await prisma.user.findMany({
    where: { perfilId: id },
    select: { id: true },
  });
  const esElSuyo = usuariosDelPerfil.some((u) => u.id === g.usuario.id);
  if (esElSuyo) {
    const perderaLlave =
      cambios.activo === false ||
      (cambios.permisos !== undefined && !tienePermiso(cambios.permisos, PERMISO_LLAVE));
    if (perderaLlave) {
      return NextResponse.json(
        { error: "Es su propio perfil: no puede dejarlo sin la gestión de usuarios ni desactivarlo." },
        { status: 409 }
      );
    }
  }

  const actualizado = await prisma.perfilAcceso.update({
    where: { id },
    data: {
      ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
      ...(cambios.descripcion !== undefined ? { descripcion: cambios.descripcion } : {}),
      ...(cambios.alcance !== undefined ? { alcance: cambios.alcance } : {}),
      ...(cambios.permisos !== undefined
        ? {
            permisos: [...new Set(cambios.permisos)],
            // Al decidir sobre los permisos se sella el catálogo visto: a partir
            // de aquí, un permiso ausente es una decisión, no un descuido.
            permisosConocidos: [...TODOS_LOS_PERMISOS],
          }
        : {}),
      ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "PerfilAcceso",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { permisos: perfil.permisos, alcance: perfil.alcance, activo: perfil.activo },
    valorNuevo: {
      permisos: actualizado.permisos,
      alcance: actualizado.alcance,
      activo: actualizado.activo,
      // Un cambio de perfil se propaga a todas sus cuentas: dejarlo escrito
      // evita tener que reconstruir el alcance del cambio a posteriori.
      usuariosAfectados: perfil._count.usuarios,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ perfil: actualizado, usuariosAfectados: perfil._count.usuarios });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("seguridad.perfiles");
  if (!g.ok) return g.response;

  const { id } = await params;
  const perfil = await prisma.perfilAcceso.findUnique({
    where: { id },
    include: { _count: { select: { usuarios: true } } },
  });
  if (!perfil) return NextResponse.json({ error: "El perfil no existe." }, { status: 404 });

  const veredicto = puedeBorrarPerfil({
    esSistema: perfil.esSistema,
    usuariosAsignados: perfil._count.usuarios,
  });
  if (!veredicto.ok) return NextResponse.json({ error: veredicto.motivo }, { status: 409 });

  await prisma.perfilAcceso.delete({ where: { id } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "PerfilAcceso",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: perfil.nombre, codigo: perfil.codigo, permisos: perfil.permisos },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
