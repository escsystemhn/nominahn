/**
 * Asignación de turnos.
 *   GET  → turno vigente de cada empleado activo (?fecha=AAAA-MM-DD, por omisión hoy)
 *   POST → { turnoId, desde, empleadoIds? | departamentoId? | sucursalId? }
 *
 * Asignar cierra la asignación abierta anterior del empleado el día antes de
 * `desde`: así el historial dice qué turno tenía cada día y los marcajes
 * viejos se pueden recalcular con el turno que les tocaba.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha, zId } from "@/lib/http/validar";
import { hoyHN, fechaCalendario } from "@/lib/utils";

const schema = z
  .object({
    turnoId: zId,
    desde: zFecha,
    empleadoIds: z.array(zId).max(2000).optional(),
    departamentoId: zId.optional(),
    sucursalId: zId.optional(),
  })
  .refine((d) => (d.empleadoIds?.length ?? 0) > 0 || d.departamentoId || d.sucursalId, { error: "Elija empleados, un departamento o una sucursal" });

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const f = new URL(req.url).searchParams.get("fecha");
  const fecha = f ? fechaCalendario(f) : hoyHN();

  const [empleados, asignaciones, porDefecto] = await Promise.all([
    prisma.empleado.findMany({
      where: { estado: { not: "INACTIVO" } },
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        departamento: { select: { id: true, nombre: true } }, sucursal: { select: { id: true, nombre: true } },
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    }),
    prisma.asignacionTurno.findMany({
      where: { desde: { lte: fecha }, OR: [{ hasta: null }, { hasta: { gte: fecha } }] },
      orderBy: { desde: "desc" },
      select: { empleadoId: true, desde: true, turno: { select: { id: true, nombre: true, codigo: true } } },
    }),
    prisma.turno.findFirst({ where: { esPorDefecto: true, activo: true }, select: { id: true, nombre: true, codigo: true } }),
  ]);
  const vigente = new Map<string, (typeof asignaciones)[number]>();
  for (const a of asignaciones) if (!vigente.has(a.empleadoId)) vigente.set(a.empleadoId, a);

  return NextResponse.json({
    fecha,
    porDefecto,
    empleados: empleados.map((e) => {
      const a = vigente.get(e.id);
      return { ...e, turno: a?.turno ?? null, desde: a?.desde ?? null, origen: a ? "ASIGNADO" : porDefecto ? "POR_DEFECTO" : "DIURNO_IMPLICITO" };
    }),
  });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const turno = await prisma.turno.findUnique({ where: { id: d.turnoId }, select: { id: true, activo: true, nombre: true } });
  if (!turno || !turno.activo) return NextResponse.json({ error: "El turno no existe o está desactivado" }, { status: 404 });

  const empleados = await prisma.empleado.findMany({
    where: {
      estado: { not: "INACTIVO" },
      ...(d.empleadoIds?.length ? { id: { in: d.empleadoIds } } : {}),
      ...(d.departamentoId ? { departamentoId: d.departamentoId } : {}),
      ...(d.sucursalId ? { sucursalId: d.sucursalId } : {}),
    },
    select: { id: true },
  });
  if (empleados.length === 0) return NextResponse.json({ error: "Ningún empleado activo coincide con la selección" }, { status: 400 });

  const ids = empleados.map((e) => e.id);
  const diaAnterior = new Date(d.desde.getTime() - 86_400_000);

  await prisma.$transaction(async (tx) => {
    // Las asignaciones que empezaban en la misma fecha o después se reemplazan.
    await tx.asignacionTurno.deleteMany({ where: { empleadoId: { in: ids }, desde: { gte: d.desde } } });
    // Las abiertas o que cruzan la fecha se cierran el día anterior.
    await tx.asignacionTurno.updateMany({
      where: { empleadoId: { in: ids }, desde: { lt: d.desde }, OR: [{ hasta: null }, { hasta: { gte: d.desde } }] },
      data: { hasta: diaAnterior },
    });
    await tx.asignacionTurno.createMany({
      data: ids.map((empleadoId) => ({ empleadoId, turnoId: d.turnoId, desde: d.desde, creadoPor: g.usuario.email ?? g.usuario.id ?? null })),
    });
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "UPDATE", tabla: "AsignacionTurno", registroId: d.turnoId, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { turno: turno.nombre, desde: d.desde, empleados: ids.length, departamentoId: d.departamentoId, sucursalId: d.sucursalId }, ip, userAgent });
  return NextResponse.json({ ok: true, asignados: ids.length }, { status: 201 });
}
