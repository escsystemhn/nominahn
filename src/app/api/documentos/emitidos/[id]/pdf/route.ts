/**
 * PDF de un documento emitido. Lo descarga quien emite documentos o el propio
 * empleado al que pertenece (sus constancias de autoservicio).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { pdfDeEmitido, ErrorDocumento } from "@/lib/documentos/emision";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const { id } = await params;

  const doc = await prisma.documentoEmitido.findUnique({ where: { id }, select: { empleadoId: true } });
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const esPropio = !!g.usuario.empleadoId && g.usuario.empleadoId === doc.empleadoId;
  if (!esPropio && !puede(g.usuario, "documentos.emitir")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  try {
    const { buffer, folio } = await pdfDeEmitido(prisma, id);
    const ver = new URL(req.url).searchParams.get("modo") === "ver";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${ver ? "inline" : "attachment"}; filename="documento-${folio}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ErrorDocumento) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
