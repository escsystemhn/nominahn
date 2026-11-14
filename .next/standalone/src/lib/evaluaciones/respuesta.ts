/**
 * Registrar lo que califica UN evaluador en una evaluación 360°.
 *
 * Lo usan las dos entradas: el formulario con sesión (`/api/evaluaciones/[id]/participantes`)
 * y el enlace sin sesión (`/api/evaluar/[token]`). Antes cada una repetía el código, y
 * ninguna calculaba la nota del evaluador a partir de sus aspectos.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { calificacionPonderada } from "./calificacion";

/** Estados en que todavía se puede calificar. */
export const ESTADOS_CALIFICABLES = ["BORRADOR", "EN_PROGRESO"] as const;

export const zCriterioRespuesta = z.object({
  criterio: z.string().trim().min(1).max(200),
  competenciaId: z.string().min(1).nullish(),
  calificacion: z.coerce.number().min(0).max(100),
  // Llega como texto cuando sale de un Decimal serializado.
  peso: z.coerce.number().positive().max(100).default(1),
  comentario: z.string().trim().max(2000).optional(),
});

export const zRespuestaParticipante = z.object({
  // Calificación general: sólo se usa si el evaluador no calificó por aspecto.
  calificacion: z.coerce.number().min(0).max(100).optional(),
  comentarios: z.string().trim().max(5000).optional(),
  criterios: z.array(zCriterioRespuesta).max(60).default([]),
});

export type RespuestaParticipante = z.infer<typeof zRespuestaParticipante>;

export class SinCalificacion extends Error {}

/**
 * Guarda la respuesta y avanza la evaluación: a EN_PROGRESO con la primera respuesta y
 * a PENDIENTE_FIRMA cuando ya respondió el último evaluador.
 * Devuelve la calificación que quedó para este evaluador.
 */
export async function registrarRespuesta(
  tx: Prisma.TransactionClient,
  evaluacionId: string,
  participanteId: string,
  r: RespuestaParticipante
): Promise<number> {
  const nota = calificacionPonderada(r.criterios) ?? r.calificacion;
  if (nota === undefined || nota === null) throw new SinCalificacion("Califique los aspectos o dé una calificación general.");

  await tx.evaluacionParticipante.update({
    where: { id: participanteId },
    data: { calificacion: nota, comentarios: r.comentarios, estado: "COMPLETADO", fechaCompletado: new Date() },
  });

  if (r.criterios.length > 0) {
    await tx.criterioEvaluacion.createMany({
      data: r.criterios.map((c) => ({
        evaluacionId,
        participanteId,
        competenciaId: c.competenciaId ?? null,
        criterio: c.criterio,
        calificacion: c.calificacion,
        peso: c.peso,
        comentario: c.comentario,
      })),
    });
  }

  const pendientes = await tx.evaluacionParticipante.count({ where: { evaluacionId, estado: { not: "COMPLETADO" } } });
  await tx.evaluacion.updateMany({
    where: { id: evaluacionId, estado: { in: [...ESTADOS_CALIFICABLES] } },
    data: { estado: pendientes === 0 ? "PENDIENTE_FIRMA" : "EN_PROGRESO" },
  });
  return nota;
}
