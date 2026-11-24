/**
 * Horas extra del período: las que trae el formato de captura por sucursal, una cantidad
 * por recargo (25, 50, 75 y 100 %) para toda la quincena. Pedido de Edbin (2026-11-23):
 * que el Excel de deducciones lleve también las horas extra, en cantidades, antes que las
 * deducciones. PURO.
 *
 * Se guardan en `HorasExtraPeriodo` con las fechas del período. En la planilla de esas
 * fechas cada recargo con valor REEMPLAZA lo que sumen los marcajes de ese recargo (como
 * un monto del período a la deducción de cada planilla); uno en null deja lo de los
 * marcajes. Así importar de nuevo corrige sin duplicar, y lo que marque el reloj no se
 * suma encima de lo que la empresa ya contó.
 */

import type { HorasExtraPorJornada } from "./calculos-hn";

export type ClaveRecargo = "diurnas" | "mixtas" | "nocturnas" | "feriado";

export interface Recargo {
  clave: ClaveRecargo;
  porcentaje: 25 | 50 | 75 | 100;
  /** Va entre paréntesis debajo del encabezado del formato: así se reconoce la columna. */
  codigo: string;
  etiqueta: string;
}

/** En el orden en que van en el archivo. */
export const RECARGOS: readonly Recargo[] = [
  { clave: "diurnas", porcentaje: 25, codigo: "HE-25", etiqueta: "Horas extra 25 %" },
  { clave: "mixtas", porcentaje: 50, codigo: "HE-50", etiqueta: "Horas extra 50 %" },
  { clave: "nocturnas", porcentaje: 75, codigo: "HE-75", etiqueta: "Horas extra 75 %" },
  { clave: "feriado", porcentaje: 100, codigo: "HE-100", etiqueta: "Horas extra 100 %" },
];

/** Horas de cada recargo. */
export type HorasPorRecargo = Record<ClaveRecargo, number>;
/** Lo fijado para el período: null = se usan las de los marcajes. */
export type HorasFijadas = Record<ClaveRecargo, number | null>;

export const SIN_HORAS: HorasPorRecargo = { diurnas: 0, mixtas: 0, nocturnas: 0, feriado: 0 };

/** Tope por celda: un período de un mes con 12 horas diarias no llega. Ataja el tecleo que multiplica por diez. */
export const HORAS_MAXIMAS_PERIODO = 400;

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Lo que suman los marcajes de un empleado en el período. Un marcaje de antes del desglose
 * (o del biométrico) sólo trae el total: va al 25 %, como siempre se pagó.
 */
export function sumarMarcajes(marcajes: Iterable<{
  horasExtra: unknown; horasExtraDiurna: unknown; horasExtraMixta: unknown; horasExtraNocturna: unknown; horasFeriado: unknown;
}>): HorasPorRecargo {
  const acc = { ...SIN_HORAS };
  for (const m of marcajes) {
    const diurnas = Number(m.horasExtraDiurna);
    const mixtas = Number(m.horasExtraMixta);
    const nocturnas = Number(m.horasExtraNocturna);
    const feriado = Number(m.horasFeriado);
    if (diurnas + mixtas + nocturnas + feriado === 0 && Number(m.horasExtra) > 0) {
      acc.diurnas += Number(m.horasExtra);
    } else {
      acc.diurnas += diurnas;
      acc.mixtas += mixtas;
      acc.nocturnas += nocturnas;
      acc.feriado += feriado;
    }
  }
  return acc;
}

/** Junta lo fijado de los registros que caen en el período (normalmente uno). */
export function combinarFijadas(registros: Iterable<Partial<Record<ClaveRecargo, unknown>>>): HorasFijadas | null {
  let salida: HorasFijadas | null = null;
  for (const r of registros) {
    salida ??= { diurnas: null, mixtas: null, nocturnas: null, feriado: null };
    for (const { clave } of RECARGOS) {
      const v = r[clave];
      if (v === null || v === undefined) continue;
      salida[clave] = redondear((salida[clave] ?? 0) + Number(v));
    }
  }
  return salida;
}

/** Lo que paga la planilla: lo fijado para el período y, en cada recargo sin fijar, lo de los marcajes. */
export function horasDelPeriodo(deMarcajes: HorasExtraPorJornada, fijadas: HorasFijadas | null | undefined): HorasExtraPorJornada {
  if (!fijadas) return deMarcajes;
  const salida: HorasExtraPorJornada = { ...deMarcajes };
  for (const { clave } of RECARGOS) {
    const v = fijadas[clave];
    if (v !== null) salida[clave] = v;
  }
  return salida;
}

/** Lo que dirá la celda del formato: lo fijado o, si no hay, lo de los marcajes. */
export function horasEnCelda(fijadas: HorasFijadas | null | undefined, deMarcajes: HorasPorRecargo | undefined, clave: ClaveRecargo): number {
  return fijadas?.[clave] ?? deMarcajes?.[clave] ?? 0;
}

/**
 * La columna de un recargo, por su código («(HE-25)», el del formato) o por como la llaman
 * las planillas hechas a mano: «Horas extra 25 %», «H.E. 25%», «HE 50», «Extra 75 %»,
 * «Horas al 100 %», «Horas extras 25».
 */
export function recargoDeCabecera(cabecera: string): Recargo | null {
  const codigo = /\(\s*(HE-(?:25|50|75|100))\s*\)\s*$/i.exec(cabecera)?.[1]?.toUpperCase();
  if (codigo) return RECARGOS.find((r) => r.codigo === codigo) ?? null;
  const t = cabecera.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const m = /^(horas?|hrs?)?\s*(extras?|extraordinarias?|h e|he|tiempo extra)?\s*(?:al|de|a)?\s*(25|50|75|100)(?: por ciento)?$/.exec(t);
  // Un «25» suelto no es nada: hace falta «horas» o «extra» (o «HE»).
  if (!m || (!m[1] && !m[2])) return null;
  return RECARGOS.find((r) => String(r.porcentaje) === m[3]) ?? null;
}

export type DecisionHoras =
  | { accion: "IGUAL" }
  | { accion: "PONER"; valor: number; antes: number; despues: number }
  | { accion: "QUITAR"; antes: number; despues: number };

/**
 * Qué hacer con la celda de un recargo. PONER lo fija para el período; QUITAR vuelve a lo
 * de los marcajes, cuando lo nuevo es justo eso (así no queda nada fijado sin necesidad).
 */
export function decidirHoras(fijada: number | null, deMarcajes: number, nuevo: number): DecisionHoras {
  const antes = fijada ?? deMarcajes;
  if (redondear(nuevo) === redondear(antes)) return { accion: "IGUAL" };
  if (fijada !== null && redondear(nuevo) === redondear(deMarcajes)) return { accion: "QUITAR", antes, despues: deMarcajes };
  return { accion: "PONER", valor: redondear(nuevo), antes, despues: redondear(nuevo) };
}

/** «8 h», «2.5 h», «—» para cero. */
export function textoHoras(n: number): string {
  return n === 0 ? "—" : `${redondear(n).toLocaleString("es-HN", { maximumFractionDigits: 2 })} h`;
}
