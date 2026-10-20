/** Anular una incapacidad (no se borra: puede estar en una planilla ya calculada). */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({ anulada: z.literal(true), motivo: z.string().trim().min(1, "Indique el motivo").max(500) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.incapacidades");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const inc = await prisma.incapacidad.findUnique({ where: { id }, include: { prorrogas: { where: { anulada: false }, select: { id: true } } } });
  if (!inc) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (inc.anulada) return NextResponse.json({ error: "Ya estaba anulada" }, { status: 409 });
  if (inc.prorrogas.length) return NextResponse.json({ error: "Tiene prórrogas vigentes: anule primero las prórrogas." }, { status: 409 });

  const nota = `Anulada el ${new Date().toISOString().slice(0, 10)}: ${parsed.data.motivo}`;
  await prisma.incapacidad.update({ where: { id }, data: { anulada: true, observacion: inc.observacion ? `${inc.observacion}\n${nota}` : nota } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "UPDATE", tabla: "Incapacidad", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { anulada: true, motivo: parsed.data.motivo }, ip, userAgent });
  return NextResponse.json({ ok: true });
}
