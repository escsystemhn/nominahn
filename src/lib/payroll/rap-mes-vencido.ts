/**
 * RAP y Fondo de Reserva Laboral a MES VENCIDO. PURO.
 *
 * Por omisión (EN_CURSO) el RAP de cada planilla se calcula sobre el salario del mes
 * en que se paga, como dice el Art. 43 de la Ley del RAP. Muchas empresas lo calculan
 * sobre lo devengado el MES ANTERIOR, porque las comisiones del mes se conocen
 * después de cerrarlo: el RAP que se descuenta en noviembre es sobre octubre. Así se
 * pide en Parámetros de ley, y desde un mes concreto (`desde`).
 *
 * Con la opción (pedido de Edbin y su contadora, 2026-11-13):
 *  · La base del mes M es lo devengado en M−1: el salario ordinario de las planillas
 *    ya confirmadas de ese mes, más lo que se importe (las comisiones). Una base
 *    importada reemplaza a la calculada.
 *  · Va igual al RAP del trabajador, al del patrono y a la Reserva Laboral del 4 %.
 *  · Quien entra en M no cotiza en M: no devengó nada en M−1. Paga M en M+1.
 *  · Quien sale en M paga en sus planillas de M lo de M−1, como todos. Lo de M (y lo
 *    de M−1 que esas planillas no alcanzaron) lo toma su LIQUIDACIÓN (pedido de Edbin,
 *    2026-11-13); con la liquidación guardada, sus planillas de M ya no descuentan RAP.
 *  · Lo descontado en el mes se entera al RAP del 1 al 10 del mes siguiente, dentro de
 *    los 15 días del Art. 43 (práctica de la empresa).
 *  · El primer mes (`desde`) es de transición: lo de M−1 ya se cotizó en su propio
 *    mes con la regla anterior, así que sólo se cobra lo que se importe.
 */

import { z } from "zod";
import { CERO, money, type Money } from "./money";
import { calcularRAP, calcularReservaLaboral, escalarMontosFijos, type ParametrosLegales } from "./calculos-hn";

export type ModoBaseRap = "EN_CURSO" | "ANTERIOR";

export interface BaseRapConfig {
  modo: ModoBaseRap;
  /** Primer mes a mes vencido, «AAAA-MM». Obligatorio con ANTERIOR. */
  desde: string | null;
}

export const BASE_RAP_POR_OMISION: BaseRapConfig = { modo: "EN_CURSO", desde: null };

/** Clave en ConfiguracionSistema (valor JSON). */
export const CLAVE_BASE_RAP = "RAP_BASE_MES";

const zMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (AAAA-MM)");
export const schemaBaseRap = z
  .object({ modo: z.enum(["EN_CURSO", "ANTERIOR"]), desde: zMes.nullable() })
  .refine((c) => c.modo === "EN_CURSO" || c.desde !== null, { message: "Indique desde qué mes", path: ["desde"] })
  .transform((c): BaseRapConfig => (c.modo === "EN_CURSO" ? { modo: "EN_CURSO", desde: null } : c));

/** Lo guardado; un valor que no se entiende vale como EN_CURSO. */
export function normalizarBaseRap(guardado: unknown): BaseRapConfig {
  let v = guardado;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const r = schemaBaseRap.safeParse(v);
  return r.success ? r.data : { ...BASE_RAP_POR_OMISION };
}

// ─── MESES ───────────────────────────────────────────────────────────────────

/** «AAAA-MM» de una fecha (UTC, como todas las fechas de planilla). */
export function mesDe(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function partesMes(mes: string): { anio: number; mes: number } {
  const [a, m] = mes.split("-").map(Number);
  return { anio: a, mes: m };
}

export function mesAnterior(mes: string): string {
  const { anio, mes: m } = partesMes(mes);
  return m === 1 ? `${anio - 1}-12` : `${anio}-${String(m - 1).padStart(2, "0")}`;
}

export function mesSiguiente(mes: string): string {
  const { anio, mes: m } = partesMes(mes);
  return m === 12 ? `${anio + 1}-01` : `${anio}-${String(m + 1).padStart(2, "0")}`;
}

/** Primer y último día del mes. */
export function rangoMes(mes: string): { desde: Date; hasta: Date } {
  const { anio, mes: m } = partesMes(mes);
  return { desde: new Date(Date.UTC(anio, m - 1, 1)), hasta: new Date(Date.UTC(anio, m, 0)) };
}

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** «octubre de 2026». */
export function nombreMes(mes: string): string {
  const { anio, mes: m } = partesMes(mes);
  return `${NOMBRES_MES[m - 1]} de ${anio}`;
}

// ─── REGLA DEL MES ───────────────────────────────────────────────────────────

/** Qué rige para las planillas del mes `mes`. */
export type ReglaRap = "EN_CURSO" | "TRANSICION" | "ANTERIOR";

export function reglaDelMes(c: BaseRapConfig, mes: string): ReglaRap {
  if (c.modo !== "ANTERIOR" || !c.desde || mes < c.desde) return "EN_CURSO";
  return mes === c.desde ? "TRANSICION" : "ANTERIOR";
}

export type OrigenBaseRap = "IMPORTADA" | "PLANILLAS" | "SIN_BASE";

/**
 * La base del mes vencido de un empleado. La importada manda (trae las comisiones o
 * una corrección); si no hay, lo devengado en las planillas confirmadas del mes
 * anterior. En el mes de transición sólo cuenta la importada.
 */
export function baseDelMes(regla: Exclude<ReglaRap, "EN_CURSO">, importada: Money | null, dePlanillas: Money): { base: Money; origen: OrigenBaseRap } {
  if (importada !== null) return { base: importada, origen: "IMPORTADA" };
  if (regla === "TRANSICION" || dePlanillas.isZero()) return { base: CERO, origen: "SIN_BASE" };
  return { base: dePlanillas, origen: "PLANILLAS" };
}

// ─── AL SALIR: LO QUE TOMA LA LIQUIDACIÓN ────────────────────────────────────

/** Concepto con que la liquidación guarda el RAP pendiente (ver `liquidacion.ts`). */
export const CLAVE_RAP_PENDIENTE = "RAP_PENDIENTE";

export interface MesPendienteRap {
  mes: string;
  base: Money;
  /** Su base no salió en ninguna planilla: se declara con el finiquito. */
  declarar: boolean;
  empleado: Money;
  empleador: Money;
  reserva: Money;
}

export interface RapPendienteSalida {
  meses: MesPendienteRap[];
  empleado: Money;
  empleador: Money;
  reserva: Money;
}

/**
 * Lo que queda por cotizar de quien sale, a mes vencido. En las planillas de su mes de
 * salida se descuenta el RAP del mes anterior; el de su mes de salida ya no tendría
 * planilla siguiente donde cobrarse. La liquidación toma:
 *  · lo del mes anterior que esas planillas no alcanzaron a descontar (todo, si no
 *    salió en ninguna), y
 *  · lo devengado en el mes de salida (con monto fijo general, su fracción).
 */
export function rapPendienteDeSalida(
  e: {
    mesSalida: string;
    /** Base del mes anterior: importada o de sus planillas; 0 en la transición sin importar. */
    baseAnterior: Money;
    /** Lo que ya descontaron las planillas confirmadas del mes de salida. */
    descontado: { empleado: Money; empleador: Money; reserva: Money };
    salarioMensual: Money | number | string;
    /** Días con derecho a salario en el mes de salida, de 30. */
    diasEnElMes: number;
  },
  p: ParametrosLegales
): RapPendienteSalida {
  const meses: MesPendienteRap[] = [];
  const positivo = (m: Money) => (m.isNegative() ? CERO : m);

  const rapA = calcularRAP(e.baseAnterior, p);
  const reservaA = calcularReservaLaboral(e.baseAnterior, p).empleador;
  const anterior = {
    empleado: positivo(rapA.empleado.minus(e.descontado.empleado)),
    empleador: positivo(rapA.empleador.minus(e.descontado.empleador)),
    reserva: positivo(reservaA.minus(e.descontado.reserva)),
  };
  if (!anterior.empleado.plus(anterior.empleador).plus(anterior.reserva).isZero()) {
    const nadaDescontado = e.descontado.empleado.plus(e.descontado.empleador).plus(e.descontado.reserva).isZero();
    meses.push({ mes: mesAnterior(e.mesSalida), base: e.baseAnterior, declarar: nadaDescontado, ...anterior });
  }

  const pend = pendienteDeSalida(e.salarioMensual, e.diasEnElMes);
  if (pend) {
    const pPend = escalarMontosFijos(p, pend.fraccion);
    const r = calcularRAP(pend.base, pPend);
    const reserva = calcularReservaLaboral(pend.base, pPend).empleador;
    if (!r.empleado.plus(r.empleador).plus(reserva).isZero()) {
      meses.push({ mes: e.mesSalida, base: pend.base, declarar: true, empleado: r.empleado, empleador: r.empleador, reserva });
    }
  }

  const suma = (k: "empleado" | "empleador" | "reserva") => meses.reduce((acc, m) => acc.plus(m[k]), CERO);
  return { meses, empleado: suma("empleado"), empleador: suma("empleador"), reserva: suma("reserva") };
}

/**
 * Lo devengado en el mes de salida, sobre lo que la liquidación cobra el RAP de ese
 * mes. `fraccion` = días con derecho a salario del mes / 30.
 */
export function pendienteDeSalida(salarioMensual: Money | number | string, diasEnElMes: number): { base: Money; fraccion: Money } | null {
  const dias = Math.min(Math.max(diasEnElMes, 0), 30);
  if (dias === 0) return null;
  const fraccion = money(dias).div(30);
  return { base: money(salarioMensual).times(fraccion), fraccion };
}
