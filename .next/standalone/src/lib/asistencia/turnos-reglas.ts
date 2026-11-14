/**
 * Reglas de los turnos. PURO: sin base de datos.
 *
 * Límites de la jornada ordinaria diaria (Código del Trabajo):
 *   · Art. 322: diurna hasta 8 horas (44 a la semana); nocturna hasta 6 (36).
 *   · Art. 321: mixta hasta 7 horas (42 a la semana).
 * Un turno puede tener menos horas ordinarias, nunca más: por encima de esas
 * horas todo es extraordinario y se paga con recargo (Art. 330).
 */

export type TipoJornada = "DIURNA" | "MIXTA" | "NOCTURNA";

export const MAX_HORAS_JORNADA: Record<TipoJornada, number> = { DIURNA: 8, MIXTA: 7, NOCTURNA: 6 };

export const ETIQUETA_JORNADA: Record<TipoJornada, string> = { DIURNA: "diurna", MIXTA: "mixta", NOCTURNA: "nocturna" };

const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Margen tras la salida programada en que una marca de madrugada aún es la salida del turno nocturno. */
export const MARGEN_SALIDA_NOCTURNA_MIN = 4 * 60;

/** «08:30» → 510. `null` si no es una hora válida. */
export function parseHora(h: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((h ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatoHora(min: number): string {
  const n = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Una salida igual o anterior a la entrada significa que el turno termina al día siguiente. */
export function cruzaMedianoche(entrada: string, salida: string): boolean {
  const e = parseHora(entrada);
  const s = parseHora(salida);
  return e !== null && s !== null && s <= e;
}

/** Minutos entre entrada y salida programadas, cruzando la medianoche si hace falta. */
export function minutosProgramados(entrada: string, salida: string): number {
  const e = parseHora(entrada) ?? 0;
  const s = parseHora(salida) ?? 0;
  const d = (s - e + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

export function parseDias(dias: string): number[] {
  return [...new Set((dias ?? "").split(",").map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
}

/** [1,2,3,4,5] → «de lunes a viernes»; [1,3,5] → «lunes, miércoles y viernes». */
export function describirDias(dias: number[]): string {
  const d = [...new Set(dias)].sort((a, b) => a - b);
  if (d.length === 0) return "";
  if (d.length === 7) return "todos los días";
  const consecutivos = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (consecutivos && d.length >= 3) return `de ${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}`;
  const nombres = d.map((x) => DIAS[x]);
  return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

export interface TurnoDatos {
  tipoJornada: TipoJornada;
  horaEntrada: string;
  horaSalida: string;
  jornadaHoras: number;
  almuerzoMinutos: number;
  almuerzoDesdeHoras: number;
  toleranciaMinutos: number;
  diasLaborales: string;
}

/** Horas que la persona está a disposición descontado el almuerzo, si lo hay. */
export function horasEfectivas(t: Pick<TurnoDatos, "horaEntrada" | "horaSalida" | "almuerzoMinutos" | "almuerzoDesdeHoras">): number {
  const lapso = minutosProgramados(t.horaEntrada, t.horaSalida);
  const almuerzo = lapso >= t.almuerzoDesdeHoras * 60 ? t.almuerzoMinutos : 0;
  return Math.round(((lapso - almuerzo) / 60) * 100) / 100;
}

export function validarTurno(t: TurnoDatos): { errores: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];
  if (parseHora(t.horaEntrada) === null) errores.push("La hora de entrada debe tener el formato HH:MM.");
  if (parseHora(t.horaSalida) === null) errores.push("La hora de salida debe tener el formato HH:MM.");
  const max = MAX_HORAS_JORNADA[t.tipoJornada];
  if (!(t.jornadaHoras > 0)) errores.push("Las horas ordinarias deben ser mayores que cero.");
  else if (t.jornadaHoras > max) {
    errores.push(`La jornada ${ETIQUETA_JORNADA[t.tipoJornada]} no puede pasar de ${max} horas ordinarias diarias (Arts. 321 y 322 del Código del Trabajo).`);
  }
  if (t.almuerzoMinutos < 0 || t.almuerzoMinutos > 180) errores.push("El almuerzo debe estar entre 0 y 180 minutos.");
  if (t.toleranciaMinutos < 0 || t.toleranciaMinutos > 60) errores.push("La tolerancia de llegada debe estar entre 0 y 60 minutos.");
  if (parseDias(t.diasLaborales).length === 0) errores.push("Marque al menos un día laboral.");
  if (errores.length === 0) {
    const efectivas = horasEfectivas(t);
    if (efectivas > t.jornadaHoras + 0.01) {
      avisos.push(`El horario programado da ${efectivas} horas efectivas y la jornada ordinaria es de ${t.jornadaHoras}: cada día generará ${Math.round((efectivas - t.jornadaHoras) * 100) / 100} h extra.`);
    }
    const semanal = t.jornadaHoras * parseDias(t.diasLaborales).length;
    const maxSemanal = { DIURNA: 44, MIXTA: 42, NOCTURNA: 36 }[t.tipoJornada];
    if (semanal > maxSemanal) avisos.push(`Suma ${semanal} horas ordinarias a la semana; el máximo de la jornada ${ETIQUETA_JORNADA[t.tipoJornada]} es ${maxSemanal}.`);
  }
  return { errores, avisos };
}

/** Texto para documentos: { jornada: "diurna", horario: "de lunes a viernes de 08:00 a 17:00" }. */
export function describirTurno(t: Pick<TurnoDatos, "tipoJornada" | "horaEntrada" | "horaSalida" | "diasLaborales">): { jornada: string; horario: string } {
  const dias = describirDias(parseDias(t.diasLaborales));
  const cruza = cruzaMedianoche(t.horaEntrada, t.horaSalida);
  return {
    jornada: ETIQUETA_JORNADA[t.tipoJornada],
    horario: `${dias ? `${dias} ` : ""}de ${t.horaEntrada} a ${t.horaSalida}${cruza ? " del día siguiente" : ""}`,
  };
}

/** Minutos del día (hora local del servidor, America/Tegucigalpa) de un instante. */
export function minutosDelDia(instante: Date): number {
  return instante.getHours() * 60 + instante.getMinutes();
}

/** Día ISO de la semana de una fecha de calendario: 1 = lunes … 7 = domingo. */
export function diaIso(fecha: Date): number {
  const d = fecha.getUTCDay();
  return d === 0 ? 7 : d;
}

export function esDiaLaboral(fecha: Date, diasLaborales: string): boolean {
  return parseDias(diasLaborales).includes(diaIso(fecha));
}

/**
 * Minutos de llegada tarde: lo que pase de la entrada programada más la
 * tolerancia. Es INFORMATIVO (reporte); no descuenta salario.
 */
export function minutosTardanza(horaEntradaReal: Date, t: Pick<TurnoDatos, "horaEntrada" | "toleranciaMinutos">): number {
  const programada = parseHora(t.horaEntrada);
  if (programada === null) return 0;
  const real = minutosDelDia(horaEntradaReal);
  // Más de 12 h «tarde» es en realidad una llegada temprana del turno siguiente o un dato raro.
  const diff = real - programada;
  if (diff > 12 * 60 || diff < 0) return 0;
  return Math.max(0, diff - t.toleranciaMinutos);
}

/**
 * ¿Una marca de madrugada pertenece a la jornada del día anterior?
 *
 * Sí, cuando el turno de AYER cruza la medianoche y la marca cae antes de la
 * salida programada más un margen. Así la salida de las 06:00 de un turno de
 * 22:00 a 06:00 queda en la jornada que empezó ayer, no como entrada de hoy.
 */
export function perteneceAlDiaAnterior(
  instante: Date,
  turnoAyer: Pick<TurnoDatos, "horaEntrada" | "horaSalida"> | null
): boolean {
  if (!turnoAyer || !cruzaMedianoche(turnoAyer.horaEntrada, turnoAyer.horaSalida)) return false;
  const salida = parseHora(turnoAyer.horaSalida);
  if (salida === null) return false;
  return minutosDelDia(instante) <= salida + MARGEN_SALIDA_NOCTURNA_MIN;
}
