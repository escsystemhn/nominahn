import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zId, zMonto } from "@/lib/http/validar";
import { EstadoVacante, TipoContrato } from "@prisma/client";

const schema = z
  .object({
    titulo: z.string().trim().min(1).max(150),
    descripcion: z.string().trim().max(4000).optional(),
    requisitos: z.string().trim().max(4000).optional(),
    departamentoId: zId.nullable().optional(),
    tipoContrato: z.enum(TipoContrato).optional(),
    salarioMin: zMonto.optional(),
    salarioMax: zMonto.optional(),
    plazas: z.coerce.number().int().min(1).optional(),
    esInterna: z.boolean().optional(),
    /** Visible en el portal público /empleos. */
    publicada: z.boolean().optional(),
    estado: z.enum(EstadoVacante).optional(),
  })
  .refine((d) => !(d.publicada && d.esInterna), {
    error: "Una convocatoria interna no se publica en el portal de empleo",
    path: ["publicada"],
  })
  .refine((d) => d.salarioMin === undefined || d.salarioMax === undefined || d.salarioMax >= d.salarioMin, {
    error: "El salario máximo no puede ser menor que el mínimo",
    path: ["salarioMax"],
  });

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("talento.reclutamiento");
  if (!g.ok) return g.response;
  const estado = new URL(req.url).searchParams.get("estado") || undefined;

  const vacantes = await prisma.vacante.findMany({
    where: estado ? { estado: estado as EstadoVacante } : {},
    include: {
      departamento: { select: { nombre: true } },
      _count: { select: { candidatos: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(vacantes);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.reclutamiento_gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.data;

  const vacante = await prisma.vacante.create({
    data: {
      titulo: b.titulo,
      descripcion: b.descripcion ?? null,
      requisitos: b.requisitos ?? null,
      departamentoId: b.departamentoId ?? null,
      tipoContrato: b.tipoContrato ?? "INDEFINIDO",
      salarioMin: b.salarioMin ?? null,
      salarioMax: b.salarioMax ?? null,
      plazas: b.plazas ?? 1,
      esInterna: b.esInterna ?? false,
      publicada: b.publicada ?? false,
      estado: b.estado ?? "ABIERTA",
      creadoPor: g.usuario.id ?? null,
    },
  });
  return NextResponse.json(vacante, { status: 201 });
}
