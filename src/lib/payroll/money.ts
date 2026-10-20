/**
 * Tipo monetario exacto para todo el módulo de nómina.
 *
 * POR QUÉ: los `number` de JavaScript son float64 binario. 0.1 + 0.2 no es 0.3, y
 * `Math.round(1.005 * 100) / 100` devuelve 1.00 en vez de 1.01 porque 1.005 no es
 * representable en binario. En una planilla de 200 empleados esos centavos se
 * acumulan y descuadran contra la partida contable.
 *
 * QUÉ USAMOS: la clase Decimal que Prisma ya incluye (decimal.js). Es exactamente
 * la misma que Prisma devuelve al leer columnas `Decimal` y la que acepta al
 * escribirlas, así que los importes viajan de la BD al motor y de vuelta SIN pasar
 * nunca por `Number()` — que es justo donde se pierde la precisión.
 *
 * Todo el resto del módulo importa el tipo monetario desde aquí y no desde Prisma,
 * para que cambiar de librería sea un cambio de un solo archivo.
 */

import { Prisma } from "@prisma/client";

export const Money = Prisma.Decimal;
export type Money = Prisma.Decimal;

/** Cualquier cosa convertible a un importe exacto. */
export type MoneyInput = number | string | Prisma.Decimal;

/**
 * Redondeo comercial (half-up): 1.005 → 1.01. Es el criterio de nómina en HN.
 *
 * Se pasa explícito en cada llamada en vez de mutar la configuración global de
 * Decimal, porque esa configuración la comparte Prisma y no debemos alterarla.
 */
export const REDONDEO = Prisma.Decimal.ROUND_HALF_UP;

/** Precisión de un importe en Lempiras. */
export const DECIMALES = 2;

export const CERO: Money = new Money(0);

/** Convierte a Money. `null`/`undefined`/vacío se tratan como cero. */
export function money(v: MoneyInput | null | undefined): Money {
  if (v === null || v === undefined || v === "") return CERO;
  return v instanceof Money ? v : new Money(v);
}

/** Redondea a centavos con redondeo comercial. Usar al materializar un importe. */
export function redondear(v: MoneyInput, decimales: number = DECIMALES): Money {
  return money(v).toDecimalPlaces(decimales, REDONDEO);
}

/** Suma exacta de una lista de importes. */
export function sumar(...valores: (MoneyInput | null | undefined)[]): Money {
  return valores.reduce<Money>((acc, v) => acc.plus(money(v)), CERO);
}

/** Suma exacta de un campo a lo largo de una colección. */
export function sumarPor<T>(items: T[], selector: (item: T) => MoneyInput | null | undefined): Money {
  return items.reduce<Money>((acc, item) => acc.plus(money(selector(item))), CERO);
}

/** El mayor de dos importes. */
export function maximo(a: MoneyInput, b: MoneyInput): Money {
  const [x, y] = [money(a), money(b)];
  return x.greaterThan(y) ? x : y;
}

/** El menor de dos importes. */
export function minimo(a: MoneyInput, b: MoneyInput): Money {
  const [x, y] = [money(a), money(b)];
  return x.lessThan(y) ? x : y;
}

/** Acota un importe entre un piso y un techo. */
export function acotar(v: MoneyInput, piso: MoneyInput, techo: MoneyInput): Money {
  return minimo(maximo(v, piso), techo);
}

export function esCero(v: MoneyInput | null | undefined): boolean {
  return money(v).isZero();
}

/**
 * Conversión a `number`, SOLO para presentación (JSON, PDF, CSV) o para APIs que
 * no aceptan Decimal. Nunca usar como paso intermedio de un cálculo.
 */
export function aNumero(v: MoneyInput | null | undefined): number {
  return money(v).toNumber();
}
