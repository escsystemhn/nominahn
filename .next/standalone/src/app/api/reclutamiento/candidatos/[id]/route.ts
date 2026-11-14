import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";
import { EtapaCandidato } from "@prisma/client";

const schema = z
  .object({
    etapa: z.enum(EtapaCandidato).optional(),
    notas: z.string().trim().max(2000).nullish(),
  })
  .refine((d) => d.etapa !== undefined || d.notas !== undefined, { error: "Sin cambios" });

// PATCH: mover al candidato de etapa en el pipeline (o actualizar notas).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.reclutamiento_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { etapa, notas } = parsed.data;

  const candidato = await prisma.candidato.update({
    where: { id },
    data: {
      ...(etapa !== undefined ? { etapa } : {}),
      ...(notas !== undefined ? { notas: notas || null } : {}),
    },
  });
  return NextResponse.json(candidato);
}
