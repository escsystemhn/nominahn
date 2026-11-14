/**
 * El DNI (número de identidad hondureño): 13 dígitos. Se guarda SÓLO con los dígitos,
 * como ya lo hacía la importación de empleados; el formulario lo guardaba como se
 * escribiera, y «0801-1990-12345» y «0801199012345» pasaban el índice único como si
 * fueran dos personas. Mientras queden registros viejos con guiones, se busca por las
 * dos formas.
 */

export type ResultadoIdentidad = { ok: true; valor: string } | { ok: false; error: string };

export function normalizarIdentidad(v: string | null | undefined): ResultadoIdentidad | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const digitos = t.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(digitos)) return { ok: false, error: "El DNI debe tener 13 dígitos, por ejemplo 0801-1990-12345." };
  return { ok: true, valor: digitos };
}

/** Las dos formas en que puede estar guardado: sólo dígitos y con guiones. */
export function formasIdentidad(digitos: string): string[] {
  return [digitos, `${digitos.slice(0, 4)}-${digitos.slice(4, 8)}-${digitos.slice(8)}`];
}

/** Para mostrar: 0801-1990-12345. */
export function formatoIdentidad(v: string | null | undefined): string {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : (v ?? "");
}
