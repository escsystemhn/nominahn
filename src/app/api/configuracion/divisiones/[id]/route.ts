/**
 * Edición y baja de una división.
 *
 * La sucursal de una división no cambia: sus departamentos y las planillas ya
 * emitidas cuelgan de esa sucursal. Una división en uso no se borra (dejaría
 * planillas pagadas apuntando a nada): se DESACTIVA, lo que la retira de los
 * desplegables sin tocar el histórico.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  codigo: z.string().trim().max(50).nullable().optional(),
  descripcion: z.string().trim().max(300).nullable().optional(),
  activa: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const antes = await prisma.division.findUnique({ where: { id }, select: { nombre: true, codigo: true, descripcion: true, activa: true } });
  if (!antes) return NextResponse.json({ error: "La división no existe." }, { status: 404 });

  try {
    const division = await prisma.division.update({
      where: { id },
      data: {
        ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
        ...(c.codigo !== undefined ? { codigo: c.codigo || null } : {}),
        ...(c.descripcion !== undefined ? { descripcion: c.descripcion || null } : {}),
        ...(c.activa !== undefined ? { activa: c.activa } : {}),
      },
    });
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE", tabla: "Division", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorAnterior: antes, valorNuevo: { nombre: division.nombre, codigo: division.codigo, descripcion: division.descripcion, activa: division.activa },
      ip, userAgent,
    });
    return NextResponse.json(division);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: `Ya existe una división llamada «${c.nombre}» en esa sucursal.` }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const division = await prisma.division.findUnique({
    where: { id },
    include: { _count: { select: { departamentos: true, planillas: true, detallesPlanilla: true } } },
  });
  if (!division) return NextResponse.json({ error: "La división no existe." }, { status: 404 });

  const { departamentos, planillas, detallesPlanilla } = division._count;
  if (departamentos + planillas + detallesPlanilla > 0) {
    const motivo = departamentos > 0 ? `tiene ${departamentos} departamento(s)` : "aparece en planillas emitidas";
    return NextResponse.json({ error: `No se puede eliminar: ${motivo}. Desactívela para retirarla de las listas.` }, { status: 409 });
  }

  await prisma.division.delete({ where: { id } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "Division", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: division.nombre, sucursalId: division.sucursalId }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
