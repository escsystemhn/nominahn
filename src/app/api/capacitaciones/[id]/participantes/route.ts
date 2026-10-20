import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zId } from "@/lib/http/validar";

const schemaInscribir = z.object({ empleadoId: zId });

const schemaCalificar = z
  .object({
    participanteId: zId,
    asistio: z.boolean().optional(),
    aprobado: z.boolean().nullable().optional(),
    calificacion: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().min(0).max(100).nullable()
    ).optional(),
  })
  .refine((d) => d.asistio !== undefined || d.aprobado !== undefined || d.calificacion !== undefined, {
    error: "Sin cambios",
  });

// POST: inscribir un empleado en la capacitación.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaInscribir);
  if (!parsed.ok) return parsed.response;
  const { empleadoId } = parsed.data;

  try {
    const p = await prisma.participanteCapacitacion.create({
      data: { capacitacionId: id, empleadoId },
    });
    return NextResponse.json(p, { status: 201 });
  } catch {
    return NextResponse.json({ error: "El empleado ya está inscrito" }, { status: 409 });
  }
}

// PATCH: actualizar asistencia/aprobación/calificación de un participante.
export async function PATCH(req: NextRequest) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaCalificar);
  if (!parsed.ok) return parsed.response;
  const { participanteId, asistio, aprobado, calificacion } = parsed.data;

  const p = await prisma.participanteCapacitacion.update({
    where: { id: participanteId },
    data: {
      ...(asistio !== undefined && { asistio }),
      ...(aprobado !== undefined && { aprobado }),
      ...(calificacion !== undefined && { calificacion }),
    },
  });
  return NextResponse.json(p);
}
