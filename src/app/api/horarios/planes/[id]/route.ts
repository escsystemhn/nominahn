/**
 * Un plan de horarios.
 *   GET    → el plan con su validación al día (matriz, resumen, alertas, faltantes)
 *   PATCH  { cambios: [...] } → edita días de un BORRADOR y devuelve la nueva validación
 *   DELETE → borra un BORRADOR
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { planConValidacion, actualizarResumen, aFecha, ymd } from "@/lib/horarios/bd";
import { jornadaDeHoras } from "@/lib/horarios/ley";

const hora = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora con formato HH:MM");
const schema = z.object({
  cambios: z.array(z.object({
    empleadoId: zId,
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    estado: z.enum(["TURNO", "DESCANSO", "AUSENCIA"]),
    turnoId: zId.optional().nullable(),
    entrada: hora.optional().nullable(),
    salida: hora.optional().nullable(),
    pausa: z.coerce.number().int().min(0).max(240).optional(),
    sucursalId: zId.optional().nullable(),
    motivo: z.string().trim().max(200).optional().nullable(),
  })).min(1).max(500),
});

async function respuesta(id: string) {
  const r = await planConValidacion(prisma, id);
  if (!r) return null;
  const { plan, ctx, validacion, notas } = r;
  return {
    plan: {
      id: plan.id, nombre: plan.nombre, desde: ymd(plan.desde), hasta: ymd(plan.hasta), estado: plan.estado,
      sucursalesIds: plan.sucursalesIds, reglas: ctx.reglas, creadoPor: plan.creadoPor, publicadoPor: plan.publicadoPor, publicadoAt: plan.publicadoAt,
    },
    empleados: ctx.empleados,
    sucursales: ctx.sucursales,
    puestos: ctx.nombres.puestos,
    turnos: ctx.turnos.map(({ id: tid, codigo, nombre, entrada, salida, pausa }) => ({ id: tid, codigo, nombre, entrada, salida, pausa })),
    horarioAtencion: ctx.horarioAtencion,
    feriados: ctx.feriados,
    validacion,
    notas,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const { id } = await params;
  const r = await respuesta(id);
  if (!r) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const plan = await prisma.planHorario.findUnique({ where: { id }, select: { estado: true, desde: true, hasta: true, sucursalesIds: true } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (plan.estado !== "BORRADOR") return NextResponse.json({ error: "Sólo se edita un borrador. Vuelva el plan a borrador para cambiarlo." }, { status: 409 });

  const empleados = new Map((await prisma.empleado.findMany({
    where: { id: { in: parsed.data.cambios.map((c) => c.empleadoId) } }, select: { id: true, sucursalId: true },
  })).map((e) => [e.id, e]));
  const turnos = new Map((await prisma.turno.findMany({ where: { activo: true } })).map((t) => [t.id, t]));

  type Datos = {
    estado: "TURNO" | "DESCANSO" | "AUSENCIA"; manual: boolean; turnoId: string | null; entrada: number | null; salida: number | null;
    pausa: number; sucursalId: string | null; esTraslado: boolean; motivo: string | null;
  };
  const filas: { empleadoId: string; fecha: string; datos: Datos }[] = [];
  for (const c of parsed.data.cambios) {
    const emp = empleados.get(c.empleadoId);
    if (!emp) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
    if (c.fecha < ymd(plan.desde) || c.fecha > ymd(plan.hasta)) return NextResponse.json({ error: `La fecha ${c.fecha} está fuera del plan` }, { status: 400 });
    const base: Datos = { estado: c.estado, manual: true, turnoId: null, entrada: null, salida: null, pausa: 0, sucursalId: null, esTraslado: false, motivo: c.motivo || null };
    if (c.estado === "TURNO") {
      const turno = c.turnoId ? turnos.get(c.turnoId) : undefined;
      if (c.turnoId && !turno) return NextResponse.json({ error: "Turno no encontrado o inactivo" }, { status: 400 });
      const entrada = c.entrada || turno?.horaEntrada;
      const salida = c.salida || turno?.horaSalida;
      if (!entrada || !salida) return NextResponse.json({ error: "Indique un turno o la hora de entrada y de salida" }, { status: 400 });
      const lapsoTurno = turno ? jornadaDeHoras(turno.horaEntrada, turno.horaSalida, 0) : null;
      const pausaTurno = turno && lapsoTurno && lapsoTurno.salida - lapsoTurno.entrada >= Number(turno.almuerzoDesdeHoras) * 60 ? turno.almuerzoMinutos : 0;
      const j = jornadaDeHoras(entrada, salida, c.pausa ?? pausaTurno);
      if (!j) return NextResponse.json({ error: "Horas inválidas" }, { status: 400 });
      const sucursalId = c.sucursalId || emp.sucursalId;
      if (!plan.sucursalesIds.includes(sucursalId)) return NextResponse.json({ error: "La sucursal no está en este plan" }, { status: 400 });
      Object.assign(base, { turnoId: turno?.id ?? null, entrada: j.entrada, salida: j.salida, pausa: j.pausa, sucursalId, esTraslado: sucursalId !== emp.sucursalId, motivo: null });
    }
    filas.push({ empleadoId: c.empleadoId, fecha: c.fecha, datos: base });
  }

  await prisma.$transaction(async (tx) => {
    for (const f of filas) {
      await tx.horarioDia.upsert({
        where: { planId_empleadoId_fecha: { planId: id, empleadoId: f.empleadoId, fecha: aFecha(f.fecha) } },
        update: f.datos,
        create: { planId: id, empleadoId: f.empleadoId, fecha: aFecha(f.fecha), ...f.datos },
      });
    }
  });

  const r = await respuesta(id);
  if (r) await actualizarResumen(prisma, id, r.validacion, r.notas);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "PlanHorario", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { cambios: parsed.data.cambios }, ip, userAgent,
  });
  return NextResponse.json(r);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const { id } = await params;
  const plan = await prisma.planHorario.findUnique({ where: { id }, select: { estado: true, nombre: true } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (plan.estado === "PUBLICADO") {
    return NextResponse.json({ error: "Un plan publicado no se borra: archívelo (la planilla puede haber usado sus horarios)." }, { status: 409 });
  }
  await prisma.planHorario.delete({ where: { id } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "DELETE", tabla: "PlanHorario", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: plan, ip, userAgent });
  return NextResponse.json({ ok: true });
}
