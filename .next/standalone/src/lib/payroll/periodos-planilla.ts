/**
 * Períodos de planilla con nombre: «1.ª quincena de noviembre de 2026», «noviembre de
 * 2026», «semana del 09/11/2026». Sirven para elegir a qué período van los montos de
 * deducción que se exportan e importan, sin escribir fechas a mano.
 *
 * Todo en texto AAAA-MM-DD y en UTC: son fechas de calendario (`@db.Date`), y así la
 * misma función corre en el navegador y en el servidor sin que la zona horaria mueva
 * un día.
 */

export type TipoPlanillaPeriodo = "SEMANAL" | "QUINCENAL" | "MENSUAL";

export const TIPOS_PLANILLA: readonly TipoPlanillaPeriodo[] = ["QUINCENAL", "MENSUAL", "SEMANAL"];

export const ETIQUETA_TIPO_PLANILLA: Record<TipoPlanillaPeriodo, string> = {
  QUINCENAL: "Quincenal",
  MENSUAL: "Mensual",
  SEMANAL: "Semanal",
};

export interface PeriodoPlanilla {
  tipo: TipoPlanillaPeriodo;
  desde: string;
  hasta: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dos = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const leer = (s: string) => new Date(`${s}T00:00:00.000Z`);

export function esFechaIso(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return iso(leer(s)) === s;
}

/** Hoy en el reloj de quien mira, como AAAA-MM-DD. */
export function hoyLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** El período estándar de ese tipo que contiene la fecha. La semana va de lunes a domingo. */
export function periodoQueContiene(tipo: TipoPlanillaPeriodo, fecha: string): PeriodoPlanilla {
  const f = leer(fecha);
  const y = f.getUTCFullYear(), m = f.getUTCMonth(), d = f.getUTCDate();
  if (tipo === "MENSUAL") return { tipo, desde: iso(utc(y, m, 1)), hasta: iso(utc(y, m + 1, 0)) };
  if (tipo === "QUINCENAL") {
    return d <= 15
      ? { tipo, desde: iso(utc(y, m, 1)), hasta: iso(utc(y, m, 15)) }
      : { tipo, desde: iso(utc(y, m, 16)), hasta: iso(utc(y, m + 1, 0)) };
  }
  const lunes = utc(y, m, d - ((f.getUTCDay() + 6) % 7));
  return { tipo, desde: iso(lunes), hasta: iso(utc(lunes.getUTCFullYear(), lunes.getUTCMonth(), lunes.getUTCDate() + 6)) };
}

/** El período estándar siguiente (`paso` = 1) o anterior (`paso` = −1). */
function vecino(p: PeriodoPlanilla, paso: 1 | -1): PeriodoPlanilla {
  const referencia = paso === 1 ? leer(p.hasta) : leer(p.desde);
  referencia.setUTCDate(referencia.getUTCDate() + paso);
  return periodoQueContiene(p.tipo, iso(referencia));
}

/** Los períodos estándar alrededor de hoy, del más antiguo al más reciente. */
export function periodosSugeridos(tipo: TipoPlanillaPeriodo, hoy: string, antes = 4, despues = 2): PeriodoPlanilla[] {
  const actual = periodoQueContiene(tipo, hoy);
  const previos: PeriodoPlanilla[] = [];
  let p = actual;
  for (let i = 0; i < antes; i++) previos.unshift((p = vecino(p, -1)));
  const siguientes: PeriodoPlanilla[] = [];
  p = actual;
  for (let i = 0; i < despues; i++) siguientes.push((p = vecino(p, 1)));
  return [...previos, actual, ...siguientes];
}

export function esPeriodoEstandar(p: PeriodoPlanilla): boolean {
  const estandar = periodoQueContiene(p.tipo, p.desde);
  return estandar.desde === p.desde && estandar.hasta === p.hasta;
}

const corta = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/** «del 01/11/2026 al 15/11/2026». */
export function rangoPeriodo(desde: string, hasta: string): string {
  return `del ${corta(desde)} al ${corta(hasta)}`;
}

/** Nombre del período para leer: «1.ª quincena de noviembre de 2026». Si no es estándar, el rango. */
export function etiquetaPeriodo(p: PeriodoPlanilla): string {
  if (!esPeriodoEstandar(p)) return rangoPeriodo(p.desde, p.hasta);
  const f = leer(p.desde);
  const mes = `${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
  if (p.tipo === "MENSUAL") return mes.charAt(0).toUpperCase() + mes.slice(1);
  if (p.tipo === "QUINCENAL") return `${f.getUTCDate() === 1 ? "1.ª" : "2.ª"} quincena de ${mes}`;
  return `Semana ${rangoPeriodo(p.desde, p.hasta)}`;
}

/**
 * El período dentro de una frase, con su preposición y artículo bien contraídos:
 * «a la 1.ª quincena de noviembre de 2026», «al mes de noviembre de 2026», «del
 * período del 03/11/2026 al 17/11/2026».
 */
export function frasePeriodo(p: PeriodoPlanilla, preposicion: "a" | "de" | "en"): string {
  let articulo: "la" | "el", nombre: string;
  if (!esPeriodoEstandar(p)) { articulo = "el"; nombre = `período ${rangoPeriodo(p.desde, p.hasta)}`; }
  else if (p.tipo === "MENSUAL") { articulo = "el"; nombre = `mes de ${etiquetaPeriodo(p).toLowerCase()}`; }
  else { articulo = "la"; nombre = etiquetaPeriodo(p).replace(/^Semana/, "semana"); }
  const unido = articulo === "el" && preposicion !== "en" ? (preposicion === "a" ? "al" : "del") : `${preposicion} ${articulo}`;
  return `${unido} ${nombre}`;
}

/** Nombre del archivo exportado. Lleva las fechas para poder reconocer el período al importarlo. */
export function nombreArchivoPeriodo(p: PeriodoPlanilla): string {
  return `deducciones_${p.tipo.toLowerCase()}_${p.desde}_al_${p.hasta}`;
}

/** El período que dice el nombre de un archivo exportado, aunque el navegador le haya añadido « (1)». */
export function periodoDeNombreArchivo(nombre: string): PeriodoPlanilla | null {
  const m = /deducciones_(semanal|quincenal|mensual)_(\d{4}-\d{2}-\d{2})_al_(\d{4}-\d{2}-\d{2})/i.exec(nombre);
  if (!m || !esFechaIso(m[2]) || !esFechaIso(m[3]) || m[2] > m[3]) return null;
  return { tipo: m[1].toUpperCase() as TipoPlanillaPeriodo, desde: m[2], hasta: m[3] };
}

/** Un período elegido a mano es válido si va en orden y no pasa de un mes y medio. */
export function errorDePeriodo(p: { desde: unknown; hasta: unknown }): string | null {
  if (!esFechaIso(p.desde) || !esFechaIso(p.hasta)) return "Elija las fechas del período.";
  if (p.desde > p.hasta) return "La fecha de inicio del período es posterior a la final.";
  const dias = (leer(p.hasta).getTime() - leer(p.desde).getTime()) / 86_400_000 + 1;
  if (dias > 45) return "El período no puede pasar de 45 días: use el de una planilla.";
  return null;
}
