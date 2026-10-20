/**
 * Constancias en autoservicio: el empleado ve las plantillas habilitadas para
 * él y emite la suya. Sólo para sí mismo y sólo plantillas `autoservicio`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { asegurarPlantillas, emitir, ErrorDocumento } from "@/lib/documentos/emision";

const schema = z.object({
  plantillaId: zId,
  destinatario: z.string().trim().max(200).optional().nullable(),
});

export async function GET() {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ plantillas: [], emitidos: [] });
  await asegurarPlantillas(prisma);
  const [plantillas, emitidos] = await Promise.all([
    prisma.plantillaDocumento.findMany({ where: { autoservicio: true, activo: true }, select: { id: true, nombre: true, tipo: true }, orderBy: { nombre: "asc" } }),
    prisma.documentoEmitido.findMany({
      where: { empleadoId, anulado: false },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, folio: true, titulo: true, destinatario: true, createdAt: true },
    }),
  ]);
  return NextResponse.json({ plantillas, emitidos });
}

export async function POST(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ error: "Su usuario no está vinculado a un empleado." }, { status: 400 });
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  try {
    const doc = await emitir(prisma, { ...parsed.data, empleadoId, emitidoPor: g.usuario.email ?? g.usuario.id ?? null, porAutoservicio: true });
    const { ip, userAgent } = getClientInfo(req);
    await audit({ accion: "CREATE", tabla: "DocumentoEmitido", registroId: doc.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { folio: doc.folio, autoservicio: true }, ip, userAgent });
    return NextResponse.json({ id: doc.id, folio: doc.folio }, { status: 201 });
  } catch (e) {
    if (e instanceof ErrorDocumento) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
