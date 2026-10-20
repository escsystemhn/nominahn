import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const asignarSchema = z.object({
  competenciaId: z.string(),
  nivelRequerido: z.enum(["INICIAL", "BASICO", "INTERMEDIO", "AVANZADO", "EXPERTO"]),
  peso: z.number().min(0.1).max(10).default(1),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: puestoId } = await params;
  const competencias = await prisma.puestoCompetencia.findMany({
    where: { puestoId, activa: true },
    include: { competencia: true },
    orderBy: { peso: "desc" },
  });
  return NextResponse.json(competencias);
}

export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const { id: puestoId } = await params;
  const body = await req.json();
  const parsed = asignarSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { competenciaId, nivelRequerido, peso } = parsed.data;

  const pc = await prisma.puestoCompetencia.upsert({
    where: { puestoId_competenciaId: { puestoId, competenciaId } },
    update: { nivelRequerido, peso, activa: true },
    create: { puestoId, competenciaId, nivelRequerido, peso },
  });

  return NextResponse.json(pc, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const { id: puestoId } = await params;
  const { searchParams } = new URL(req.url);
  const competenciaId = searchParams.get("competenciaId");

  if (!competenciaId) return NextResponse.json({ error: "competenciaId requerido" }, { status: 400 });

  await prisma.puestoCompetencia.updateMany({
    where: { puestoId, competenciaId },
    data: { activa: false },
  });

  return NextResponse.json({ ok: true });
}
