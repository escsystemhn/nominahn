/** Parentescos y reglas de familiares y beneficiarios. Puro. */

export const PARENTESCOS = [
  { v: "CONYUGE", l: "Cónyuge" },
  { v: "COMPANERO_HOGAR", l: "Compañero(a) de hogar" },
  { v: "HIJO", l: "Hijo(a)" },
  { v: "PADRE", l: "Padre" },
  { v: "MADRE", l: "Madre" },
  { v: "HERMANO", l: "Hermano(a)" },
  { v: "OTRO", l: "Otro" },
] as const;

export type Parentesco = (typeof PARENTESCOS)[number]["v"];

export function etiquetaParentesco(p: string): string {
  return PARENTESCOS.find((x) => x.v === p)?.l ?? p;
}

export const TIPOS_SANGRE = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"] as const;

/**
 * Los porcentajes de los beneficiarios suman 100 (con tolerancia de un
 * centésimo por redondeo), o no hay beneficiarios.
 */
export function validarPorcentajes(porcentajes: number[]): { ok: true } | { ok: false; error: string } {
  if (porcentajes.length === 0) return { ok: true };
  if (porcentajes.some((p) => !(p > 0) || p > 100)) return { ok: false, error: "Cada porcentaje debe ser mayor que 0 y no mayor que 100." };
  const total = Math.round(porcentajes.reduce((s, p) => s + p, 0) * 100) / 100;
  if (Math.abs(total - 100) > 0.01) return { ok: false, error: `Los porcentajes suman ${total.toFixed(2)} %; deben sumar 100 %.` };
  return { ok: true };
}
