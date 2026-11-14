import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TipoEvaluacion } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { aspectosDeEmpleado } from "@/lib/evaluaciones/aspectos-bd";

const consulta = z.object({ empleadoId: z.string().min(1), tipo: z.enum(TipoEvaluacion) });

/**
 * GET /api/evaluaciones/aspectos?empleadoId=…&tipo=… — los aspectos con que se evalúa a
 * ese empleado (los de su puesto, los generales o la lista base) y de dónde salen.
 */
export async function GET(req: NextRequest) {
  const g = await requerirPermiso("talento.evaluaciones_gestionar");
  if (!g.ok) return g.response;

  const p = consulta.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return NextResponse.json({ error: "Indique empleado y tipo de evaluación" }, { status: 400 });

  // Fuera de su alcance responde igual que si no existiera.
  if (!(await empleadoAlAlcance(g.usuario, p.data.empleadoId))) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }
  return NextResponse.json(await aspectosDeEmpleado(prisma, p.data.empleadoId, p.data.tipo));
}
