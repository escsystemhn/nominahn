/**
 * Alta de un puesto dentro de un departamento (Configuración → Estructura
 * organizacional). Antes los puestos sólo los creaban los scripts de datos
 * iniciales: una instalación nueva no tenía forma de agregar uno.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { puestoRepetidoEnDepartamento, zDatosPuesto } from "@/lib/organizacion/estructura-bd";
import { limpiarNombrePuesto, rangoSalarialValido } from "@/lib/organizacion/puestos";

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, zDatosPuesto);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const nombre = limpiarNombrePuesto(d.nombre);
  const salarioMinimo = d.salarioMinimo ?? 0;
  const salarioMaximo = d.salarioMaximo ?? 0;

  if (!rangoSalarialValido(salarioMinimo, salarioMaximo)) {
    return NextResponse.json({ error: "El salario mínimo no puede ser mayor que el máximo." }, { status: 400 });
  }
  const departamento = await prisma.departamento.findUnique({ where: { id: d.departamentoId }, select: { nombre: true, activo: true } });
  if (!departamento) return NextResponse.json({ error: "El departamento no existe." }, { status: 400 });
  if (!departamento.activo) return NextResponse.json({ error: `El departamento «${departamento.nombre}» está inactivo.` }, { status: 400 });
  if (await puestoRepetidoEnDepartamento(prisma, d.departamentoId, nombre)) {
    return NextResponse.json({ error: `Ya existe un puesto llamado «${nombre}» en ${departamento.nombre}.` }, { status: 409 });
  }

  const puesto = await prisma.puesto.create({
    data: { nombre, descripcion: d.descripcion || null, departamentoId: d.departamentoId, salarioMinimo, salarioMaximo },
  });
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE", tabla: "Puesto", registroId: puesto.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { nombre, departamentoId: d.departamentoId, salarioMinimo, salarioMaximo }, ip, userAgent,
  });
  return NextResponse.json(puesto, { status: 201 });
}
