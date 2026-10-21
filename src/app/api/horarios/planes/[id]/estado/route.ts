/**
 * Ciclo de vida de un plan de horarios.
 *   POST { accion: "publicar" | "archivar" | "borrador" }
 *
 * PUBLICAR exige cero errores legales: un plan publicado es la fuente del turno
 * de cada día para el reloj y la planilla (turnoDe). Tampoco puede pisar días de
 * otro plan publicado: habría dos verdades para la misma persona y fecha.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { planConValidacion, actualizarResumen } from "@/lib/horarios/bd";

const schema = z.object({ accion: z.enum(["publicar", "archivar", "borrador"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const accion = parsed.data.accion;

  const plan = await prisma.planHorario.findUnique({ where: { id }, select: { id: true, estado: true, nombre: true, desde: true, hasta: true } });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  if (accion === "publicar") {
    if (plan.estado !== "BORRADOR") return NextResponse.json({ error: "Sólo se publica un borrador." }, { status: 409 });
    const r = await planConValidacion(prisma, id);
    if (!r) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
    await actualizarResumen(prisma, id, r.validacion, r.notas);
    const errores = r.validacion.alertas.filter((a) => a.nivel === "ERROR" && a.tipo === "LEGAL");
    if (errores.length) {
      return NextResponse.json({
        error: `El plan tiene ${errores.length} incumplimiento(s) del Código del Trabajo. Corríjalos antes de publicar.`,
        detalle: errores.slice(0, 20).map((a) => a.mensaje),
      }, { status: 422 });
    }
    const empleados = [...new Set(r.dias.map((d) => d.empleadoId))];
    const choques = await prisma.horarioDia.findMany({
      where: { empleadoId: { in: empleados }, fecha: { gte: plan.desde, lte: plan.hasta }, plan: { estado: "PUBLICADO", id: { not: id } } },
      select: { plan: { select: { nombre: true } } },
      distinct: ["planId"],
    });
    if (choques.length) {
      return NextResponse.json({
        error: `Estas personas ya tienen horario publicado en esas fechas: ${choques.map((c) => `«${c.plan.nombre}»`).join(", ")}. Archive ese plan antes de publicar este.`,
      }, { status: 409 });
    }
    await prisma.planHorario.update({ where: { id }, data: { estado: "PUBLICADO", publicadoPor: g.usuario.email ?? null, publicadoAt: new Date() } });
  } else if (accion === "archivar") {
    if (plan.estado === "ARCHIVADO") return NextResponse.json({ error: "Ya está archivado." }, { status: 409 });
    await prisma.planHorario.update({ where: { id }, data: { estado: "ARCHIVADO" } });
  } else {
    if (plan.estado === "BORRADOR") return NextResponse.json({ error: "Ya es un borrador." }, { status: 409 });
    await prisma.planHorario.update({ where: { id }, data: { estado: "BORRADOR", publicadoPor: null, publicadoAt: null } });
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: accion === "publicar" ? "APPROVE" : "UPDATE", tabla: "PlanHorario", registroId: id, usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { estado: plan.estado }, valorNuevo: { accion }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
