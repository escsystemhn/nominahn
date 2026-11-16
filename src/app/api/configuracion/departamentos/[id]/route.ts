/**
 * Edición de un departamento: nombre, código, estado y —con las divisiones
 * habilitadas— su división. Así se ubican en la jerarquía los departamentos
 * que existían antes del nivel División.
 *
 * La sucursal no cambia aquí: sus empleados y puestos pertenecen a ella, y
 * moverla en silencio dejaría a esas personas en una sucursal distinta de la de
 * su departamento.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zIdOpcional } from "@/lib/http/validar";
import { divisionesHabilitadas, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";
import { motivoParaNoEliminarDepartamento } from "@/lib/organizacion/eliminar";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  codigo: z.string().trim().max(50).nullable().optional(),
  activo: z.boolean().optional(),
  /** Presente = se cambia (null la quita). Ausente = no se toca. */
  divisionId: zIdOpcional.optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const antes = await prisma.departamento.findUnique({
    where: { id },
    select: { nombre: true, codigo: true, activo: true, sucursalId: true, divisionId: true },
  });
  if (!antes) return NextResponse.json({ error: "El departamento no existe." }, { status: 404 });

  const cambiaDivision = c.divisionId !== undefined && c.divisionId !== antes.divisionId;
  if (cambiaDivision) {
    const error = await validarDivisionDeDepartamento(
      prisma,
      { sucursalId: antes.sucursalId, divisionId: c.divisionId ?? null },
      await divisionesHabilitadas(prisma)
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  const dept = await prisma.departamento.update({
    where: { id },
    data: {
      ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
      ...(c.codigo !== undefined ? { codigo: c.codigo || null } : {}),
      ...(c.activo !== undefined ? { activo: c.activo } : {}),
      ...(cambiaDivision ? { divisionId: c.divisionId ?? null } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Departamento", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes,
    valorNuevo: { nombre: dept.nombre, codigo: dept.codigo, activo: dept.activo, sucursalId: dept.sucursalId, divisionId: dept.divisionId },
    ip, userAgent,
  });
  return NextResponse.json(dept);
}

/** Borrar un departamento que no está amarrado: sin empleados, puestos, vacantes ni planillas. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const d = await prisma.departamento.findUnique({
    where: { id },
    select: {
      nombre: true, sucursalId: true, divisionId: true,
      _count: { select: { empleados: true, puestos: true, vacantes: true, planillas: true, detallesPlanilla: true } },
    },
  });
  if (!d) return NextResponse.json({ error: "El departamento no existe." }, { status: 404 });

  const c = d._count;
  const motivo = motivoParaNoEliminarDepartamento({
    empleados: c.empleados, puestos: c.puestos, vacantes: c.vacantes, planillas: c.planillas, lineasPlanilla: c.detallesPlanilla,
  });
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });

  const { count } = await prisma.departamento.deleteMany({
    where: { id, empleados: { none: {} }, puestos: { none: {} }, vacantes: { none: {} }, planillas: { none: {} }, detallesPlanilla: { none: {} } },
  });
  if (count === 0) {
    return NextResponse.json({ error: "No se puede eliminar: acaba de empezar a usarse. Desactívelo para retirarlo de las listas." }, { status: 409 });
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "Departamento", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: d.nombre, sucursalId: d.sucursalId, divisionId: d.divisionId }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
