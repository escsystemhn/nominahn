import { z } from "zod";

/** Cuerpo de alta y edición de una plantilla de documento. */
export const schemaPlantilla = z.object({
  nombre: z.string().trim().min(1, "requerido").max(120),
  titulo: z.string().trim().min(1, "requerido").max(150),
  tipo: z.enum(["CONSTANCIA_TRABAJO", "CONSTANCIA_SALARIO", "CONTRATO", "CARTA", "OTRO"]),
  contenido: z.string().trim().min(1, "requerido").max(20000),
  autoservicio: z.boolean().optional(),
  activo: z.boolean().optional(),
});
