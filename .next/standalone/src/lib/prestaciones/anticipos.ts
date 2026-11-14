/**
 * Anticipos de prestaciones pagados aparte de la planilla (AnticipoPrestacion):
 * la negociación de prestaciones, que se rebaja de la cesantía, y los adelantos del
 * 13.º y 14.º, que se rebajan del décimo. Funciones puras: las usan la liquidación
 * final, el cálculo de décimos, la pantalla y el tablero.
 */
import type { TipoAnticipoPrestacion, TipoDecimo } from "@prisma/client";
import { money, minimo, redondear, sumar, CERO, type Money, type MoneyInput } from "@/lib/payroll/money";

export const ETIQUETA_ANTICIPO: Record<TipoAnticipoPrestacion, string> = {
  NEGOCIACION_PRESTACIONES: "Negociación de prestaciones",
  ADELANTO_DECIMO_TERCERO: "Adelanto del décimo tercer mes",
  ADELANTO_DECIMO_CUARTO: "Adelanto del décimo cuarto mes",
};

/** El tipo de adelanto que corresponde a cada décimo. */
export const ADELANTO_DE: Record<TipoDecimo, TipoAnticipoPrestacion> = {
  DECIMO_TERCERO: "ADELANTO_DECIMO_TERCERO",
  DECIMO_CUARTO: "ADELANTO_DECIMO_CUARTO",
};

/** Conceptos con que la rebaja aparece en el finiquito. */
export const CONCEPTO_NEGOCIACION = "Negociación de prestaciones ya pagada";
export const CONCEPTO_ADELANTO_13 = "Adelanto del décimo tercer mes ya pagado";
export const CONCEPTO_ADELANTO_14 = "Adelanto del décimo cuarto mes ya pagado";

export interface AnticipoARepartir {
  id: string;
  monto: MoneyInput;
  fechaPago: Date;
}

export interface Reparto {
  /** Lo que se rebaja en total: nunca más que `disponible`. */
  aplicado: Money;
  /** Cuánto se toma de cada anticipo, del más antiguo al más reciente. */
  partes: { id: string; monto: Money }[];
  /** Lo pagado que no cupo: se informa, no se cobra de otros conceptos. */
  exceso: Money;
}

/**
 * Rebaja varios anticipos de un importe (la cesantía o el décimo), del más antiguo al
 * más reciente, sin pasar del importe: nunca deja un saldo negativo.
 */
export function repartirAnticipos(anticipos: readonly AnticipoARepartir[], disponible: MoneyInput): Reparto {
  let resta = money(disponible).greaterThan(0) ? money(disponible) : CERO;
  const ordenados = [...anticipos].sort((a, b) => a.fechaPago.getTime() - b.fechaPago.getTime() || a.id.localeCompare(b.id));
  const partes: Reparto["partes"] = [];
  for (const a of ordenados) {
    const monto = money(a.monto);
    if (!monto.greaterThan(0) || !resta.greaterThan(0)) continue;
    const parte = redondear(minimo(monto, resta));
    partes.push({ id: a.id, monto: parte });
    resta = resta.minus(parte);
  }
  const total = sumar(...anticipos.map((a) => maxCero(a.monto)));
  const aplicado = redondear(sumar(...partes.map((p) => p.monto)));
  return { aplicado, partes, exceso: redondear(total.minus(aplicado)) };
}

const maxCero = (m: MoneyInput) => (money(m).greaterThan(0) ? money(m) : CERO);

/**
 * Año de PAGO del décimo cuya ventana contiene la fecha. El 13.º devenga en el año
 * natural; el 14.º de julio a junio y se paga en junio, así que desde julio la fecha ya
 * pertenece al 14.º del año siguiente.
 *
 * POR QUÉ: la liquidación usaba el año de la salida para los dos. Para una salida de
 * octubre calculaba el 14.º de julio a junio (ya pagado en junio) y lo de julio a
 * octubre no se pagaba nunca.
 */
export function anioDecimoEnCurso(tipo: TipoDecimo, fecha: Date): number {
  const anio = fecha.getUTCFullYear();
  return tipo === "DECIMO_CUARTO" && fecha.getUTCMonth() >= 6 ? anio + 1 : anio;
}
