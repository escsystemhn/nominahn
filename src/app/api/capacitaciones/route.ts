import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zFecha, zMonto } from "@/lib/http/validar";
import { TipoCapacitacion } from "@prisma/client";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  descripcion: z.string().trim().max(2000).optional(),
  tipo: z.enum(TipoCapacitacion).optional(),
  proveedor: z.string().trim().max(150).optional(),
  fechaInicio: zFecha,
  fechaFin: zFecha.optional(),
  costoPresupuestado: zMonto.optional(),
});

export async function GET() {
  const g = await requerirPermiso("talento.capacitaciones");
  if (!g.ok) return g.response;
  const capacitaciones = await prisma.capacitacion.findMany({
    include: { _count: { select: { participantes: true } } },
    orderBy: { fechaInicio: "desc" },
  });
  return NextResponse.json(capacitaciones);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { nombre, descripcion, tipo, proveedor, fechaInicio, fechaFin, costoPresupuestado } = parsed.data;

  const capacitacion = await prisma.capacitacion.create({
    data: {
      nombre,
      descripcion: descripcion ?? null,
      tipo: tipo ?? "INTERNA",
      proveedor: proveedor ?? null,
      fechaInicio,
      fechaFin: fechaFin ?? null,
      costoPresupuestado: costoPresupuestado ?? 0,
      creadoPor: g.usuario.id ?? null,
    },
  });
  return NextResponse.json(capacitacion, { status: 201 });
}
