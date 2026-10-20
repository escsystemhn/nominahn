import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zId } from "@/lib/http/validar";

const schema = z.object({
  vacanteId: zId,
  nombre: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
  telefono: z.string().trim().max(40).optional(),
  cvUrl: z.string().trim().max(500).optional(),
  fuente: z.string().trim().max(80).optional(),
  notas: z.string().trim().max(2000).optional(),
});

// POST: registrar un candidato en una vacante.
export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.reclutamiento_gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  const vacante = await prisma.vacante.findUnique({ where: { id: b.vacanteId } });
  if (!vacante) return NextResponse.json({ error: "Vacante no encontrada" }, { status: 404 });

  const candidato = await prisma.candidato.create({
    data: {
      vacanteId: b.vacanteId,
      nombre: b.nombre,
      email: b.email || null,
      telefono: b.telefono ?? null,
      cvUrl: b.cvUrl ?? null,
      fuente: b.fuente ?? null,
      notas: b.notas ?? null,
    },
  });
  return NextResponse.json(candidato, { status: 201 });
}
