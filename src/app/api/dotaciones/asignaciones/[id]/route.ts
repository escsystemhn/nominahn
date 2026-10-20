import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";
import { EstadoDotacion } from "@prisma/client";

const schema = z.object({
  estado: z.enum(EstadoDotacion),
  observacion: z.string().trim().max(500).nullish(),
});

// PATCH: cambiar estado de una asignación (devolución, reposición, baja).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.dotaciones_gestionar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { estado, observacion } = parsed.data;

  const existe = await prisma.asignacionDotacion.findUnique({ where: { id } });
  if (!existe) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const asignacion = await prisma.asignacionDotacion.update({
    where: { id },
    data: {
      estado,
      ...(observacion !== undefined ? { observacion: observacion || null } : {}),
    },
  });
  return NextResponse.json(asignacion);
}
