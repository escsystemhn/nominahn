/**
 * Lo cobrado por tipo de las líneas que NO guardaron su detalle (`PlanillaDetalle.deducciones`
 * es de 2026-11-21 en adelante): sale de `AmortizacionPlanilla`, como en la pantalla de la
 * planilla. Lo usan los comprobantes para mostrar cada deducción con su nombre también en
 * las planillas de antes. Con el detalle guardado no se consulta nada.
 */

import type { PrismaClient } from "@prisma/client";
import { money, type Money } from "./money";
import { leerDeduccionesGuardadas } from "./deducciones-de-linea";

export type CobradasPorLinea = Map<string, Array<{ nombre: string; monto: Money }>>;

/** La clave de una línea en el mapa: planilla y empleado. */
export const claveDeLinea = (l: { planillaId: string; empleadoId: string }) => `${l.planillaId}|${l.empleadoId}`;

export async function cobradasSinDetalle(
  db: PrismaClient,
  lineas: ReadonlyArray<{ planillaId: string; empleadoId: string; deducciones?: unknown }>,
): Promise<CobradasPorLinea> {
  const salida: CobradasPorLinea = new Map();
  const sinDetalle = lineas.filter((l) => leerDeduccionesGuardadas(l.deducciones) === null);
  if (sinDetalle.length === 0) return salida;
  const filas = await db.amortizacionPlanilla.findMany({
    where: {
      planillaId: { in: [...new Set(sinDetalle.map((l) => l.planillaId))] },
      deduccion: { empleadoId: { in: [...new Set(sinDetalle.map((l) => l.empleadoId))] } },
    },
    select: { planillaId: true, montoAplicado: true, deduccion: { select: { empleadoId: true, tipoDeduccion: { select: { nombre: true } } } } },
  });
  for (const f of filas) {
    const clave = claveDeLinea({ planillaId: f.planillaId, empleadoId: f.deduccion.empleadoId });
    const lista = salida.get(clave) ?? [];
    lista.push({ nombre: f.deduccion.tipoDeduccion.nombre, monto: money(f.montoAplicado) });
    salida.set(clave, lista);
  }
  return salida;
}
