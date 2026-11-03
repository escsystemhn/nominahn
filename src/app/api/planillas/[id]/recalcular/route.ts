/**
 * Recalcular un borrador con los datos actuales: horas, deducciones, salarios y
 * personal. Reemplaza sus líneas sin cobrar nada y sin dejar una planilla anulada
 * por el camino. Es lo que hace útil revisar antes de confirmar.
 */

import { NextRequest, NextResponse } from "next/server";
import { accesoAPlanilla, rechazoDeAcceso } from "@/lib/payroll/alcance-planilla";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { calcularLineas, escribirLineas } from "@/lib/payroll/calculo-planilla-bd";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("planillas.calcular");
  if (!g.ok) return g.response;

  const { id } = await params;
  const planilla = await prisma.planilla.findUnique({ where: { id } });
  if (!planilla) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const rechazo = rechazoDeAcceso(await accesoAPlanilla(prisma, g.usuario, id));
  if (rechazo) return rechazo;
  if (planilla.estado !== "BORRADOR") {
    return NextResponse.json({ error: "Sólo se recalcula una planilla en borrador." }, { status: 409 });
  }

  const calculo = await calcularLineas(planilla);
  if (!calculo.ok) return NextResponse.json(calculo.cuerpo, { status: calculo.status });

  await prisma.$transaction((tx) => escribirLineas(tx, id, calculo), { timeout: 30000 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Planilla",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { totalBruto: planilla.totalBruto, totalDeducciones: planilla.totalDeducciones, totalNeto: planilla.totalNeto, totalEmpleador: planilla.totalEmpleador },
    valorNuevo: { ...calculo.totales, empleados: calculo.detalles.length, recalculada: true },
    ip,
    userAgent,
  });

  return NextResponse.json({ netoAnterior: planilla.totalNeto, netoNuevo: calculo.totales.totalNeto, empleados: calculo.detalles.length });
}
