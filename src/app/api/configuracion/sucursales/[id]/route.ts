/**
 * Edición, desactivación y borrado de una sucursal (el «grupo» de la jerarquía de nómina).
 * Se borra sólo si no está amarrada: sin empleados, divisiones, departamentos, planillas ni
 * traslados (`lib/organizacion/eliminar.ts`); su cobertura, horario y logo se van con ella.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { motivoParaNoDesactivarSucursal, motivoSucursalRepetida } from "@/lib/organizacion/sucursales";
import { motivoParaNoEliminarSucursal } from "@/lib/organizacion/eliminar";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  codigo: z.string().trim().min(1).max(50).optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  telefono: z.string().trim().max(50).nullable().optional(),
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

  const antes = await prisma.sucursal.findUnique({
    where: { id },
    select: { nombre: true, codigo: true, direccion: true, telefono: true, descripcion: true, activa: true, empresaId: true },
  });
  if (!antes) return NextResponse.json({ error: "La sucursal no existe." }, { status: 404 });

  const nombre = c.nombre ?? antes.nombre;
  const codigo = c.codigo ?? antes.codigo;
  if (nombre !== antes.nombre || codigo !== antes.codigo) {
    const otras = await prisma.sucursal.findMany({ where: { empresaId: antes.empresaId, id: { not: id } }, select: { nombre: true, codigo: true } });
    const repetida = motivoSucursalRepetida({ nombre, codigo }, otras);
    if (repetida) return NextResponse.json({ error: repetida }, { status: 409 });
  }

  if (c.activa === false && antes.activa) {
    const [empleadosVigentes, otrasActivas] = await Promise.all([
      prisma.empleado.count({ where: { sucursalId: id, estado: { not: "INACTIVO" } } }),
      prisma.sucursal.count({ where: { empresaId: antes.empresaId, activa: true, id: { not: id } } }),
    ]);
    const motivo = motivoParaNoDesactivarSucursal({ empleadosVigentes, otrasActivas });
    if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  }

  const sucursal = await prisma.sucursal.update({
    where: { id },
    data: {
      nombre,
      codigo,
      ...(c.direccion !== undefined ? { direccion: c.direccion || null } : {}),
      ...(c.telefono !== undefined ? { telefono: c.telefono || null } : {}),
      ...(c.descripcion !== undefined ? { descripcion: c.descripcion || null } : {}),
      ...(c.activa !== undefined ? { activa: c.activa } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Sucursal", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: antes.nombre, codigo: antes.codigo, direccion: antes.direccion, telefono: antes.telefono, descripcion: antes.descripcion, activa: antes.activa },
    valorNuevo: { nombre: sucursal.nombre, codigo: sucursal.codigo, direccion: sucursal.direccion, telefono: sucursal.telefono, descripcion: sucursal.descripcion, activa: sucursal.activa },
    ip, userAgent,
  });
  return NextResponse.json(sucursal);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const s = await prisma.sucursal.findUnique({
    where: { id },
    select: {
      nombre: true, codigo: true, empresaId: true,
      _count: { select: { empleados: true, divisiones: true, departamentos: true, planillas: true, detallesPlanilla: true, trasladosRecibidos: true } },
    },
  });
  if (!s) return NextResponse.json({ error: "La sucursal no existe." }, { status: 404 });

  const c = s._count;
  const motivo = motivoParaNoEliminarSucursal({
    empleados: c.empleados, divisiones: c.divisiones, departamentos: c.departamentos,
    planillas: c.planillas, lineasPlanilla: c.detallesPlanilla, traslados: c.trasladosRecibidos,
  });
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  if (!(await prisma.sucursal.count({ where: { empresaId: s.empresaId, activa: true, id: { not: id } } }))) {
    return NextResponse.json({ error: "No se puede eliminar: es la única activa; no quedaría dónde dar de alta a nadie." }, { status: 409 });
  }

  // La condición va en el propio borrado: un empleado o un departamento agregado en este
  // instante la amarraría. Cobertura, horario de atención y logo se van en cascada.
  const borrada = await prisma.$transaction(async (tx) => {
    const { count } = await tx.sucursal.deleteMany({
      where: {
        id, empleados: { none: {} }, divisiones: { none: {} }, departamentos: { none: {} },
        planillas: { none: {} }, detallesPlanilla: { none: {} }, trasladosRecibidos: { none: {} },
      },
    });
    if (count === 0) return false;
    // Quien la tenía en su alcance o en un plan de horarios deja de apuntar a ella.
    await tx.$executeRaw`UPDATE "User" SET "sucursalesIds" = array_remove("sucursalesIds", ${id}) WHERE ${id} = ANY("sucursalesIds")`;
    await tx.$executeRaw`UPDATE "PlanHorario" SET "sucursalesIds" = array_remove("sucursalesIds", ${id}) WHERE ${id} = ANY("sucursalesIds")`;
    return true;
  });
  if (!borrada) {
    return NextResponse.json({ error: "No se puede eliminar: acaba de empezar a usarse. Desactívela para retirarla de las listas." }, { status: 409 });
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "Sucursal", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: s.nombre, codigo: s.codigo }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
