import { z } from "zod";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Cuerpo de alta y edición de un turno. La validación legal está en `validarTurno`. */
export const schemaTurno = z.object({
  codigo: z.string().trim().min(1, "requerido").max(20).regex(/^[A-Za-z0-9_-]+$/, "sólo letras, números, guion y guion bajo"),
  nombre: z.string().trim().min(1, "requerido").max(80),
  tipoJornada: z.enum(["DIURNA", "MIXTA", "NOCTURNA"]),
  horaEntrada: z.string().regex(HORA, "formato HH:MM"),
  horaSalida: z.string().regex(HORA, "formato HH:MM"),
  jornadaHoras: z.coerce.number().positive().max(12),
  almuerzoMinutos: z.coerce.number().int().min(0).max(180),
  almuerzoDesdeHoras: z.coerce.number().min(0).max(12),
  toleranciaMinutos: z.coerce.number().int().min(0).max(60),
  diasLaborales: z.string().regex(/^[1-7](,[1-7])*$/, "días 1 a 7 separados por coma"),
  esPorDefecto: z.boolean().optional(),
  activo: z.boolean().optional(),
});

export type CuerpoTurno = z.infer<typeof schemaTurno>;
