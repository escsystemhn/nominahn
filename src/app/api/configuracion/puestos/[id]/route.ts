/**
 * Edición y baja de un puesto. Las reglas de cuándo no se puede mover, desactivar
 * o eliminar viven en `lib/organizacion/puestos.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { puestoRepetidoEnDepartamento, zDatosPuesto } from "@/lib/organizacion/estructura-bd";
import {
  limpiarNombrePuesto,
  motivoParaNoDesactivar,
  motivoParaNoEliminar,
  motivoParaNoMover,
  rangoSalarialValido,
} from "@/lib/organizacion/puestos";

const schema = zDatosPuesto.partial().extend({ activo: z.boolean().optional() });

const USO = { _count: { select: { empleados: true, puestosCompetencia: true, coberturas: true } } } as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const antes = await prisma.puesto.findUnique({
    where: { id },
    select: { nombre: true, descripcion: true, departamentoId: true, salarioMinimo: true, salarioMaximo: true, activo: true, ...USO },
  });
  if (!antes) return NextResponse.json({ error: "El puesto no existe." }, { status: 404 });
  const uso = { empleados: antes._count.empleados, competencias: antes._count.puestosCompetencia, coberturas: antes._count.coberturas };

  const nombre = c.nombre !== undefined ? limpiarNombrePuesto(c.nombre) : antes.nombre;
  const departamentoId = c.departamentoId ?? antes.departamentoId;
  const salarioMinimo = c.salarioMinimo ?? Number(antes.salarioMinimo);
  const salarioMaximo = c.salarioMaximo ?? Number(antes.salarioMaximo);

  if (!rangoSalarialValido(salarioMinimo, salarioMaximo)) {
    return NextResponse.json({ error: "El salario mínimo no puede ser mayor que el máximo." }, { status: 400 });
  }
  if (departamentoId !== antes.departamentoId) {
    const motivo = motivoParaNoMover(uso);
    if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
    const destino = await prisma.departamento.findUnique({ where: { id: departamentoId }, select: { nombre: true, activo: true } });
    if (!destino) return NextResponse.json({ error: "El departamento no existe." }, { status: 400 });
    if (!destino.activo) return NextResponse.json({ error: `El departamento «${destino.nombre}» está inactivo.` }, { status: 400 });
  }
  if ((nombre !== antes.nombre || departamentoId !== antes.departamentoId) &&
      await puestoRepetidoEnDepartamento(prisma, departamentoId, nombre, id)) {
    return NextResponse.json({ error: `Ya existe un puesto llamado «${nombre}» en ese departamento.` }, { status: 409 });
  }
  if (c.activo === false && antes.activo) {
    const coberturasActivas = await prisma.coberturaSucursal.count({ where: { puestoId: id, activo: true } });
    const motivo = motivoParaNoDesactivar(coberturasActivas);
    if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  }

  const puesto = await prisma.puesto.update({
    where: { id },
    data: {
      nombre,
      departamentoId,
      salarioMinimo,
      salarioMaximo,
      ...(c.descripcion !== undefined ? { descripcion: c.descripcion || null } : {}),
      ...(c.activo !== undefined ? { activo: c.activo } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Puesto", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: {
      nombre: antes.nombre, descripcion: antes.descripcion, departamentoId: antes.departamentoId,
      salarioMinimo: Number(antes.salarioMinimo), salarioMaximo: Number(antes.salarioMaximo), activo: antes.activo,
    },
    valorNuevo: { nombre, descripcion: puesto.descripcion, departamentoId, salarioMinimo, salarioMaximo, activo: puesto.activo },
    ip, userAgent,
  });
  return NextResponse.json(puesto);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const puesto = await prisma.puesto.findUnique({ where: { id }, select: { nombre: true, departamentoId: true, ...USO } });
  if (!puesto) return NextResponse.json({ error: "El puesto no existe." }, { status: 404 });

  const motivo = motivoParaNoEliminar({
    empleados: puesto._count.empleados, competencias: puesto._count.puestosCompetencia, coberturas: puesto._count.coberturas,
  });
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });

  // La condición va en el propio borrado: una cobertura agregada en este instante
  // se iría en cascada y a un empleado se le vaciaría el puesto, sin error alguno.
  const { count } = await prisma.puesto.deleteMany({
    where: { id, empleados: { none: {} }, puestosCompetencia: { none: {} }, coberturas: { none: {} } },
  });
  if (count === 0) {
    return NextResponse.json({ error: "No se puede eliminar: el puesto acaba de empezar a usarse. Desactívelo para retirarlo de las listas." }, { status: 409 });
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "Puesto", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: puesto.nombre, departamentoId: puesto.departamentoId }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
