/** Anular un documento emitido: conserva su folio y sale con marca de agua. */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({ anulado: z.literal(true) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("documentos.emitir");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const doc = await prisma.documentoEmitido.findUnique({ where: { id }, select: { id: true, folio: true, anulado: true } });
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (doc.anulado) return NextResponse.json({ error: "Ya estaba anulado" }, { status: 409 });
  await prisma.documentoEmitido.update({ where: { id }, data: { anulado: true } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "UPDATE", tabla: "DocumentoEmitido", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { folio: doc.folio, anulado: true }, ip, userAgent });
  return NextResponse.json({ ok: true });
}
