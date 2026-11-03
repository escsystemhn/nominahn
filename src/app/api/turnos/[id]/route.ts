/**
 * Editar o borrar un turno. Un turno con asignaciones no se borra: se
 * desactiva, porque los marcajes ya registrados se calcularon con él.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroPorEmpleado, alcanceEsTotal } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { validarTurno } from "@/lib/asistencia/turnos-reglas";
import { schemaTurno } from "@/lib/asistencia/turnos-esquema";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  // Un turno vale para toda la empresa y decide su hora extra: cambiarlo afecta a gente
  // que esta cuenta no alcanza, y el turno no tiene sucursal con la que acotarlo.
  if (!alcanceEsTotal(g.usuario)) {
    return NextResponse.json({ error: "Los turnos valen para toda la empresa: sólo los cambia una cuenta con alcance total." }, { status: 403 });
  }
  const { id } = await params;
  const parsed = await parsearBody(req, schemaTurno);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const actual = await prisma.turno.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const v = validarTurno(d);
  if (v.errores.length) return NextResponse.json({ error: v.errores.join(" ") }, { status: 422 });
  if (d.codigo !== actual.codigo && (await prisma.turno.findUnique({ where: { codigo: d.codigo } }))) {
    return NextResponse.json({ error: `Ya existe un turno con el código ${d.codigo}.` }, { status: 409 });
  }

  const turno = await prisma.$transaction(async (tx) => {
    if (d.esPorDefecto) await tx.turno.updateMany({ where: { id: { not: id } }, data: { esPorDefecto: false } });
    return tx.turno.update({ where: { id }, data: { ...d, esPorDefecto: d.esPorDefecto ?? actual.esPorDefecto, activo: d.activo ?? actual.activo } });
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Turno",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { ...actual, jornadaHoras: Number(actual.jornadaHoras), almuerzoDesdeHoras: Number(actual.almuerzoDesdeHoras) },
    valorNuevo: d,
    ip,
    userAgent,
  });
  return NextResponse.json({ ...turno, avisos: v.avisos });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  // Un turno vale para toda la empresa y decide su hora extra: cambiarlo afecta a gente
  // que esta cuenta no alcanza, y el turno no tiene sucursal con la que acotarlo.
  if (!alcanceEsTotal(g.usuario)) {
    return NextResponse.json({ error: "Los turnos valen para toda la empresa: sólo los cambia una cuenta con alcance total." }, { status: 403 });
  }
  const { id } = await params;
  const actual = await prisma.turno.findUnique({ where: { id }, include: { _count: { select: { asignaciones: true } } } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (actual._count.asignaciones > 0) {
    // Se niega por el total, pero el número que se dice es el de su alcance.
    const suyas = await prisma.asignacionTurno.count({ where: { AND: [{ turnoId: id }, filtroPorEmpleado(g.usuario)] } });
    return NextResponse.json({ error: `El turno tiene ${suyas} asignación(es); desactívelo en lugar de borrarlo.` }, { status: 409 });
  }
  await prisma.turno.delete({ where: { id } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "DELETE", tabla: "Turno", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { codigo: actual.codigo, nombre: actual.nombre }, ip, userAgent });
  return NextResponse.json({ ok: true });
}
