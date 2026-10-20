import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";

// GET: lista las boletas (detalles de planilla pagada/aprobada) del empleado autenticado.
export async function GET() {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json([]);

  const boletas = await prisma.planillaDetalle.findMany({
    where: {
      empleadoId,
      planilla: { estado: { in: ["APROBADA", "PAGADA"] } },
    },
    select: {
      id: true,
      totalBruto: true,
      totalDeducciones: true,
      salarioNeto: true,
      planilla: { select: { tipo: true, fechaInicio: true, fechaFin: true, fechaPago: true, estado: true } },
    },
    orderBy: { planilla: { fechaFin: "desc" } },
    take: 60,
  });

  return NextResponse.json(boletas);
}
