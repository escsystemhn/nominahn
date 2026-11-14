/**
 * Empleados a los que se puede asignar una deducción, para la ventana «Asignar a
 * varios». Con `tipoDeduccionId`, cada uno dice si ya tiene ese tipo: de cada planilla
 * (con su monto) o con saldo pendiente.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { esMontoDelPeriodo } from "@/lib/payroll/deducciones";
import { resumenExistentes } from "@/lib/payroll/asignacion-masiva";
import { hoyHN, nombreCompleto } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("deducciones.asignar");
  if (!g.ok) return g.response;
  const tipoDeduccionId = new URL(req.url).searchParams.get("tipoDeduccionId");

  const empleados = await prisma.empleado.findMany({
    where: conAlcance({ estado: { in: [...ESTADOS_QUE_COBRAN] } }, g.usuario),
    select: {
      id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
      tipoPlanilla: true,
      sucursal: { select: { id: true, nombre: true } },
      departamento: { select: { id: true, nombre: true } },
      deducciones: tipoDeduccionId
        ? {
          where: { tipoDeduccionId, activo: true, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyHN() } }] },
          select: { id: true, monto: true, saldo: true, cuotasMeses: true, cuotasPagadas: true, fechaFin: true, observacion: true },
        }
        : false,
    },
    orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    take: 5_000,
  });

  return NextResponse.json({
    empleados: empleados.map((e) => {
      const r = resumenExistentes((e.deducciones ?? []).filter((d) => !esMontoDelPeriodo(d)));
      return {
        id: e.id,
        codigo: e.codigo,
        nombre: nombreCompleto(e),
        tipoPlanilla: e.tipoPlanilla,
        sucursal: e.sucursal,
        departamento: e.departamento,
        cadaPlanilla: r.cadaPlanilla ? r.cadaPlanilla.toFixed(2) : null,
        pendiente: r.pendiente ? r.pendiente.toFixed(2) : null,
      };
    }),
  });
}
