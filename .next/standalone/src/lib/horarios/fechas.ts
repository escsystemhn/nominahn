/** Fechas de calendario «AAAA-MM-DD» sin zona horaria (aritmética en UTC). PURO. */

const DIA_MS = 86_400_000;

const aFecha = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const aTexto = (d: Date) => d.toISOString().slice(0, 10);

export function sumarDias(ymd: string, n: number): string {
  return aTexto(new Date(aFecha(ymd).getTime() + n * DIA_MS));
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / DIA_MS);
}

/** Día ISO: 1 = lunes … 7 = domingo. */
export function diaIso(ymd: string): number {
  const d = aFecha(ymd).getUTCDay();
  return d === 0 ? 7 : d;
}

export function lunesDe(ymd: string): string {
  return sumarDias(ymd, 1 - diaIso(ymd));
}

export function rango(desde: string, hasta: string): string[] {
  const n = diasEntre(desde, hasta);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => sumarDias(desde, i));
}

export const esFinDeSemana = (ymd: string) => diaIso(ymd) >= 6;

export const NOMBRE_DIA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const NOMBRE_DIA_CORTO = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** «2026-11-09» → «lun 09/11» */
export function fechaCorta(ymd: string): string {
  return `${NOMBRE_DIA_CORTO[diaIso(ymd)].toLowerCase()} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «2026-11-02», «2026-11-29» → «2 al 29 de noviembre de 2026» */
export function periodoTexto(desde: string, hasta: string): string {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  const fin = `${d2} de ${MESES[m2 - 1]} de ${a2}`;
  if (a1 === a2 && m1 === m2) return `${d1} al ${fin}`;
  if (a1 === a2) return `${d1} de ${MESES[m1 - 1]} al ${fin}`;
  return `${d1} de ${MESES[m1 - 1]} de ${a1} al ${fin}`;
}

/** ["A", "B", "C"] → «A, B y C» */
export function enumerar(partes: string[]): string {
  return partes.length < 2 ? partes.join("") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Años cumplidos en una fecha. */
export function edadEn(nacimiento: string, fecha: string): number {
  const [a, m, d] = nacimiento.split("-").map(Number);
  const [fa, fm, fd] = fecha.split("-").map(Number);
  return fa - a - (fm < m || (fm === m && fd < d) ? 1 : 0);
}
