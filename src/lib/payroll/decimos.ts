/**
 * Liquidación del décimo tercer y décimo cuarto mes (Honduras).
 *
 * QUÉ FALTABA: el sistema sólo calculaba la PROVISIÓN mensual dentro de
 * PlanillaDetalle —un apunte contable— pero no había forma de consultar el
 * acumulado de un empleado ni de emitir el pago. Las dos obligaciones más
 * visibles del calendario laboral hondureño no se podían liquidar.
 *
 * MARCO LEGAL
 *   · Décimo tercer mes (aguinaldo, Decreto 112-82): devenga del 1 de enero al
 *     31 de diciembre y se paga en diciembre.
 *   · Décimo cuarto mes (compensación educativa, Decreto 135-94): devenga del
 *     1 de julio al 30 de junio y se paga en junio.
 *   · Ambos equivalen a un mes de salario por año completo de servicio, y al
 *     proporcional cuando el servicio es menor (ingreso o baja a mitad del
 *     período de devengo).
 *   · Están EXENTOS del ISR hasta el equivalente a diez salarios mínimos
 *     promedio, contados entre los dos (Art. 11 Ley del ISR). El excedente
 *     tributa.
 *   · NO cotizan IHSS ni RAP: no son salario ordinario.
 *
 * Es lógica pura (sin Prisma ni red) para poder probarse de forma aislada.
 */

import { money, redondear, maximo, minimo, sumar, CERO, type Money, type MoneyInput } from "./money";
import { calcularISRMensual, type ParametrosLegales, PARAMETROS_DEFAULT } from "./calculos-hn";

export type TipoDecimo = "DECIMO_TERCERO" | "DECIMO_CUARTO";

/** Días del año que se toman como base del devengo: un mes por cada 360. */
export const DIAS_ANIO_COMERCIAL = 360;

/**
 * Número de salarios mínimos promedio exentos de ISR, contando ambos décimos
 * en conjunto (Art. 11 Ley del ISR). Parametrizable por si cambia por decreto.
 */
export const SALARIOS_MINIMOS_EXENTOS = 10;

const MS_DIA = 24 * 60 * 60 * 1000;

export interface VentanaDevengo {
  desde: Date;
  hasta: Date;
}

/**
 * Ventana de devengo de un décimo para un año dado.
 *
 * El décimo TERCERO devenga sobre el año natural; el CUARTO sobre el año que va
 * de julio a junio, y el `anio` es el del PAGO (junio), de modo que la ventana
 * empieza en julio del año anterior.
 */
export function ventanaDevengo(tipo: TipoDecimo, anio: number): VentanaDevengo {
  if (tipo === "DECIMO_TERCERO") {
    return {
      desde: new Date(Date.UTC(anio, 0, 1)),
      hasta: new Date(Date.UTC(anio, 11, 31)),
    };
  }
  return {
    desde: new Date(Date.UTC(anio - 1, 6, 1)),  // 1 de julio del año anterior
    hasta: new Date(Date.UTC(anio, 5, 30)),     // 30 de junio del año de pago
  };
}

/** Mes en que se paga cada décimo (0-indexado, como `Date.getUTCMonth`). */
export function mesDePago(tipo: TipoDecimo): number {
  return tipo === "DECIMO_TERCERO" ? 11 : 5; // diciembre / junio
}

export interface EntradaDecimo {
  tipo: TipoDecimo;
  /** Año del PAGO. */
  anio: number;
  fechaIngreso: Date;
  fechaSalida?: Date | null;
  /**
   * Salario ordinario promedio del período de devengo. Cuando el salario no
   * varió es el salario base; si hubo aumentos, el promedio ponderado.
   */
  salarioPromedio: MoneyInput;
  /**
   * Corte del devengo. Por defecto el fin de la ventana; se adelanta para
   * proyectar el acumulado a una fecha intermedia o para liquidar una baja.
   */
  hasta?: Date;
}

export interface ResultadoDecimo {
  tipo: TipoDecimo;
  anio: number;
  periodoDesde: Date;
  periodoHasta: Date;
  diasComputados: number;
  salarioPromedio: Money;
  montoDevengado: Money;
  /** true cuando no cubre la ventana completa (ingreso o baja intermedios). */
  esProporcional: boolean;
}

/**
 * Devengo de un décimo: un mes de salario por año completo, proporcional al
 * tiempo de servicio dentro de la ventana.
 *
 *   monto = salarioPromedio × díasComputados ÷ 360
 */
export function calcularDecimo(entrada: EntradaDecimo): ResultadoDecimo {
  const { tipo, anio, fechaIngreso, fechaSalida, salarioPromedio, hasta } = entrada;
  const ventana = ventanaDevengo(tipo, anio);

  // Tramo efectivo = intersección de la ventana con la relación laboral.
  const inicio = fechaIngreso > ventana.desde ? fechaIngreso : ventana.desde;
  const corte = hasta && hasta < ventana.hasta ? hasta : ventana.hasta;
  const fin = fechaSalida && fechaSalida < corte ? fechaSalida : corte;

  const salario = redondear(salarioPromedio);

  if (fin < inicio) {
    return {
      tipo, anio,
      periodoDesde: inicio,
      periodoHasta: inicio,
      diasComputados: 0,
      salarioPromedio: salario,
      montoDevengado: CERO,
      esProporcional: true,
    };
  }

  // Inclusivo en ambos extremos: el día de ingreso y el de salida se trabajan.
  const diasEfectivos = Math.floor((fin.getTime() - inicio.getTime()) / MS_DIA) + 1;
  // El tope es el año comercial: nadie devenga más de un mes de salario.
  const diasComputados = Math.min(diasEfectivos, DIAS_ANIO_COMERCIAL);

  const montoDevengado = redondear(
    salario.times(diasComputados).div(DIAS_ANIO_COMERCIAL)
  );

  const cubreVentanaCompleta =
    inicio.getTime() === ventana.desde.getTime() && fin.getTime() === ventana.hasta.getTime();

  return {
    tipo, anio,
    periodoDesde: inicio,
    periodoHasta: fin,
    diasComputados,
    salarioPromedio: salario,
    montoDevengado,
    esProporcional: !cubreVentanaCompleta,
  };
}

// ─── EXENCIÓN E ISR ──────────────────────────────────────────────────────────

export interface DesgloseFiscalDecimo {
  /** Techo exento aplicable a ESTE décimo, tras descontar lo ya usado. */
  techoExento: Money;
  montoExento: Money;
  montoGravado: Money;
  isrRetenido: Money;
  montoNeto: Money;
}

/**
 * Reparte un décimo entre porción exenta y gravada, y calcula la retención.
 *
 * El techo de diez salarios mínimos es CONJUNTO para los dos décimos: si el
 * décimo cuarto ya consumió parte, al décimo tercero le queda el resto. Por eso
 * `exentoYaUsado` es un parámetro y no una constante.
 *
 * El ISR sobre el excedente se calcula con la misma tabla progresiva anual que
 * el salario, tratando el excedente como renta adicional del año.
 */
export function aplicarFiscalidadDecimo(opts: {
  montoDevengado: MoneyInput;
  salarioMinimo: MoneyInput;
  /** Porción del techo conjunto ya consumida por el otro décimo del mismo año. */
  exentoYaUsado?: MoneyInput;
  /** Renta gravable anual del trabajador por su salario ordinario. */
  rentaOrdinariaAnual?: MoneyInput;
  salariosMinimosExentos?: number;
  parametros?: ParametrosLegales;
}): DesgloseFiscalDecimo {
  const {
    montoDevengado,
    salarioMinimo,
    exentoYaUsado = 0,
    rentaOrdinariaAnual = 0,
    salariosMinimosExentos = SALARIOS_MINIMOS_EXENTOS,
    parametros = PARAMETROS_DEFAULT,
  } = opts;

  const monto = money(montoDevengado);
  const techoConjunto = money(salarioMinimo).times(salariosMinimosExentos);
  const techoExento = maximo(techoConjunto.minus(money(exentoYaUsado)), 0);

  const montoExento = minimo(monto, techoExento);
  const montoGravado = maximo(monto.minus(montoExento), 0);

  // El excedente tributa como renta adicional: se calcula el ISR anual con y sin
  // él, y la diferencia es la retención que corresponde a este décimo. Aplicarle
  // la tabla de forma aislada daría de menos, porque ignoraría el tramo en que
  // ya está el trabajador por su salario.
  let isrRetenido = CERO;
  if (montoGravado.greaterThan(0)) {
    const ordinaria = money(rentaOrdinariaAnual);
    // `calcularISRMensual` recibe base MENSUAL y devuelve retención mensual;
    // multiplicando por 12 se recupera el impuesto anual de cada escenario.
    const isrSinDecimo = calcularISRMensual(ordinaria.div(12), parametros).times(12);
    const isrConDecimo = calcularISRMensual(ordinaria.plus(montoGravado).div(12), parametros).times(12);
    isrRetenido = redondear(maximo(isrConDecimo.minus(isrSinDecimo), 0));
  }

  return {
    techoExento: redondear(techoExento),
    montoExento: redondear(montoExento),
    montoGravado: redondear(montoGravado),
    isrRetenido,
    montoNeto: redondear(monto.minus(isrRetenido)),
  };
}

/**
 * Liquidación completa: devengo más tratamiento fiscal.
 *
 * Es lo que se guarda en `LiquidacionDecimo` y lo que se paga al trabajador.
 */
export function liquidarDecimo(
  entrada: EntradaDecimo,
  fiscal: {
    salarioMinimo: MoneyInput;
    exentoYaUsado?: MoneyInput;
    rentaOrdinariaAnual?: MoneyInput;
    parametros?: ParametrosLegales;
  }
): ResultadoDecimo & DesgloseFiscalDecimo {
  const devengo = calcularDecimo(entrada);
  const desglose = aplicarFiscalidadDecimo({
    montoDevengado: devengo.montoDevengado,
    ...fiscal,
  });
  return { ...devengo, ...desglose };
}

/**
 * Salario promedio ponderado por los días en que estuvo vigente cada importe.
 *
 * El devengo se calcula sobre el salario ORDINARIO promedio del período, no
 * sobre el último: un aumento en noviembre no debe inflar el aguinaldo entero.
 */
export function salarioPromedioPonderado(
  tramos: { salario: MoneyInput; dias: number }[]
): Money {
  const diasTotales = tramos.reduce((acc, t) => acc + t.dias, 0);
  if (diasTotales <= 0) return CERO;

  const ponderado = sumar(
    ...tramos.map((t) => money(t.salario).times(t.dias))
  );
  return redondear(ponderado.div(diasTotales));
}
