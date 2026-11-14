/**
 * Catálogo de aspectos a evaluar (CompetenciaDefinicion): qué se valida al crear o editar uno.
 */
import { z } from "zod";
import { TipoEvaluacion } from "@prisma/client";

export const CATEGORIAS_COMPETENCIA = ["CORE", "LIDERAZGO", "TECNICA", "COMPORTAMIENTO"] as const;

const base = {
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  descripcion: z.string().trim().max(1000).nullish(),
  categoria: z.enum(CATEGORIAS_COMPETENCIA),
  // Aspecto general: se evalúa a quien no tenga aspectos en su puesto.
  general: z.boolean(),
  // null = en las dos evaluaciones (desempeño mensual y competencias trimestrales).
  tipoEvaluacion: z.enum(TipoEvaluacion).nullable(),
  peso: z.coerce.number().min(0.1).max(10),
};

export const zCompetencia = z.object({
  ...base,
  categoria: base.categoria.default("CORE"),
  general: base.general.default(false),
  tipoEvaluacion: base.tipoEvaluacion.default(null),
  peso: base.peso.default(1),
});

export const zCompetenciaCambios = z
  .object({ ...base, activa: z.boolean() })
  .partial()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { error: "Sin cambios" });
