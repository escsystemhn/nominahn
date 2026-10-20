/**
 * Portal público de empleo (/empleos).
 *
 * Es la única parte de la aplicación que ve alguien sin cuenta, así que todo lo
 * que sale de aquí se elige a propósito: sólo vacantes abiertas, no internas y
 * publicadas a mano, y sólo los campos que un anuncio de empleo lleva. Nunca el
 * departamento interno con su sucursal, quién la creó ni los candidatos.
 */

import { z } from "zod";
import type { Prisma } from "@prisma/client";

/** Qué vacantes ve el público. Las tres condiciones a la vez. */
export const FILTRO_VACANTE_PUBLICA = {
  estado: "ABIERTA",
  publicada: true,
  esInterna: false,
} as const satisfies Prisma.VacanteWhereInput;

/** Campos del anuncio. */
export const SELECT_VACANTE_PUBLICA = {
  id: true,
  titulo: true,
  descripcion: true,
  requisitos: true,
  tipoContrato: true,
  salarioMin: true,
  salarioMax: true,
  plazas: true,
  fechaApertura: true,
  departamento: { select: { nombre: true } },
} as const satisfies Prisma.VacanteSelect;

export const TIPO_CONTRATO_PUBLICO: Record<string, string> = {
  INDEFINIDO: "Tiempo indefinido",
  TEMPORAL: "Temporal",
  PRUEBA: "Con período de prueba",
  SERVICIO: "Servicios profesionales",
};

/** Fuente con la que entra el candidato al tablero de reclutamiento. */
export const FUENTE_PORTAL = "Portal de empleo";

/** Nombre del campo trampa: invisible para una persona, irresistible para un bot. */
export const CAMPO_TRAMPA = "sitio_web";

/** Postulaciones por IP y hora. Una persona real no necesita más. */
export const LIMITE_POSTULACIONES = { maxIntentos: 5, ventanaMs: 60 * 60 * 1000 };

/**
 * Techo por vacante y hora, sea cual sea la IP. La IP sale de un encabezado que
 * el cliente puede inventar cuando no hay un proxy delante; este techo acota el
 * daño aunque el límite por IP se esquive.
 */
export const LIMITE_POR_VACANTE = { maxIntentos: 60, ventanaMs: 60 * 60 * 1000 };

// Vive en lib/http porque también la usa el límite por IP del inicio de sesión.
export { ipParaLimite } from "@/lib/http/ip";

export const schemaPostulacion = z.object({
  nombre: z.string().trim().min(3, "Escriba su nombre completo").max(120),
  email: z.email("Correo inválido").trim().toLowerCase().max(160),
  telefono: z
    .string()
    .trim()
    .max(30)
    .refine((t) => t === "" || /^[+\d][\d\s-]{6,}$/.test(t), "Teléfono inválido")
    .optional(),
  mensaje: z.string().trim().max(1500).optional(),
  consentimiento: z.literal("si", { error: "Debe aceptar el uso de sus datos para postularse" }),
});

export type Postulacion = z.infer<typeof schemaPostulacion>;

/**
 * El archivo es un PDF de verdad: empieza con `%PDF-`. La extensión y el tipo
 * que declara el navegador los pone quien sube el archivo; la firma no.
 */
export function esPdf(bytes: Uint8Array): boolean {
  const firma = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  return bytes.length > firma.length && firma.every((b, i) => bytes[i] === b);
}

/** Texto que queda en las notas del candidato. */
export function notasDePostulacion(p: Postulacion, ahora: Date): string {
  const lineas = [`Postulación recibida por el portal de empleo el ${ahora.toISOString().slice(0, 10)}.`];
  if (p.mensaje) lineas.push("", "Mensaje del candidato:", p.mensaje);
  return lineas.join("\n");
}

/** Rango salarial como lo lee un candidato. Sin rango, no se muestra nada. */
export function textoSalario(min: number | null, max: number | null, fmt: (n: number) => string): string | null {
  if (min && max) return min === max ? fmt(min) : `${fmt(min)} a ${fmt(max)}`;
  if (min) return `Desde ${fmt(min)}`;
  if (max) return `Hasta ${fmt(max)}`;
  return null;
}
