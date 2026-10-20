/**
 * Turnos.
 *   GET  → turnos con cuántos empleados tienen cada uno hoy
 *   POST → crear un turno (validado contra los máximos legales de jornada)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { validarTurno } from "@/lib/asistencia/turnos-reglas";
import { schemaTurno } from "@/lib/asistencia/turnos-esquema";
import { hoyHN } from "@/lib/utils";

export async function GET() {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const hoy = hoyHN();
  const [turnos, vigentes] = await Promise.all([
    prisma.turno.findMany({ orderBy: [{ activo: "desc" }, { nombre: "asc" }] }),
    prisma.asignacionTurno.findMany({
      where: { desde: { lte: hoy }, OR: [{ hasta: null }, { hasta: { gte: hoy } }] },
      orderBy: { desde: "desc" },
      select: { empleadoId: true, turnoId: true },
    }),
  ]);
  // Una persona puede tener varias asignaciones abiertas; manda la más reciente.
  const porEmpleado = new Map<string, string>();
  for (const a of vigentes) if (!porEmpleado.has(a.empleadoId)) porEmpleado.set(a.empleadoId, a.turnoId);
  const conteo = new Map<string, number>();
  for (const t of porEmpleado.values()) conteo.set(t, (conteo.get(t) ?? 0) + 1);
  return NextResponse.json(
    turnos.map((t) => ({ ...t, jornadaHoras: Number(t.jornadaHoras), almuerzoDesdeHoras: Number(t.almuerzoDesdeHoras), empleadosHoy: conteo.get(t.id) ?? 0 }))
  );
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaTurno);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const v = validarTurno(d);
  if (v.errores.length) return NextResponse.json({ error: v.errores.join(" ") }, { status: 422 });
  if (await prisma.turno.findUnique({ where: { codigo: d.codigo } })) {
    return NextResponse.json({ error: `Ya existe un turno con el código ${d.codigo}.` }, { status: 409 });
  }

  const turno = await prisma.$transaction(async (tx) => {
    if (d.esPorDefecto) await tx.turno.updateMany({ data: { esPorDefecto: false } });
    return tx.turno.create({ data: { ...d, esPorDefecto: d.esPorDefecto ?? false, activo: d.activo ?? true } });
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "CREATE", tabla: "Turno", registroId: turno.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: d, ip, userAgent });
  return NextResponse.json({ ...turno, avisos: v.avisos }, { status: 201 });
}
