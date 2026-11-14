/**
 * Criterios consolidados de una evaluación (CriterioEvaluacion con participanteId null):
 * en una evaluación directa son lo que calificó RRHH o el jefe; en una 360°, el promedio
 * por aspecto de los evaluadores, que se escribe al finalizarla.
 */
import type { EstadoEvaluacion, Prisma } from "@prisma/client";
import { z } from "zod";
import { calificacionPonderada, estanTodosCalificados } from "./calificacion";

export const zCriterioDirecto = z.object({
  criterio: z.string().trim().min(1).max(200),
  competenciaId: z.string().min(1).nullish(),
  peso: z.coerce.number().positive().max(100).default(1),
  // null = todavía sin calificar: la evaluación queda en borrador.
  calificacion: z.coerce.number().min(0).max(100).nullable(),
  comentario: z.string().trim().max(2000).optional(),
});
export type CriterioDirecto = z.infer<typeof zCriterioDirecto>;

/**
 * Reemplaza los criterios consolidados. Sólo se guardan los calificados: la columna no
 * admite «sin calificar» y guardarlos como 0 los haría contar como 0 después.
 * Devuelve la calificación ponderada (null si no hay ninguno calificado).
 */
export async function guardarCriteriosConsolidados(
  tx: Prisma.TransactionClient,
  evaluacionId: string,
  criterios: readonly CriterioDirecto[]
): Promise<number | null> {
  await tx.criterioEvaluacion.deleteMany({ where: { evaluacionId, participanteId: null } });
  const calificados = criterios.filter((c) => c.calificacion !== null);
  if (calificados.length > 0) {
    await tx.criterioEvaluacion.createMany({
      data: calificados.map((c) => ({
        evaluacionId,
        participanteId: null,
        competenciaId: c.competenciaId ?? null,
        criterio: c.criterio,
        calificacion: c.calificacion as number,
        peso: c.peso,
        comentario: c.comentario,
      })),
    });
  }
  return calificacionPonderada(criterios);
}

/**
 * Estado de una evaluación directa según sus criterios: completa queda lista para
 * firmar; a medias, en borrador.
 */
export function estadoDirecta(criterios: readonly CriterioDirecto[]): EstadoEvaluacion {
  return estanTodosCalificados(criterios) ? "PENDIENTE_FIRMA" : "BORRADOR";
}
