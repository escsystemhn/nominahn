import type { Prisma, PrismaClient } from "@prisma/client";
import { correoDeComprobantes } from "@/lib/email/destinatario";
import { nombreCompleto } from "@/lib/utils";
import { revisarPlanilla, type LineaRevision, type RevisionPlanilla } from "./revision-planilla";

const CAMPOS_LINEA = {
  empleadoId: true,
  salarioBase: true,
  diasTrabajados: true,
  horasExtra: true,
  totalBruto: true,
  totalDeducciones: true,
  salarioNeto: true,
  empleado: {
    select: {
      primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
      cuentaBancaria: true, emailPersonal: true, emailCorporativo: true,
      user: { select: { email: true } },
    },
  },
} satisfies Prisma.PlanillaDetalleSelect;

type Fila = Prisma.PlanillaDetalleGetPayload<{ select: typeof CAMPOS_LINEA }>;

function aLinea(f: Fila): LineaRevision {
  return {
    empleadoId: f.empleadoId,
    nombre: nombreCompleto(f.empleado),
    salarioBase: f.salarioBase,
    diasTrabajados: f.diasTrabajados,
    horasExtra: f.horasExtra,
    totalBruto: f.totalBruto,
    totalDeducciones: f.totalDeducciones,
    salarioNeto: f.salarioNeto,
    tieneCuenta: !!f.empleado.cuentaBancaria?.trim(),
    tieneCorreo: !!correoDeComprobantes(f.empleado),
  };
}

export interface PlanillaAnterior {
  id: string;
  fechaInicio: Date;
  fechaFin: Date;
}

/**
 * Revisión de una planilla contra la anterior comparable: mismo tipo y mismo alcance,
 * ya confirmada, y terminada antes de que empiece esta. Un borrador no cuenta (todavía
 * puede cambiar) y una anulada tampoco (no se pagó).
 *
 * Trabaja sobre TODAS las líneas, sin importar el filtro que se esté viendo en pantalla.
 */
export async function cargarRevision(
  db: Pick<PrismaClient, "planilla" | "planillaDetalle">,
  planilla: { id: string; tipo: Prisma.PlanillaWhereInput["tipo"]; fechaInicio: Date; sucursalId: string | null; divisionId: string | null; departamentoId: string | null }
): Promise<{ revision: RevisionPlanilla; anterior: PlanillaAnterior | null }> {
  const [actual, anterior] = await Promise.all([
    db.planillaDetalle.findMany({ where: { planillaId: planilla.id }, select: CAMPOS_LINEA }),
    db.planilla.findFirst({
      where: {
        id: { not: planilla.id },
        tipo: planilla.tipo,
        sucursalId: planilla.sucursalId,
        divisionId: planilla.divisionId,
        departamentoId: planilla.departamentoId,
        estado: { in: ["CALCULADA", "APROBADA", "PAGADA"] },
        fechaFin: { lt: planilla.fechaInicio },
      },
      orderBy: { fechaFin: "desc" },
      select: { id: true, fechaInicio: true, fechaFin: true },
    }),
  ]);
  const previas = anterior ? await db.planillaDetalle.findMany({ where: { planillaId: anterior.id }, select: CAMPOS_LINEA }) : null;
  return { revision: revisarPlanilla(actual.map(aLinea), previas ? previas.map(aLinea) : null), anterior };
}
