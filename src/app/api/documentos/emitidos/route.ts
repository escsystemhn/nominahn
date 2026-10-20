/**
 * Documentos emitidos.
 *   GET  → historial (?empleadoId=)
 *   POST → emitir { plantillaId, empleadoId, destinatario? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { emitir, ErrorDocumento } from "@/lib/documentos/emision";

const schema = z.object({
  plantillaId: zId,
  empleadoId: zId,
  destinatario: z.string().trim().max(200).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("documentos.emitir");
  if (!g.ok) return g.response;
  const empleadoId = new URL(req.url).searchParams.get("empleadoId") || undefined;
  const emitidos = await prisma.documentoEmitido.findMany({
    where: empleadoId ? { empleadoId } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, folio: true, titulo: true, destinatario: true, porAutoservicio: true, anulado: true, createdAt: true, emitidoPor: true,
      plantilla: { select: { nombre: true, tipo: true } },
      empleado: { select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
    },
  });
  return NextResponse.json(emitidos);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("documentos.emitir");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  try {
    const doc = await emitir(prisma, { ...parsed.data, emitidoPor: g.usuario.email ?? g.usuario.id ?? null, porAutoservicio: false });
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "CREATE",
      tabla: "DocumentoEmitido",
      registroId: doc.id,
      usuarioId: g.usuario.id,
      usuarioEmail: g.usuario.email ?? undefined,
      valorNuevo: { folio: doc.folio, plantillaId: doc.plantillaId, empleadoId: doc.empleadoId, destinatario: doc.destinatario },
      ip,
      userAgent,
    });
    return NextResponse.json({ id: doc.id, folio: doc.folio }, { status: 201 });
  } catch (e) {
    if (e instanceof ErrorDocumento) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
