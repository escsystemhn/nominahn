import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { filtroCapacitaciones, filtroCapacitacionesCompletas } from "@/lib/capacitaciones/alcance";
import { nombreCompleto } from "@/lib/utils";
import { z } from "zod";
import { parsearBody, zMonto } from "@/lib/http/validar";
import { EstadoCapacitacion } from "@prisma/client";

const schemaPatch = z
  .object({
    estado: z.enum(EstadoCapacitacion).optional(),
    costoReal: zMonto.nullable().optional(),
  })
  .refine((d) => d.estado !== undefined || d.costoReal !== undefined, { error: "Sin cambios" });

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.capacitaciones");
  if (!g.ok) return g.response;
  const { id } = await params;
  // Fuera de su alcance responde igual que si no existiera; de las demás, sólo su gente.
  const cap = await prisma.capacitacion.findFirst({
    where: { AND: [{ id }, filtroCapacitaciones(g.usuario)] },
    include: {
      participantes: {
        where: filtroPorEmpleado(g.usuario),
        include: { empleado: { select: { primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, codigo: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!cap) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const participantes = cap.participantes.map((p) => ({
    id: p.id,
    empleadoId: p.empleadoId,
    nombre: nombreCompleto(p.empleado),
    codigo: p.empleado.codigo,
    asistio: p.asistio,
    aprobado: p.aprobado,
    calificacion: p.calificacion,
    observacion: p.observacion,
  }));
  return NextResponse.json({ ...cap, participantes });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaPatch);
  if (!parsed.ok) return parsed.response;
  const { estado, costoReal } = parsed.data;

  // Fuera de su alcance responde igual que si no existiera (ver lib/capacitaciones/alcance.ts).
  if (!(await prisma.capacitacion.count({ where: { AND: [{ id }, filtroCapacitaciones(g.usuario)] } }))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (!(await prisma.capacitacion.count({ where: { AND: [{ id }, filtroCapacitacionesCompletas(g.usuario)] } }))) {
    return NextResponse.json({ error: "Esta capacitación incluye personal fuera del alcance de su cuenta: sólo puede consultarla." }, { status: 403 });
  }

  const cap = await prisma.capacitacion.update({
    where: { id },
    data: {
      ...(estado !== undefined && { estado }),
      ...(costoReal !== undefined && { costoReal }),
    },
  });
  return NextResponse.json(cap);
}
