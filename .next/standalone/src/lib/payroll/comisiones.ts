/**
 * Planilla de comisiones: las retenciones y aportes de una comisión que se paga
 * en una planilla aparte de la ordinaria (la quincenal o mensual del salario).
 *
 * LA REGLA. La comisión es salario (C.T. Art. 361) y el IHSS, el RAP, el ISR y el
 * impuesto vecinal se calculan sobre lo pagado en el MES, con techos y tablas por
 * tramos. Esta planilla lleva sólo el AUMENTO que la comisión causa sobre lo que ya
 * causa el salario del mes de pago:
 *
 *     aporte de la comisión = f(salario + comisiones del mes) − f(salario + comisiones ya pagadas ese mes)
 *
 * POR QUÉ ASÍ Y NO «contra lo ya retenido». Las quincenas calculan cada una la mitad
 * de f(salario), sin saber de comisiones, y así se quedan. La suma del mes da
 * entonces f(salario + comisiones) aunque la comisión se pague antes, entre o después
 * de las quincenas: no hay que esperarlas ni volver a calcularlas, y el día de pago
 * deja de importar. Sólo importa el MES de pago (decisión 3 del FAQ).
 *
 * LO QUE NO TOCA. Préstamos, cooperativa, adelantos, AFP y demás cuotas se cobran en
 * la planilla ordinaria: aquí no se leen, porque cada cálculo de la ordinaria ya
 * consume una cuota (`aplicarDeducciones`) y repetirla cobraría dos en el mes. Una
 * cuota que el empleado autorizó cobrar de sus comisiones (decisión 6) llega ya
 * resuelta en `deduccionesAutorizadas` y debe excluirse de la ordinaria.
 *
 * Función pura: sin base de datos, para probarla aislada. Todavía no la usa ninguna
 * planilla; espera las decisiones firmadas del FAQ de comisiones.
 */

import { money, maximo, redondear, sumar, CERO, type Money, type MoneyInput } from "./money";
import {
  calcularIHSS,
  calcularImpuestoVecinal,
  calcularISRMensual,
  calcularRAP,
  calcularReservaLaboral,
  type ParametrosLegales,
} from "./calculos-hn";
import { calcularIsrPersonalizado, type EntradaIsrPersonalizado } from "./isr-personalizado";

/** Las decisiones del FAQ de comisiones que cambian el cálculo. */
export interface CriteriosComision {
  /** Decisión 1: la comisión cuenta como salario ordinario para el RAP y la Reserva Laboral. */
  cotizaRapYReserva: boolean;
  /** Decisión 5: se retiene cada mes la diferencia del impuesto vecinal. */
  retieneVecinal: boolean;
}

export interface EntradaComision {
  comision: MoneyInput;
  /** Salario mensual vigente en el mes de pago: el que ya cotizan las quincenas. */
  salarioMensual: MoneyInput;
  /** Comisiones de OTRAS planillas de comisiones pagadas en el mismo mes. Casi siempre cero. */
  comisionesPreviasDelMes?: MoneyInput;
  /** IHSS mensual pactado en la ficha. Con él, el trabajador ya pagó su monto del mes. */
  ihssMontoFijoMensual?: MoneyInput | null;
  /** AFP mensual del empleado: se resta de la base del ISR, igual que en la ordinaria. */
  afpMensual?: MoneyInput;
  /** Cuotas que el empleado autorizó cobrar de sus comisiones (decisión 6), ya resueltas. */
  deduccionesAutorizadas?: MoneyInput;
  /**
   * Con el cálculo personalizado del ISR, la retención ya resuelta por
   * `isrComisionPersonalizado`. Sin ella se usa el método estándar.
   */
  isrPersonalizado?: MoneyInput;
}

export interface LineaComision {
  comision: Money;
  // Al trabajador
  emEmpleado: Money;
  ivmEmpleado: Money;
  ihssEmpleado: Money;
  rapEmpleado: Money;
  isr: Money;
  impuestoVecinal: Money;
  deduccionesAutorizadas: Money;
  totalDeducciones: Money;
  neto: Money;
  // A la empresa
  ihssEmpleador: Money;
  ivmEmpleador: Money;
  ivmEstado: Money;
  rapEmpleador: Money;
  reservaLaboral: Money;
  infop: Money;
  totalEmpleador: Money;
}

const aumento = (antes: MoneyInput, despues: MoneyInput) => redondear(maximo(money(despues).minus(antes), 0));

export function calcularLineaComision(e: EntradaComision, p: ParametrosLegales, c: CriteriosComision): LineaComision {
  const comision = redondear(e.comision);
  const salario = money(e.salarioMensual);
  const antes = salario.plus(money(e.comisionesPreviasDelMes ?? 0));
  const despues = antes.plus(comision);

  const ihssAntes = calcularIHSS(antes, p, e.ihssMontoFijoMensual);
  const ihssDespues = calcularIHSS(despues, p, e.ihssMontoFijoMensual);

  // Sin la decisión 1, el RAP y la Reserva siguen sólo sobre el salario: la comisión no les suma.
  const baseRap = (b: Money) => (c.cotizaRapYReserva ? b : salario);
  const rapAntes = calcularRAP(baseRap(antes), p);
  const rapDespues = calcularRAP(baseRap(despues), p);

  // ISR estándar: la tabla del mes con la comisión, menos la del mes sin ella, con la
  // misma base que la ordinaria (lo pagado menos IHSS, RAP y AFP del trabajador).
  const afp = money(e.afpMensual ?? 0);
  const baseIsr = (bruto: Money, ihss: Money, rap: Money) => bruto.minus(ihss).minus(rap).minus(afp);
  const isr = e.isrPersonalizado !== undefined
    ? redondear(maximo(e.isrPersonalizado, 0))
    : aumento(
        calcularISRMensual(baseIsr(antes, ihssAntes.empleado, rapAntes.empleado), p),
        calcularISRMensual(baseIsr(despues, ihssDespues.empleado, rapDespues.empleado), p)
      );

  const impuestoVecinal = c.retieneVecinal
    ? aumento(calcularImpuestoVecinal(antes, p.tablaVecinalAnual), calcularImpuestoVecinal(despues, p.tablaVecinalAnual))
    : CERO;

  const emEmpleado = aumento(ihssAntes.emEmpleado, ihssDespues.emEmpleado);
  const ivmEmpleado = aumento(ihssAntes.ivmEmpleado, ihssDespues.ivmEmpleado);
  const ihssEmpleado = redondear(emEmpleado.plus(ivmEmpleado));
  const rapEmpleado = aumento(rapAntes.empleado, rapDespues.empleado);
  const deduccionesAutorizadas = redondear(e.deduccionesAutorizadas ?? 0);
  const totalDeducciones = redondear(sumar(ihssEmpleado, rapEmpleado, isr, impuestoVecinal, deduccionesAutorizadas));

  const ihssEmpleador = aumento(ihssAntes.empleador, ihssDespues.empleador);
  const ivmEmpleador = aumento(ihssAntes.ivmEmpleador, ihssDespues.ivmEmpleador);
  const ivmEstado = aumento(ihssAntes.ivmEstado, ihssDespues.ivmEstado);
  const rapEmpleador = aumento(rapAntes.empleador, rapDespues.empleador);
  const reservaLaboral = c.cotizaRapYReserva
    ? aumento(calcularReservaLaboral(antes, p).empleador, calcularReservaLaboral(despues, p).empleador)
    : CERO;
  // INFOP: 1 % de lo devengado, sin techo. Con monto fijo general, el del mes ya se pagó.
  const infop = p.fijos?.infop ? CERO : redondear(comision.times(p.infopEmpleador));

  return {
    comision,
    emEmpleado,
    ivmEmpleado,
    ihssEmpleado,
    rapEmpleado,
    isr,
    impuestoVecinal,
    deduccionesAutorizadas,
    totalDeducciones,
    neto: redondear(comision.minus(totalDeducciones)),
    ihssEmpleador,
    ivmEmpleador,
    ivmEstado,
    rapEmpleador,
    reservaLaboral,
    infop,
    totalEmpleador: redondear(sumar(ihssEmpleador, rapEmpleador, reservaLaboral, infop)),
  };
}

/**
 * ISR de la comisión con el cálculo personalizado: la retención del MES de pago con
 * la comisión, menos la retención de ese mes sin ella, vistas como planilla mensual.
 *
 * Igual que en la hoja «Retención en la fuente», el aumento del ISR anual que causa
 * la comisión se reparte en los meses que quedan: esta planilla retiene la parte del
 * mes y las planillas siguientes el resto, solas, porque el método siempre calcula
 * contra lo ya retenido. Al cierre del año el total retenido es el ISR anual exacto.
 *
 * `mes` debe traer el historial del año ANTES del mes de pago y, en `actual`, el
 * salario y los ingresos variables de ese mes sin esta comisión.
 */
export function isrComisionPersonalizado(
  mes: Omit<EntradaIsrPersonalizado, "periodosAnio" | "indicePeriodo"> & { mesPago: number },
  comision: MoneyInput
): Money {
  const { mesPago, ...resto } = mes;
  const comoMensual = (variablesExtra: MoneyInput) =>
    calcularIsrPersonalizado({
      ...resto,
      periodosAnio: 12,
      indicePeriodo: mesPago,
      actual: { ...resto.actual, variables: money(resto.actual.variables).plus(variablesExtra) },
    }).retencion;
  return aumento(comoMensual(0), comoMensual(comision));
}
