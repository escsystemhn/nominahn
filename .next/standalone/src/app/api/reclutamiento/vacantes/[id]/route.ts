import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";
import { EstadoVacante } from "@prisma/client";

const schemaPatch = z
  .object({
    estado: z.enum(EstadoVacante).optional(),
    /** Publicar o retirar del portal público /empleos. */
    publicada: z.boolean().optional(),
  })
  .refine((d) => d.estado !== undefined || d.publicada !== undefined, { error: "Nada que cambiar" });

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.reclutamiento");
  if (!g.ok) return g.response;
  const { id } = await params;
  const vacante = await prisma.vacante.findUnique({
    where: { id },
    include: {
      departamento: { select: { nombre: true } },
      candidatos: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!vacante) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(vacante);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.reclutamiento_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaPatch);
  if (!parsed.ok) return parsed.response;
  const { estado, publicada } = parsed.data;

  const actual = await prisma.vacante.findUnique({ where: { id }, select: { esInterna: true } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (publicada && actual.esInterna) {
    return NextResponse.json({ error: "Una convocatoria interna no se publica en el portal de empleo" }, { status: 409 });
  }

  const vacante = await prisma.vacante.update({
    where: { id },
    data: {
      ...(estado ? { estado } : {}),
      ...(publicada !== undefined ? { publicada } : {}),
      ...(estado === "CERRADA" ? { fechaCierre: new Date() } : {}),
    },
  });
  return NextResponse.json(vacante);
}
