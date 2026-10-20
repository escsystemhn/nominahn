import { NextRequest, NextResponse } from "next/server";
import { Prisma, EstadoDotacion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zId, zFecha } from "@/lib/http/validar";

const schema = z.object({
  empleadoId: zId,
  articuloId: zId,
  cantidad: z.coerce.number().int().min(1).optional(),
  talla: z.string().trim().max(20).optional(),
  fechaEntrega: zFecha.optional(),
  observacion: z.string().trim().max(500).optional(),
});

// GET: lista de asignaciones. Filtros: ?empleadoId, ?estado, ?porVencer=<días>
export async function GET(req: NextRequest) {
  const g = await requerirPermiso("talento.dotaciones");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const empleadoId = searchParams.get("empleadoId") || undefined;
  const estado = searchParams.get("estado") || undefined;
  const porVencer = searchParams.get("porVencer");

  const where: Prisma.AsignacionDotacionWhereInput = {};
  if (empleadoId) where.empleadoId = empleadoId;
  if (estado) where.estado = estado as EstadoDotacion;
  if (porVencer != null) {
    const dias = Math.max(0, parseInt(porVencer, 10) || 30);
    const limite = new Date();
    limite.setDate(limite.getDate() + dias);
    where.estado = "ASIGNADO";
    where.fechaVencimiento = { not: null, lte: limite };
  }

  const asignaciones = await prisma.asignacionDotacion.findMany({
    where,
    include: {
      empleado: { select: { primerNombre: true, primerApellido: true, codigo: true } },
      articulo: { select: { nombre: true, categoria: true } },
    },
    orderBy: porVencer != null ? { fechaVencimiento: "asc" } : { fechaEntrega: "desc" },
    take: 300,
  });
  return NextResponse.json(asignaciones);
}

// POST: asignar un artículo a un empleado.
export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.dotaciones_gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { empleadoId, articuloId, cantidad, talla, fechaEntrega, observacion } = parsed.data;

  const articulo = await prisma.articuloDotacion.findUnique({ where: { id: articuloId } });
  if (!articulo) return NextResponse.json({ error: "Artículo no encontrado" }, { status: 404 });

  const entrega = fechaEntrega ?? new Date();

  // Programar reposición según vida útil del artículo.
  let vencimiento: Date | null = null;
  if (articulo.vidaUtilMeses && articulo.vidaUtilMeses > 0) {
    vencimiento = new Date(entrega);
    vencimiento.setMonth(vencimiento.getMonth() + articulo.vidaUtilMeses);
  }

  const asignacion = await prisma.asignacionDotacion.create({
    data: {
      empleadoId,
      articuloId,
      cantidad: cantidad ?? 1,
      talla: articulo.requiereTalla && talla ? talla : null,
      fechaEntrega: entrega,
      fechaVencimiento: vencimiento,
      observacion: observacion ?? null,
      entregadoPor: g.usuario.id ?? null,
    },
  });
  return NextResponse.json(asignacion, { status: 201 });
}
