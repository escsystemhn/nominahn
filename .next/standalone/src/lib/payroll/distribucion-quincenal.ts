/**
 * Planilla quincenal: en qué quincena se deducen los aportes mensuales. PURO.
 *
 * IHSS, RAP e impuesto vecinal son mensuales. Prácticas válidas:
 *   · DIVIDIDO: la mitad en cada quincena (lo que hacía siempre el sistema).
 *   · SEGUNDA:  nada en la primera quincena y el mes completo en la segunda,
 *               calculado sobre lo devengado en el mes y con el techo mensual. Es
 *               como lo hace PAGSA (planilla 20/2026).
 *   · PRIMERA:  el mes completo en la primera quincena y nada en la segunda.
 *
 * Con «completo en una», quien no tiene días en la otra quincena del mes (entra el
 * 16 o sale antes del 16) paga el mes en la que sí está: si no, nunca se le
 * deduciría. El total del mes es el mismo en todos los casos. INFOP y Fondo de
 * Reserva son patronales y siguen divididos. Aplica igual al porcentaje y al
 * monto fijo (de Parámetros de ley o de la ficha del empleado).
 */

import { z } from "zod";

export type ModoQuincenal = "DIVIDIDO" | "PRIMERA" | "SEGUNDA";

/** Cómo se lee cada modo en pantalla. */
export const ETIQUETA_MODO_QUINCENAL: Record<ModoQuincenal, string> = {
  DIVIDIDO: "La mitad en cada quincena",
  PRIMERA: "Completo en la primera quincena",
  SEGUNDA: "Completo en la segunda quincena",
};

export interface DistribucionQuincenal {
  ihss: ModoQuincenal;
  rap: ModoQuincenal;
  vecinal: ModoQuincenal;
}

export const DISTRIBUCION_POR_OMISION: DistribucionQuincenal = { ihss: "DIVIDIDO", rap: "DIVIDIDO", vecinal: "DIVIDIDO" };

/** Clave en ConfiguracionSistema (valor JSON). */
export const CLAVE_DISTRIBUCION_QUINCENAL = "PLANILLA_QUINCENAL_APORTES";

const zModo = z.enum(["DIVIDIDO", "PRIMERA", "SEGUNDA"]);
export const schemaDistribucion = z.object({ ihss: zModo, rap: zModo, vecinal: zModo });

/** Lo guardado sobre lo de omisión; un valor que no se entiende se ignora. */
export function normalizarDistribucion(guardado: unknown): DistribucionQuincenal {
  let v = guardado;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const out = { ...DISTRIBUCION_POR_OMISION };
  if (!v || typeof v !== "object") return out;
  for (const k of Object.keys(out) as (keyof DistribucionQuincenal)[]) {
    const m = (v as Record<string, unknown>)[k];
    if (m === "DIVIDIDO" || m === "PRIMERA" || m === "SEGUNDA") out[k] = m;
  }
  return out;
}

/** Qué quincena es la planilla: la que empieza el 16 o después es la segunda. */
export function numeroDeQuincena(desde: Date): 1 | 2 {
  return desde.getUTCDate() >= 16 ? 2 : 1;
}

/** La otra mitad del mes de una quincena: del 1 al 15 o del 16 al último día. */
export function otraQuincena(desde: Date): { desde: Date; hasta: Date } {
  const y = desde.getUTCFullYear(), m = desde.getUTCMonth();
  return numeroDeQuincena(desde) === 1
    ? { desde: new Date(Date.UTC(y, m, 16)), hasta: new Date(Date.UTC(y, m + 1, 0)) }
    : { desde: new Date(Date.UTC(y, m, 1)), hasta: new Date(Date.UTC(y, m, 15)) };
}

/**
 * ¿Se deduce el aporte en esta quincena y cómo? `null` = no se deduce; `mes` = el mes
 * entero (sin prorratear); `quincena` = la mitad, sobre lo devengado en la quincena.
 */
export function tramoQuincenal(modo: ModoQuincenal, numero: 1 | 2, enOtraQuincena: boolean): "mes" | "quincena" | null {
  if (modo === "DIVIDIDO") return "quincena";
  const objetivo = modo === "PRIMERA" ? 1 : 2;
  return numero === objetivo || !enOtraQuincena ? "mes" : null;
}
