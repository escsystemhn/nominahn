/**
 * Disponibilidad y restricciones de horario del personal.
 *   GET ?sucursalId → empleados de la sucursal con sus preferencias
 *   PUT { empleadoId, ... } → guarda las de una persona
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";

const hora = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora con formato HH:MM");
const dias = z.array(z.number().int().min(1).max(7)).max(7);

const schema = z.object({
  empleadoId: zId,
  permiteTraslado: z.boolean(),
  sucursalesTraslado: z.array(zId).max(100),
  noAntesDe: hora.optional().nullable(),
  noDespuesDe: hora.optional().nullable(),
  diasRestriccion: dias,
  soloDiurna: z.boolean(),
  diasNoDisponible: dias,
  diaDescansoPreferido: z.number().int().min(1).max(7).optional().nullable(),
  motivo: z.string().trim().max(200).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const sucursalId = new URL(req.url).searchParams.get("sucursalId") ?? "";
  const empleados = await prisma.empleado.findMany({
    where: { estado: { notIn: ["INACTIVO"] }, ...(sucursalId ? { sucursalId } : {}) },
    select: {
      id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
      fechaNacimiento: true, sucursal: { select: { id: true, nombre: true } }, puesto: { select: { id: true, nombre: true } },
      preferenciaHorario: true,
    },
    orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
  });
  return NextResponse.json(empleados);
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { empleadoId, ...d } = parsed.data;
  const existe = await prisma.empleado.findUnique({ where: { id: empleadoId }, select: { id: true } });
  if (!existe) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const datos = {
    permiteTraslado: d.permiteTraslado,
    sucursalesTraslado: d.permiteTraslado ? d.sucursalesTraslado : [],
    noAntesDe: d.noAntesDe || null,
    noDespuesDe: d.noDespuesDe || null,
    diasRestriccion: [...new Set(d.diasRestriccion)].sort().join(","),
    soloDiurna: d.soloDiurna,
    diasNoDisponible: [...new Set(d.diasNoDisponible)].sort().join(","),
    diaDescansoPreferido: d.diaDescansoPreferido ?? null,
    motivo: d.motivo || null,
  };
  const fila = await prisma.preferenciaHorario.upsert({ where: { empleadoId }, update: datos, create: { empleadoId, ...datos } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "PreferenciaHorario", registroId: empleadoId, usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined, valorNuevo: datos, ip, userAgent,
  });
  return NextResponse.json(fila);
}
