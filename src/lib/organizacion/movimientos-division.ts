/**
 * Qué cuenta como «movimiento» de una unidad (división) al cambiarla de grupo.
 *
 * Una planilla CALCULADA, APROBADA, PAGADA o ANULADA es un movimiento: cuelga del grupo en
 * que se emitió y no cambia de dueño. Un BORRADOR no lo es: nadie lo ha confirmado y se
 * vuelve a generar con un clic, así que al mover la unidad se descartan los borradores que
 * la incluyen —por su alcance o por alguna línea suya— (decisión de Edbin, 2026-11-16).
 */

import type { Prisma } from "@prisma/client";

/** Planillas ya calculadas o cerradas cuyo alcance es la unidad. */
export const planillasConMovimiento = (divisionId: string): Prisma.PlanillaWhereInput => ({
  divisionId,
  estado: { not: "BORRADOR" },
});

/** Líneas de la unidad en planillas ya calculadas o cerradas. */
export const lineasConMovimiento = (divisionId: string): Prisma.PlanillaDetalleWhereInput => ({
  divisionId,
  planilla: { estado: { not: "BORRADOR" } },
});

/** Borradores que se descartan al mover la unidad: los suyos y los que traen alguna línea suya. */
export const borradoresDeDivision = (divisionId: string): Prisma.PlanillaWhereInput => ({
  estado: "BORRADOR",
  OR: [{ divisionId }, { detalles: { some: { divisionId } } }],
});

/** Cuántos borradores distintos tocan la unidad, con lo que trae la consulta de la estructura. */
export function contarBorradores(propios: Array<{ id: string }>, lineas: Array<{ planillaId: string }>): number {
  return new Set([...propios.map((p) => p.id), ...lineas.map((l) => l.planillaId)]).size;
}
