import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";

const crearSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  categoria: z.enum(["CORE", "LIDERAZGO", "TECNICA", "COMPORTAMIENTO"]).default("CORE"),
});

export async function GET() {
  const competencias = await prisma.competenciaDefinicion.findMany({
    where: { activa: true },
    include: { _count: { select: { puestosCompetencia: true } } },
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json(competencias);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const body = await req.json();
  const parsed = crearSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const comp = await prisma.competenciaDefinicion.create({ data: parsed.data });
  return NextResponse.json(comp, { status: 201 });
}
