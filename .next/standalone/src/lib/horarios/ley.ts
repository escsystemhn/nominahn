/**
 * Reglas de jornada del Código del Trabajo de Honduras (Decreto 189-59 y sus
 * reformas), para planificar horarios. PURO: sin base de datos.
 *
 * Texto verificado el 2026-10-21 en la transcripción de Wikisource del Código:
 *
 *   Art. 321  Diurno: 5:00 a 19:00. Nocturno: 19:00 a 5:00. Mixta: abarca ambos
 *             períodos «siempre que el período nocturno abarque MENOS DE TRES (3)
 *             HORAS, pues en caso contrario se reputará como jornada nocturna».
 *             Mixta: 7 h diarias, 42 a la semana.
 *   Art. 322  Diurna: 8 h diarias y 44 a la semana (equivalentes a 48 de salario).
 *             Nocturna: 6 h diarias y 36 a la semana.
 *   Art. 325  Cargos de dirección, de confianza o de manejo: fuera de la jornada
 *             máxima, pero no más de 12 h diarias y con 1 h 30 de descanso
 *             (fraccionable en períodos de 30 min o más).
 *   Art. 326  Jornada continua: descanso mínimo de 30 min que SE COMPUTA como
 *             tiempo de trabajo efectivo.
 *   Art. 327  Entre una jornada y la siguiente, 10 h de descanso ininterrumpido.
 *   Art. 330  Extra: +25 % si es en período diurno; +50 % si es en período
 *             nocturno; +75 % (sobre el salario nocturno) si prolonga una
 *             jornada nocturna.
 *   Art. 332  Ordinaria + extraordinaria: no más de 12 h.
 *   Art. 333  Extra de un mismo trabajador: no más de 4 veces a la semana.
 *   Art. 338  1 día de descanso por cada 6 de trabajo, preferentemente el
 *             domingo. Sin excepción al descanso dominical para menores de 16.
 *   Art. 340  Trabajar el descanso o un feriado se paga con el doble.
 *   Art. 341  Nadie puede ser ocupado después de la 1:00 p. m. de la víspera
 *             de su día de descanso semanal.
 *   Art. 129  Menores de 16: prohibido el trabajo nocturno y la jornada extra,
 *             y en cafés, cantinas y expendios de bebidas embriagantes de
 *             consumo inmediato.
 *
 * Código de la Niñez y la Adolescencia (Decreto 73-96, texto actualizado a 2014
 * del Poder Judicial; cotejado con las copias de la Secretaría de Educación y de
 * la OEA el 2026-10-21). «Niño» es toda persona menor de 18 años (Art. 1):
 *   Art. 119  Trabajar requiere autorización previa de la Secretaría de Trabajo.
 *   Art. 120  Nunca se autoriza a un menor de 14 años.
 *   Art. 125  De 14 y 15 años: jornadas de no más de 4 h diarias. De 16 y 17: no
 *             más de 6 h. Prohibido el trabajo nocturno; a los de 16 y 17 se les
 *             puede autorizar hasta las 8:00 p. m. si no afecta su asistencia a
 *             un centro docente ni su salud.
 *
 * Convención: una jornada se describe en MINUTOS desde la medianoche del día en
 * que empieza; la salida puede pasar de 1440 si cruza la medianoche.
 */

export type TipoJornada = "DIURNA" | "MIXTA" | "NOCTURNA";

export const MAX_DIARIO_H: Record<TipoJornada, number> = { DIURNA: 8, MIXTA: 7, NOCTURNA: 6 };
export const MAX_SEMANAL_H: Record<TipoJornada, number> = { DIURNA: 44, MIXTA: 42, NOCTURNA: 36 };

export const INICIO_NOCHE = 19 * 60;
export const FIN_NOCHE = 5 * 60;
/** Art. 321: con 3 h nocturnas o más, la jornada es nocturna. */
export const UMBRAL_NOCTURNA_MIN = 180;
/** Art. 326: la pausa de una jornada continua (hasta 30 min) cuenta como trabajo. */
export const PAUSA_COMPUTABLE_MAX_MIN = 30;
/** Art. 327. */
export const DESCANSO_LEGAL_ENTRE_JORNADAS_H = 10;
/** Art. 332. */
export const MAX_ORDINARIA_MAS_EXTRA_H = 12;
/** Art. 333. */
export const MAX_DIAS_CON_EXTRA_SEMANA = 4;
/** Art. 338. */
export const MAX_DIAS_CONSECUTIVOS = 6;
/** Art. 341: salida a más tardar a la 1:00 p. m. la víspera del descanso. */
export const VISPERA_HORA_MAX = 13 * 60;
/** Art. 325: tope de permanencia y descanso de los cargos de dirección o confianza. */
export const EXENTO_MAX_PERMANENCIA_H = 12;
export const EXENTO_DESCANSO_MIN = 90;
/** Código de la Niñez, Art. 120. */
export const EDAD_MINIMA_TRABAJO = 14;
/** Código de la Niñez, Art. 125 c): hasta dónde se puede autorizar a uno de 16 o 17 años. */
export const ADOLESCENTE_AUTORIZABLE_HASTA = 20 * 60;

/** Código de la Niñez, Art. 125 a) y b): jornada diaria máxima de un menor de 18; null si es mayor. */
export function maxDiarioMenorH(edad: number): number | null {
  if (edad < 16) return 4;
  if (edad < 18) return 6;
  return null;
}

/** Recargo de la hora extra según el Art. 330. */
export type ClaseExtra = "DIURNA_25" | "NOCTURNA_50" | "PROLONGACION_NOCTURNA_75";
export const RECARGO_EXTRA: Record<ClaseExtra, number> = { DIURNA_25: 0.25, NOCTURNA_50: 0.5, PROLONGACION_NOCTURNA_75: 0.75 };
export const ETIQUETA_EXTRA: Record<ClaseExtra, string> = {
  DIURNA_25: "extra diurna (+25 %)",
  NOCTURNA_50: "extra en período nocturno (+50 %)",
  PROLONGACION_NOCTURNA_75: "prolongación de jornada nocturna (+75 %)",
};

export interface Jornada {
  /** Minutos desde la medianoche del día de inicio. */
  entrada: number;
  /** Puede pasar de 1440 (termina al día siguiente). Siempre mayor que la entrada. */
  salida: number;
  /** Pausa o almuerzo dentro de la jornada, en minutos. */
  pausa: number;
}

/** Tramos nocturnos (19:00–5:00) expresados en minutos desde la medianoche del día de inicio. */
const TRAMOS_NOCHE: [number, number][] = [
  [0, FIN_NOCHE],
  [INICIO_NOCHE, 1440 + FIN_NOCHE],
  [1440 + INICIO_NOCHE, 2880 + FIN_NOCHE],
];

function solape(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** ¿El minuto `m` (desde la medianoche del día de inicio) cae en período nocturno? */
export function esMinutoNocturno(m: number): boolean {
  const r = ((m % 1440) + 1440) % 1440;
  return r < FIN_NOCHE || r >= INICIO_NOCHE;
}

export function minutosNocturnos(entrada: number, salida: number): number {
  return TRAMOS_NOCHE.reduce((s, [a, b]) => s + solape(entrada, salida, a, b), 0);
}

/**
 * Tipo de jornada según el Art. 321, por el LAPSO entre la entrada y la salida
 * (la pausa también es parte de la jornada). Sin minutos nocturnos: diurna. Sin
 * minutos diurnos: nocturna. Si combina ambos: mixta sólo si lo nocturno es
 * menor de 3 horas; con 3 horas o más, nocturna.
 */
export function tipoJornada(entrada: number, salida: number): TipoJornada {
  const nocturnos = minutosNocturnos(entrada, salida);
  const diurnos = salida - entrada - nocturnos;
  if (nocturnos === 0) return "DIURNA";
  if (diurnos === 0) return "NOCTURNA";
  return nocturnos < UMBRAL_NOCTURNA_MIN ? "MIXTA" : "NOCTURNA";
}

/**
 * Minutos de trabajo efectivo. Art. 326: la pausa de hasta 30 minutos de una
 * jornada continua cuenta como trabajo. Un almuerzo más largo es una jornada
 * dividida en la que la persona puede salir: no cuenta (y si no pudiera salir,
 * el Art. 323 lo volvería tiempo efectivo; eso no lo puede saber el plan).
 */
export function minutosEfectivos(j: Jornada): number {
  const lapso = j.salida - j.entrada;
  return j.pausa <= PAUSA_COMPUTABLE_MAX_MIN ? lapso : lapso - j.pausa;
}

export interface ResultadoJornada {
  tipo: TipoJornada;
  minutosNocturnos: number;
  efectivos: number;
  ordinarios: number;
  /** Minutos extra por clase de recargo (Art. 330). */
  extra: Record<ClaseExtra, number>;
  extraTotal: number;
}

/**
 * Ordinarias y extra de una jornada. La extra es la COLA de la jornada (se
 * programa como prolongación) y cada minuto se clasifica según el Art. 330.
 *
 * `ordinariasPactadas`: horas ordinarias del turno si se pactó una jornada menor
 * a la legal (Art. 330: también es extra lo que «exceda de la jornada inferior
 * convenida»). `exento`: cargo de dirección o confianza (Art. 325), sin extra
 * por jornada.
 */
export function analizarJornada(j: Jornada, opciones: { ordinariasPactadasH?: number; exento?: boolean } = {}): ResultadoJornada {
  const tipo = tipoJornada(j.entrada, j.salida);
  const efectivos = minutosEfectivos(j);
  const extra: Record<ClaseExtra, number> = { DIURNA_25: 0, NOCTURNA_50: 0, PROLONGACION_NOCTURNA_75: 0 };
  const base = { tipo, minutosNocturnos: minutosNocturnos(j.entrada, j.salida), efectivos };
  if (opciones.exento) return { ...base, ordinarios: efectivos, extra, extraTotal: 0 };

  const maxLegal = MAX_DIARIO_H[tipo] * 60;
  const tope = Math.min(maxLegal, opciones.ordinariasPactadasH !== undefined ? Math.round(opciones.ordinariasPactadasH * 60) : maxLegal);
  const extraTotal = Math.max(0, efectivos - tope);
  for (let m = j.salida - extraTotal; m < j.salida; m++) {
    if (tipo === "NOCTURNA") extra.PROLONGACION_NOCTURNA_75++;
    else if (esMinutoNocturno(m)) extra.NOCTURNA_50++;
    else extra.DIURNA_25++;
  }
  return { ...base, ordinarios: efectivos - extraTotal, extra, extraTotal };
}

/**
 * Tope semanal cuando la semana mezcla tipos de jornada: promedio de los topes
 * (44/42/36) ponderado por los días trabajados de cada tipo. Con una semana de un
 * solo tipo da exactamente su tope legal. Es una INTERPRETACIÓN conservadora del
 * Código, que no regula semanas mixtas: conviene que la valide un abogado laboral.
 */
export function topeSemanalH(tipos: TipoJornada[]): number {
  if (tipos.length === 0) return MAX_SEMANAL_H.DIURNA;
  return tipos.reduce((s, t) => s + MAX_SEMANAL_H[t], 0) / tipos.length;
}

/** «06:30» → 390. `null` si no es una hora válida. */
export function minutosDeHora(h: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((h ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 390 → «06:30»; 1530 → «01:30» (del día siguiente). */
export function horaDeMinutos(min: number): string {
  const n = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Entrada y salida «HH:MM» → jornada; una salida igual o anterior a la entrada termina al día siguiente. */
export function jornadaDeHoras(entrada: string, salida: string, pausa: number): Jornada | null {
  const e = minutosDeHora(entrada);
  const s = minutosDeHora(salida);
  if (e === null || s === null) return null;
  return { entrada: e, salida: s <= e ? s + 1440 : s, pausa };
}

export const horas = (minutos: number) => Math.round((minutos / 60) * 100) / 100;
