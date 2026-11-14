/** Textos de pantalla y documento para prestaciones. Compartidos por cliente y servidor. */

export const CAUSAS_TERMINACION = [
  { v: "DESPIDO_INJUSTIFICADO", l: "Despido injustificado" },
  { v: "DESPIDO_JUSTIFICADO", l: "Despido justificado" },
  { v: "RENUNCIA", l: "Renuncia" },
  { v: "MUERTE", l: "Muerte del trabajador" },
] as const;

export function etiquetaCausa(c: string): string {
  return CAUSAS_TERMINACION.find((x) => x.v === c)?.l ?? c;
}

export const TIPOS_DECIMO = [
  { v: "DECIMO_TERCERO", l: "Décimo tercer mes (diciembre)" },
  { v: "DECIMO_CUARTO", l: "Décimo cuarto mes (junio)" },
] as const;

export function etiquetaDecimo(t: string): string {
  return t === "DECIMO_TERCERO" ? "Décimo tercer mes" : t === "DECIMO_CUARTO" ? "Décimo cuarto mes" : t;
}

/** «3 años y 4 meses (1,218 días)». */
export function textoTiempoServicio(t: { aniosServicio: number; mesesServicio: number; diasServicio: number }): string {
  const meses = t.mesesServicio - t.aniosServicio * 12;
  const partes: string[] = [];
  if (t.aniosServicio > 0) partes.push(t.aniosServicio === 1 ? "1 año" : `${t.aniosServicio} años`);
  if (meses > 0) partes.push(meses === 1 ? "1 mes" : `${meses} meses`);
  const base = partes.length ? partes.join(" y ") : "menos de un mes";
  return `${base} (${t.diasServicio.toLocaleString("es-HN")} días)`;
}

/** Folio legible de una liquidación a partir de su id y fecha. */
export function folioLiquidacion(id: string, fechaSalida: Date): string {
  return `LIQ-${fechaSalida.toISOString().slice(0, 4)}-${id.slice(-6).toUpperCase()}`;
}
