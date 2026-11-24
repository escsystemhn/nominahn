/**
 * Reglas de «Limpiar pruebas», puras (ver `limpiar-pruebas.ts`): qué planilla se puede
 * quitar y desde qué fecha se acepta limpiar.
 */

export const ESTADOS_LIMPIABLES = ["BORRADOR", "CALCULADA"] as const;
/** Hasta cuánto atrás se puede limpiar: más es casi seguro un error de fecha. */
export const DIAS_MAXIMOS = 90;

/**
 * Por qué una planilla no se puede quitar con la limpieza, o null si se puede. Las
 * cerradas no se tocan: son documentos y la base lo impide (02-planilla-cerrada-inmutable).
 */
export function motivoNoLimpiable(p: { estado: string; enviosSap: number }): string | null {
  if (!(ESTADOS_LIMPIABLES as readonly string[]).includes(p.estado)) {
    return p.estado === "ANULADA" ? "Está anulada: queda en el historial." : "Está cerrada (aprobada o pagada): sólo se anula.";
  }
  if (p.enviosSap > 0) return "Tiene historial con SAP: anúlela desde la planilla.";
  return null;
}

/** La fecha desde la que se limpia: válida, no futura y no más atrás de lo razonable. */
export function errorDeDesde(desde: Date, ahora = new Date()): string | null {
  if (Number.isNaN(desde.getTime())) return "Indique desde cuándo limpiar.";
  if (desde > ahora) return "La fecha no puede ser futura.";
  if (ahora.getTime() - desde.getTime() > DIAS_MAXIMOS * 86_400_000) return `No se limpia más de ${DIAS_MAXIMOS} días atrás: revise la fecha.`;
  return null;
}
