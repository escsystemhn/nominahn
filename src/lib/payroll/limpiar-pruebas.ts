/**
 * Limpiar lo que se hizo para probar (Configuración → Limpiar pruebas): las planillas
 * de prueba y los montos del período importados desde una fecha.
 *
 * Pedido de Edbin (2026-11-21): hacer pruebas en la base de un cliente y que las
 * nóminas queden limpias, sin perder los datos del cliente. Eligió no aprobar las
 * planillas de prueba, así que la limpieza NO toca la protección de las cerradas:
 *
 *   · Una planilla en BORRADOR o CALCULADA se quita como si se volviera a borrador
 *     (`devolverCobros`: cuotas de préstamos y bonos vuelven a como estaban) y luego se
 *     descartara (líneas y cabecera). Es lo mismo que la pantalla de la planilla
 *     permite hacer de a una.
 *   · Una APROBADA, PAGADA o ANULADA es un documento cerrado: no se toca, se lista
 *     aparte (`motivoNoLimpiable`). Tampoco una con historial en SAP.
 *   · Los montos del período y las bases del RAP importados desde la fecha se borran.
 *     Uno que todavía cobra una planilla que se queda no se toca.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { MARCA_MONTO_PERIODO } from "./deducciones";
import { devolverCobros } from "./calculo-planilla-bd";
import { motivoNoLimpiable } from "./limpiar-pruebas-reglas";

type Db = PrismaClient | Prisma.TransactionClient;

export { ESTADOS_LIMPIABLES, DIAS_MAXIMOS, motivoNoLimpiable, errorDeDesde } from "./limpiar-pruebas-reglas";

export interface PlanillaDePrueba {
  id: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
  creada: string;
  ubicacion: string;
  lineas: number;
  totalNeto: string;
  /** null: se puede quitar. */
  motivo: string | null;
}

export interface DatosDePrueba {
  planillas: PlanillaDePrueba[];
  /** Montos del período importados desde la fecha, por período. */
  montos: Array<{ desde: string; hasta: string; cantidad: number; empleados: number }>;
  totalMontos: number;
  /** Bases del RAP a mes vencido importadas desde la fecha. */
  basesRap: number;
  /** Montos del período de antes que se cambiaron durante las pruebas: no se pueden deshacer solos. */
  montosCambiados: number;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

export async function buscarDatosDePrueba(db: Db, desde: Date): Promise<DatosDePrueba> {
  const [planillas, montos, basesRap, montosCambiados] = await Promise.all([
    db.planilla.findMany({
      where: { createdAt: { gte: desde } },
      select: {
        id: true, tipo: true, fechaInicio: true, fechaFin: true, estado: true, createdAt: true, totalNeto: true,
        sucursal: { select: { nombre: true } }, division: { select: { nombre: true } }, departamento: { select: { nombre: true } },
        _count: { select: { detalles: true, enviosSap: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.deduccionEmpleado.findMany({
      where: { createdAt: { gte: desde }, observacion: { startsWith: MARCA_MONTO_PERIODO } },
      select: { empleadoId: true, fechaInicio: true, fechaFin: true },
    }),
    db.baseRapMes.count({ where: { createdAt: { gte: desde }, origen: "IMPORTACION" } }),
    db.deduccionEmpleado.count({ where: { createdAt: { lt: desde }, updatedAt: { gte: desde }, observacion: { startsWith: MARCA_MONTO_PERIODO } } }),
  ]);

  const porPeriodo = new Map<string, { desde: string; hasta: string; cantidad: number; empleados: Set<string> }>();
  for (const m of montos) {
    const clave = `${dia(m.fechaInicio)}|${m.fechaFin ? dia(m.fechaFin) : ""}`;
    const p = porPeriodo.get(clave) ?? { desde: dia(m.fechaInicio), hasta: m.fechaFin ? dia(m.fechaFin) : "", cantidad: 0, empleados: new Set<string>() };
    p.cantidad++;
    p.empleados.add(m.empleadoId);
    porPeriodo.set(clave, p);
  }

  return {
    planillas: planillas.map((p) => ({
      id: p.id, tipo: p.tipo, fechaInicio: dia(p.fechaInicio), fechaFin: dia(p.fechaFin), estado: p.estado,
      creada: p.createdAt.toISOString(),
      ubicacion: [p.sucursal?.nombre, p.division?.nombre, p.departamento?.nombre].filter(Boolean).join(" / ") || "Toda la empresa",
      lineas: p._count.detalles, totalNeto: p.totalNeto.toFixed(2),
      motivo: motivoNoLimpiable({ estado: p.estado, enviosSap: p._count.enviosSap }),
    })),
    montos: [...porPeriodo.values()].sort((a, b) => a.desde.localeCompare(b.desde)).map(({ empleados, ...p }) => ({ ...p, empleados: empleados.size })),
    totalMontos: montos.length,
    basesRap,
    montosCambiados,
  };
}

export interface ResultadoLimpieza {
  planillas: Array<{ id: string; tipo: string; fechaInicio: string; fechaFin: string; estado: string; totalNeto: string; cuotasDevueltas: number }>;
  omitidas: number;
  montos: number;
  /** Montos que no se borraron porque los cobra una planilla que se queda. */
  montosEnUso: number;
  basesRap: number;
}

/**
 * Quita, dentro de una transacción, las planillas elegidas que sigan siendo de prueba
 * (creadas desde la fecha, en borrador o calculadas, sin SAP) y, si se pide, los montos
 * del período y las bases del RAP importados desde la fecha. Se vuelve a mirar todo al
 * escribir: lo que cambió de estado mientras se revisaba se omite.
 */
export async function limpiarDatosDePrueba(
  tx: Prisma.TransactionClient,
  opciones: { desde: Date; planillaIds: readonly string[]; montos: boolean }
): Promise<ResultadoLimpieza> {
  const candidatas = await tx.planilla.findMany({
    where: { id: { in: [...opciones.planillaIds] }, createdAt: { gte: opciones.desde } },
    select: { id: true, tipo: true, fechaInicio: true, fechaFin: true, estado: true, totalNeto: true, _count: { select: { enviosSap: true } } },
  });
  const r: ResultadoLimpieza = { planillas: [], omitidas: opciones.planillaIds.length, montos: 0, montosEnUso: 0, basesRap: 0 };

  for (const p of candidatas) {
    if (motivoNoLimpiable({ estado: p.estado, enviosSap: p._count.enviosSap })) continue;
    // Como al volver a borrador: lo cobrado vuelve a los préstamos y los bonos se liberan.
    const cuotasDevueltas = p.estado === "BORRADOR" ? 0 : await devolverCobros(tx, p.id, { conservarRegistro: false });
    // Un borrador no cobró nada, pero pudo quedar algo de un intento anterior: se borra igual.
    await tx.amortizacionPlanilla.deleteMany({ where: { planillaId: p.id } });
    await tx.planillaDetalle.deleteMany({ where: { planillaId: p.id } });
    await tx.planilla.delete({ where: { id: p.id } });
    r.planillas.push({
      id: p.id, tipo: p.tipo, fechaInicio: dia(p.fechaInicio), fechaFin: dia(p.fechaFin), estado: p.estado,
      totalNeto: p.totalNeto.toFixed(2), cuotasDevueltas,
    });
  }
  r.omitidas -= r.planillas.length;

  if (opciones.montos) {
    const delPeriodo = { createdAt: { gte: opciones.desde }, observacion: { startsWith: MARCA_MONTO_PERIODO } };
    const borrados = await tx.deduccionEmpleado.deleteMany({ where: { ...delPeriodo, amortizaciones: { none: {} }, solicitud: { is: null } } });
    r.montos = borrados.count;
    r.montosEnUso = await tx.deduccionEmpleado.count({ where: delPeriodo });
    r.basesRap = (await tx.baseRapMes.deleteMany({ where: { createdAt: { gte: opciones.desde }, origen: "IMPORTACION" } })).count;
  }
  return r;
}
