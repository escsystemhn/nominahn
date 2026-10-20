import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";

// GET: una política con todo su historial de versiones (más reciente primero).
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;
  const politica = await prisma.politica.findUnique({
    where: { id },
    include: { versiones: { orderBy: { numero: "desc" } } },
  });
  if (!politica) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(politica);
}
