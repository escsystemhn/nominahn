/** El estado de un respaldo: lo consulta la pantalla mientras «Respaldar ahora» corre en segundo plano. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  const { id } = await params;
  const r = await prisma.respaldo.findUnique({
    where: { id },
    select: { id: true, tipo: true, estado: true, archivo: true, tamano: true, destinos: true, error: true, duracionMs: true, createdAt: true },
  });
  if (!r) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ...r, tamano: r.tamano === null ? null : Number(r.tamano) }, { headers: { "Cache-Control": "no-store" } });
}
