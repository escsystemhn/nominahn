import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zEnteroNoNeg } from "@/lib/http/validar";
import { CategoriaDotacion } from "@prisma/client";

const schema = z.object({
  nombre: z.string().trim().min(1).max(120),
  categoria: z.enum(CategoriaDotacion).optional(),
  descripcion: z.string().trim().max(500).optional(),
  requiereTalla: z.boolean().optional(),
  vidaUtilMeses: zEnteroNoNeg.optional(),
});

export async function GET() {
  const g = await requerirPermiso("talento.dotaciones");
  if (!g.ok) return g.response;

  const articulos = await prisma.articuloDotacion.findMany({
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  return NextResponse.json(articulos);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.dotaciones_gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { nombre, categoria, descripcion, requiereTalla, vidaUtilMeses } = parsed.data;

  const articulo = await prisma.articuloDotacion.create({
    data: {
      nombre,
      categoria: categoria ?? "OTRO",
      descripcion: descripcion ?? null,
      requiereTalla: requiereTalla ?? false,
      vidaUtilMeses: vidaUtilMeses ?? null,
    },
  });
  return NextResponse.json(articulo, { status: 201 });
}
