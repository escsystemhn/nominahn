/**
 * Planes de horarios rotativos.
 *   GET  → lista de planes
 *   POST { nombre?, desde, hasta, sucursalesIds } → genera y guarda un BORRADOR
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { crearPlan, ymd } from "@/lib/horarios/bd";
import { diasEntre, periodoTexto } from "@/lib/horarios/fechas";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");

const schema = z.object({
  nombre: z.string().trim().max(120).optional(),
  desde: fecha,
  hasta: fecha,
  sucursalesIds: z.array(zId).min(1, "Elija al menos una sucursal").max(50),
}).refine((d) => d.hasta >= d.desde, { error: "La fecha final no puede ser anterior a la inicial" })
  .refine((d) => diasEntre(d.desde, d.hasta) <= 62, { error: "Un plan puede cubrir hasta dos meses" });

export async function GET() {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const [planes, sucursales] = await Promise.all([
    prisma.planHorario.findMany({
      orderBy: [{ desde: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, nombre: true, desde: true, hasta: true, estado: true, sucursalesIds: true, resumen: true, publicadoAt: true, createdAt: true, _count: { select: { dias: true } } },
    }),
    prisma.sucursal.findMany({ select: { id: true, nombre: true } }),
  ]);
  const nombre = new Map(sucursales.map((s) => [s.id, s.nombre]));
  return NextResponse.json(planes.map((p) => ({
    ...p, desde: ymd(p.desde), hasta: ymd(p.hasta), sucursales: p.sucursalesIds.map((id) => nombre.get(id) ?? id),
  })));
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const sucursales = await prisma.sucursal.findMany({ where: { id: { in: d.sucursalesIds } }, select: { id: true, nombre: true } });
  if (sucursales.length !== new Set(d.sucursalesIds).size) return NextResponse.json({ error: "Alguna sucursal no existe" }, { status: 400 });
  const turnos = await prisma.turno.count({ where: { activo: true } });
  if (!turnos) return NextResponse.json({ error: "No hay turnos activos: créelos primero en «Catálogo de turnos»." }, { status: 422 });
  const cobertura = await prisma.coberturaSucursal.count({ where: { sucursalId: { in: d.sucursalesIds }, activo: true } });
  if (!cobertura) return NextResponse.json({ error: "Las sucursales elegidas no tienen cobertura mínima definida: configúrela primero en «Cobertura»." }, { status: 422 });

  const nombre = d.nombre || `Horario del ${periodoTexto(d.desde, d.hasta)}`;
  const { id, resumen } = await crearPlan(prisma, { nombre, desde: d.desde, hasta: d.hasta, sucursalesIds: d.sucursalesIds, creadoPor: g.usuario.email ?? null });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE", tabla: "PlanHorario", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { nombre, desde: d.desde, hasta: d.hasta, sucursales: sucursales.map((s) => s.nombre), errores: resumen.errores, faltantes: resumen.faltantes },
    ip, userAgent,
  });
  return NextResponse.json({ id, resumen }, { status: 201 });
}
