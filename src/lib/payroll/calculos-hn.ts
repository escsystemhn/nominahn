/**
 * Motor de cálculo de planilla para Honduras
 * Legislación laboral y tributaria hondureña vigente (2026)
 *
 * DISEÑO: el motor es una función pura. Los parámetros legales (tabla ISR, tasas
 * IHSS/RAP, techos, deducciones) se inyectan vía `ParametrosLegales`. Los valores
 * por defecto exportados abajo son los vigentes 2026 y sirven de fallback cuando
 * la base de datos no tiene configuración. La capa de datos (api/planillas) debe
 * cargar los valores desde BD (TablasISR, TipoDeduccionConfig) y sobreescribirlos.
 */

import { money, redondear, sumar, minimo, maximo, CERO, type Money, type MoneyInput } from "./money";
import { tipoJornada as tipoJornadaLegal, type TipoJornada as TipoJornadaLegal } from "@/lib/horarios/ley";
import { DISTRIBUCION_POR_OMISION, tramoQuincenal, type DistribucionQuincenal, type ModoQuincenal } from "./distribucion-quincenal";

export type { Money, MoneyInput };

// ─── CONSTANTES / DEFAULTS LEGALES HN 2026 ────────────────────────────────────

// IHSS Régimen EM (Enfermedad y Maternidad)
export const IHSS_EMPLEADO = 0.025;      // 2.5% empleado (EM)
export const IHSS_EMPLEADOR = 0.05;      // 5%  patrono  (EM)
// TECHO IHSS: sube cada año por decreto. Verificar valor vigente con el IHSS.
// A falta de config en BD se usa este default.
export const IHSS_TOPE_MENSUAL = 11903.13;

// IHSS Régimen IVM (Invalidez, Vejez y Muerte)
export const IVM_EMPLEADO = 0.025;       // 2.5% empleado
export const IVM_EMPLEADOR = 0.035;      // 3.5% patrono
export const IVM_ESTADO = 0.005;         // 0.5% aporte del Estado (informativo)
export const IVM_TOPE_MENSUAL = 11903.13;

export const RAP_EMPLEADO = 0.015;       // 1.5%
export const RAP_EMPLEADOR = 0.015;      // 1.5%
// RAP — Fondo de Vivienda (FOVIIF): se cotiza sobre el EXCEDENTE del salario por
// encima del piso, que es el techo del IVM del IHSS. SIN techo superior: el Art. 43
// de la Ley del RAP, reformado por el Decreto 47-2024, sólo dice que «la retención
// se hará sobre el monto que exceda el techo establecido para las contribuciones
// destinadas al Régimen de IVM». Los tres salarios mínimos (L57,896.16) son el techo
// de la Reserva Laboral (Art. 4), no de este fondo. Base = salario - piso.
export const RAP_PISO_MENSUAL = 11903.13;

export const INFOP_EMPLEADOR = 0.01;     // 1% (patronal)

// Fondo de Reserva Laboral de Capitalización Individual, administrado por el RAP
// (Decreto 47-2024, Art. 4): aporte PATRONAL obligatorio del 4% mensual del
// salario ordinario, con techo de tres salarios mínimos en su nivel más alto.
// No se le descuenta nada al trabajador y, al terminar la relación laboral, el
// saldo acumulado se deduce del auxilio de cesantía (Art. 6).
export const RESERVA_LABORAL_EMPLEADOR = 0.04;
export const RESERVA_LABORAL_TECHO_MENSUAL = 57896.16;

// Deducción anual por gastos médicos sin comprobante (Ley del ISR)
export const DEDUCCION_MEDICA_ANUAL = 40000;

// Descuento por ausencia injustificada: el día ausente más el séptimo día (el
// descanso semanal pagado) de la semana en que faltó. Con factor 2 se pierde un
// séptimo por SEMANA con ausencias, no uno por cada ausencia (ver
// `calcularDescuentoAusencia`). Con factor 1 sólo se descuenta el día.
// PARAMETRIZABLE: ajustar desde configuración si el criterio legal cambia.
export const FACTOR_DESCUENTO_AUSENCIA = 2;

// Horas de jornada ordinaria diaria: divisor del valor de la hora extra.
// PARAMETRIZABLE desde ConfiguracionSistema (clave JORNADA_HORAS).
export const JORNADA_HORAS = 8;

// Vacaciones — Art. 346 Código de Trabajo (días hábiles por año de servicio)
export function calcularDiasVacaciones(aniosTrabajados: number): number {
  if (aniosTrabajados < 1) return 0;
  if (aniosTrabajados < 2) return 10; // después de 1 año
  if (aniosTrabajados < 3) return 12; // después de 2 años
  if (aniosTrabajados < 4) return 15; // después de 3 años
  return 20;                          // después de 4 años en adelante
}

/** Días de vacaciones que se ganan al COMPLETAR el n-ésimo año de servicio (Art. 346). */
export function diasVacacionesPorAnio(anioNumero: number): number {
  if (anioNumero <= 0) return 0;
  if (anioNumero === 1) return 10;
  if (anioNumero === 2) return 12;
  if (anioNumero === 3) return 15;
  return 20; // 4º año en adelante
}

/**
 * Vacaciones DEVENGADAS acumuladas a una fecha: suma el derecho de cada año
 * completado más la fracción proporcional del año en curso.
 * (No descuenta días ya tomados; eso lo hace el saldo.)
 */
export function calcularVacacionesDevengadas(fechaIngreso: Date | string, hasta: Date = new Date()): number {
  const ingreso = new Date(fechaIngreso);
  if (isNaN(ingreso.getTime()) || hasta <= ingreso) return 0;

  const MS_ANIO = 365.25 * 24 * 60 * 60 * 1000;
  const aniosTotales = (hasta.getTime() - ingreso.getTime()) / MS_ANIO;
  const completos = Math.floor(aniosTotales);

  let total = 0;
  for (let y = 1; y <= completos; y++) total += diasVacacionesPorAnio(y);

  const fraccion = aniosTotales - completos;
  total += diasVacacionesPorAnio(completos + 1) * fraccion;

  return roundDos(total);
}

/**
 * Tabla progresiva de ISR — se define en RENTA NETA GRAVABLE ANUAL.
 * Default: tabla 2026 (SAR 02-2026). Sustituible desde BD (modelo TablasISR).
 */
export interface TramoISR {
  desde: number;
  hasta: number | null;
  cuotaFija: number;
  porcentaje: number;
  excedenteDesde: number;
}

export const TABLA_ISR_ANUAL_2026: TramoISR[] = [
  { desde: 0,         hasta: 228324.32, cuotaFija: 0,         porcentaje: 0,    excedenteDesde: 0 },
  { desde: 228324.33, hasta: 348154.10, cuotaFija: 0,         porcentaje: 0.15, excedenteDesde: 228324.32 },
  { desde: 348154.11, hasta: 809660.75, cuotaFija: 17974.47,  porcentaje: 0.20, excedenteDesde: 348154.10 },
  { desde: 809660.76, hasta: null,      cuotaFija: 110275.80, porcentaje: 0.25, excedenteDesde: 809660.75 },
];

/**
 * Un tramo de la tabla del impuesto personal o vecinal.
 *
 * `porMillar` es lempiras por cada mil de la PORCIÓN del ingreso que cae en
 * este tramo — no del ingreso total.
 */
export interface TramoVecinal {
  /** Cota inferior del tramo: el tramo cubre el intervalo (`desde`, `hasta`]. */
  desde: number;
  /** `null` = último tramo, sin techo. */
  hasta: number | null;
  porMillar: number;
}

/**
 * Impuesto personal o vecinal — SAN PEDRO SULA, CORTÉS.
 *
 * Base legal: Art. 77 de la Ley de Municipalidades (Decreto 134-90) y Anexo
 * No. 1 del Plan de Arbitrios de la Municipalidad de San Pedro Sula.
 *
 * BASE IMPONIBLE: los ingresos totales ANUALES percibidos dentro del término
 * municipal, SIN DEDUCCIONES. A diferencia del ISR no se restan IHSS, RAP ni
 * AFP, y comprende sueldo, horas extra, bonificaciones y cualquier otra
 * percepción en efectivo o en especie.
 *
 * MÉTODO: verdadera suma por tramos. El Plan de Arbitrios lo dice expresamente
 * —«el cálculo de este impuesto se hará por tramo de ingresos y el impuesto
 * total será la suma de las cantidades que resulten de cada tramo»—, de modo
 * que cada porción del ingreso tributa a la tarifa de SU tramo. NO es una
 * tarifa única aplicada al total, que es como suele simplificarse en prensa.
 *
 * VIGENCIA: el Plan de Arbitrios se aprueba cada año. Estos valores son el
 * respaldo; la tabla efectiva se carga desde `TablaImpuestoVecinal` en base de
 * datos, de modo que un Plan nuevo se aplica sin tocar código.
 */
export const TABLA_VECINAL_SPS: TramoVecinal[] = [
  { desde: 0,      hasta: 5000,   porMillar: 1.5 },
  { desde: 5000,   hasta: 10000,  porMillar: 2.0 },
  { desde: 10000,  hasta: 20000,  porMillar: 2.5 },
  { desde: 20000,  hasta: 30000,  porMillar: 3.0 },
  { desde: 30000,  hasta: 50000,  porMillar: 3.5 },
  { desde: 50000,  hasta: 75000,  porMillar: 3.75 },
  { desde: 75000,  hasta: 100000, porMillar: 4.0 },
  { desde: 100000, hasta: 150000, porMillar: 5.0 },
  { desde: 150000, hasta: null,   porMillar: 5.25 },
];

// ─── PARÁMETROS INYECTABLES ───────────────────────────────────────────────────

/**
 * Montos MENSUALES fijos por concepto, configurados por el administrador en
 * Configuración → Parámetros de ley. `null` = el concepto se calcula por
 * porcentaje, como siempre. Un monto fijo se descuenta igual a TODOS los
 * empleados, sin mirar su salario, y se prorratea al período como el calculado.
 */
export interface MontosFijos {
  /** IHSS régimen EM (Enfermedad y Maternidad). */
  ihss: { empleado: number; empleador: number } | null;
  /** IHSS régimen IVM (Invalidez, Vejez y Muerte). */
  ivm: { empleado: number; empleador: number } | null;
  rap: { empleado: number; empleador: number } | null;
  /** INFOP sólo tiene parte patronal. */
  infop: { empleador: number } | null;
  /** Fondo de Reserva Laboral: sólo patronal. */
  reservaLaboral: { empleador: number } | null;
}

export const SIN_MONTOS_FIJOS: MontosFijos = { ihss: null, ivm: null, rap: null, infop: null, reservaLaboral: null };

export interface ParametrosLegales {
  ihssEmpleado: number;
  ihssEmpleador: number;
  ihssTope: number;
  ivmEmpleado: number;
  ivmEmpleador: number;
  ivmEstado: number;
  ivmTope: number;
  rapEmpleado: number;
  rapEmpleador: number;
  rapPiso: number;
  infopEmpleador: number;
  reservaLaboralEmpleador: number;
  reservaLaboralTope: number;
  deduccionMedicaAnual: number;
  factorDescuentoAusencia: number;
  /** Horas de jornada ordinaria diaria: define el valor de la hora extra. */
  jornadaHoras: number;
  tablaISRAnual: TramoISR[];
  /** Tabla del impuesto personal o vecinal del municipio donde opera la empresa. */
  tablaVecinalAnual: TramoVecinal[];
  /** Conceptos configurados como monto fijo. Ver `MontosFijos`. */
  fijos: MontosFijos;
  /** Planilla quincenal: IHSS, RAP y vecinal divididos o completos en la segunda quincena. */
  distribucionQuincenal: DistribucionQuincenal;
}

export const PARAMETROS_DEFAULT: ParametrosLegales = {
  ihssEmpleado: IHSS_EMPLEADO,
  ihssEmpleador: IHSS_EMPLEADOR,
  ihssTope: IHSS_TOPE_MENSUAL,
  ivmEmpleado: IVM_EMPLEADO,
  ivmEmpleador: IVM_EMPLEADOR,
  ivmEstado: IVM_ESTADO,
  ivmTope: IVM_TOPE_MENSUAL,
  rapEmpleado: RAP_EMPLEADO,
  rapEmpleador: RAP_EMPLEADOR,
  rapPiso: RAP_PISO_MENSUAL,
  infopEmpleador: INFOP_EMPLEADOR,
  reservaLaboralEmpleador: RESERVA_LABORAL_EMPLEADOR,
  reservaLaboralTope: RESERVA_LABORAL_TECHO_MENSUAL,
  deduccionMedicaAnual: DEDUCCION_MEDICA_ANUAL,
  factorDescuentoAusencia: FACTOR_DESCUENTO_AUSENCIA,
  jornadaHoras: JORNADA_HORAS,
  tablaISRAnual: TABLA_ISR_ANUAL_2026,
  tablaVecinalAnual: TABLA_VECINAL_SPS,
  fijos: SIN_MONTOS_FIJOS,
  distribucionQuincenal: DISTRIBUCION_POR_OMISION,
};

// ─── CÁLCULO IHSS ─────────────────────────────────────────────────────────────

export interface DesgloseIHSS {
  emEmpleado: Money;
  emEmpleador: Money;
  ivmEmpleado: Money;
  ivmEmpleador: Money;
  ivmEstado: Money;
  empleado: Money;   // TOTAL empleado (EM + IVM)
  empleador: Money;  // TOTAL patrono  (EM + IVM)
  /** `true` si la parte del empleado vino de un monto fijo y no del porcentaje. */
  fijo: boolean;
}

/**
 * @param montoFijoEmpleado Monto MENSUAL de IHSS que el empleado tiene pactado en
 *   su ficha. Si viene, REEMPLAZA la parte del empleado calculada por porcentaje;
 *   la patronal sigue por porcentaje. Vive aquí, y no en la planilla, porque el
 *   reporte «Planilla IHSS» también llama a esta función: si la excepción
 *   estuviera sólo en la planilla, el reporte que se presenta al IHSS saldría
 *   con otra cifra que la descontada al trabajador.
 */
export function calcularIHSS(
  salarioMensual: MoneyInput,
  p: ParametrosLegales = PARAMETROS_DEFAULT,
  montoFijoEmpleado?: MoneyInput | null
): DesgloseIHSS {
  const salario = money(salarioMensual);
  const baseEM = minimo(salario, p.ihssTope);
  const baseIVM = minimo(salario, p.ivmTope);

  // Monto fijo GENERAL del régimen (Parámetros de ley) o, si no, porcentaje.
  // El aporte del Estado al IVM es informativo y sigue siempre por porcentaje.
  const fEM = p.fijos?.ihss ?? null;
  const fIVM = p.fijos?.ivm ?? null;
  let emEmpleado = fEM ? redondear(money(fEM.empleado)) : redondear(baseEM.times(p.ihssEmpleado));
  const emEmpleador = fEM ? redondear(money(fEM.empleador)) : redondear(baseEM.times(p.ihssEmpleador));
  let ivmEmpleado = fIVM ? redondear(money(fIVM.empleado)) : redondear(baseIVM.times(p.ivmEmpleado));
  const ivmEmpleador = fIVM ? redondear(money(fIVM.empleador)) : redondear(baseIVM.times(p.ivmEmpleador));
  const ivmEstado = redondear(baseIVM.times(p.ivmEstado));

  const fijo = montoFijoEmpleado !== undefined && montoFijoEmpleado !== null;
  if (fijo) {
    // El IHSS se reporta desglosado en EM e IVM. Un monto fijo no trae ese
    // desglose, así que se reparte en la misma proporción que tendría por
    // porcentaje; así los dos regímenes suman exactamente el monto pactado y
    // los reportes al IHSS cuadran con lo descontado.
    const total = redondear(money(montoFijoEmpleado));
    const calculado = emEmpleado.plus(ivmEmpleado);
    ivmEmpleado = calculado.isZero()
      ? redondear(total.div(2))
      : redondear(total.times(ivmEmpleado).div(calculado));
    emEmpleado = redondear(total.minus(ivmEmpleado));
  }

  return {
    emEmpleado,
    emEmpleador,
    ivmEmpleado,
    ivmEmpleador,
    ivmEstado,
    empleado: redondear(emEmpleado.plus(ivmEmpleado)),
    empleador: redondear(emEmpleador.plus(ivmEmpleador)),
    fijo,
  };
}

// ─── CÁLCULO RAP ──────────────────────────────────────────────────────────────

/**
 * Base cotizable del RAP (FOVIIF): EXCEDENTE del salario sobre el piso, sin techo.
 *   base = max(0, salario - piso)
 * Un salario igual o menor al piso no cotiza RAP (lo cubre el IHSS). Ver la nota de
 * `RAP_PISO_MENSUAL`: el techo de tres salarios mínimos es sólo de la Reserva Laboral.
 */
export function baseCotizableRAP(
  salarioMensual: MoneyInput,
  p: ParametrosLegales = PARAMETROS_DEFAULT
): Money {
  return redondear(maximo(money(salarioMensual).minus(p.rapPiso), 0));
}

export function calcularRAP(
  salarioMensual: MoneyInput,
  p: ParametrosLegales = PARAMETROS_DEFAULT
): { empleado: Money; empleador: Money; base: Money } {
  const base = baseCotizableRAP(salarioMensual, p);
  // Con monto fijo general se descuenta a todos por igual, incluso a quien
  // por su salario no llegaría al piso del RAP: es la elección del administrador.
  const fijo = p.fijos?.rap ?? null;
  return {
    base,
    empleado: fijo ? redondear(money(fijo.empleado)) : redondear(base.times(p.rapEmpleado)),
    empleador: fijo ? redondear(money(fijo.empleador)) : redondear(base.times(p.rapEmpleador)),
  };
}

// ─── FONDO DE RESERVA LABORAL ─────────────────────────────────────────────────

/**
 * Aporte PATRONAL mensual al Fondo de Reserva Laboral (Decreto 47-2024, Art. 4).
 *
 * A diferencia del RAP/FOVIIF, no hay piso: cotiza desde el primer lempira y se
 * topa en tres salarios mínimos. El trabajador no aporta nada.
 */
export function calcularReservaLaboral(
  salarioMensual: MoneyInput,
  p: ParametrosLegales = PARAMETROS_DEFAULT
): { empleador: Money; base: Money } {
  const base = redondear(minimo(salarioMensual, p.reservaLaboralTope));
  const fijo = p.fijos?.reservaLaboral ?? null;
  return {
    base,
    empleador: fijo ? redondear(money(fijo.empleador)) : redondear(base.times(p.reservaLaboralEmpleador)),
  };
}

// ─── CÁLCULO ISR ──────────────────────────────────────────────────────────────

/**
 * Método correcto HN: se anualiza la base gravable mensual (ya neta de IHSS/RAP/AFP),
 * se resta la deducción médica anual, se aplica la tabla ANUAL, y la retención
 * mensual es el ISR anual / 12.
 */
export function calcularISRMensual(
  salarioMensualGravable: MoneyInput,
  p: ParametrosLegales = PARAMETROS_DEFAULT
): Money {
  const gravableAnual = maximo(money(salarioMensualGravable).times(12).minus(p.deduccionMedicaAnual), 0);
  return redondear(isrAnualSegunTabla(gravableAnual, p.tablaISRAnual).div(12));
}

/**
 * ISR ANUAL de una renta neta gravable anual según la tabla progresiva, sin
 * redondear. Lo comparten el método estándar y el cálculo personalizado.
 */
export function isrAnualSegunTabla(rentaNetaAnual: MoneyInput, tabla: TramoISR[]): Money {
  const gravableAnual = maximo(money(rentaNetaAnual), 0);
  if (tabla.length === 0) return CERO;

  // Selección por cota inferior: se toma el tramo de mayor `desde` que no supere
  // la base gravable. Evita que un valor caído entre el `hasta` de un tramo y el
  // `desde` del siguiente (p.ej. 228,324.325) no matchee ningún tramo y tribute 0.
  const tramos = [...tabla].sort((a, b) => a.desde - b.desde);
  let tramo = tramos[0];
  for (const t of tramos) {
    if (gravableAnual.greaterThanOrEqualTo(t.desde)) tramo = t;
    else break;
  }

  const excedente = maximo(gravableAnual.minus(tramo.excedenteDesde), 0);
  return excedente.times(tramo.porcentaje).plus(tramo.cuotaFija);
}

// ─── CÁLCULO IMPUESTO VECINAL ─────────────────────────────────────────────────

/**
 * Impuesto vecinal ANUAL sobre el ingreso anual bruto.
 *
 * Recorre los tramos acumulando `porción × tarifa ÷ 1000`. Un ingreso de
 * L 100,000 no paga 100 × 4.00 = 400, sino la suma de los siete tramos que
 * atraviesa: 336.25.
 */
export function calcularImpuestoVecinalAnual(
  ingresoAnual: MoneyInput,
  tabla: TramoVecinal[] = TABLA_VECINAL_SPS
): Money {
  const ingreso = money(ingresoAnual);
  if (ingreso.lessThanOrEqualTo(0) || tabla.length === 0) return CERO;

  const tramos = [...tabla].sort((a, b) => a.desde - b.desde);

  let total = CERO;
  for (const t of tramos) {
    if (ingreso.lessThanOrEqualTo(t.desde)) break;
    const techo = t.hasta === null ? ingreso : minimo(ingreso, t.hasta);
    const porcion = techo.minus(t.desde);
    if (porcion.lessThanOrEqualTo(0)) continue;
    total = total.plus(porcion.div(1000).times(t.porMillar));
  }

  return redondear(total);
}

/**
 * Retención MENSUAL del impuesto vecinal.
 *
 * Se anualiza la base mensual, se aplica la tabla anual y se divide entre doce
 * — el mismo método de proyección con que se trata el ISR.
 *
 * ANTES: `salarioMensual / 1000` redondeado a la baja, una aproximación de
 * L 1.00 por millar que ignoraba por completo la progresividad y el municipio.
 * Para un salario de L 50,000 daba L 50.00 al mes; la tabla de San Pedro Sula
 * da L 17.19.
 */
export function calcularImpuestoVecinal(
  baseMensual: MoneyInput,
  tabla: TramoVecinal[] = TABLA_VECINAL_SPS
): Money {
  const anual = calcularImpuestoVecinalAnual(money(baseMensual).times(12), tabla);
  return redondear(anual.div(12));
}

// ─── CÁLCULO 13VO MES ─────────────────────────────────────────────────────────

export function calcularProvision13vo(salarioMensual: MoneyInput, diasTrabajados: number, diasMes: number): Money {
  return redondear(money(salarioMensual).div(12).times(diasTrabajados).div(diasMes));
}

// ─── CÁLCULO 14VO MES ─────────────────────────────────────────────────────────

export function calcularProvision14vo(salarioMensual: MoneyInput, diasTrabajados: number, diasMes: number): Money {
  return redondear(money(salarioMensual).div(12).times(diasTrabajados).div(diasMes));
}

// ─── CÁLCULO VACACIONES ───────────────────────────────────────────────────────

/**
 * Provisión MENSUAL de vacaciones, proporcional a los días con derecho a salario
 * del período: se multiplica por el factor de la planilla igual que la de 13vo y
 * 14vo, y en un año completo suma exactamente el valor de las vacaciones.
 *
 * Se provisiona el derecho del año de servicio EN CURSO (Art. 346): en el primer
 * año se van ganando los 10 días que se cobran al cumplirlo, en el segundo los 12,
 * etc. `aniosTrabajados` son los años COMPLETOS al cierre del período.
 *
 * Antes se dividía entre 365 días y luego se volvía a prorratear por el factor de
 * la planilla: la mensual quedaba 1.4 % corta, la quincenal en la mitad, la
 * semanal en una cuarta parte, y el primer año no provisionaba nada.
 */
export function calcularProvisionVacaciones(
  salarioMensual: MoneyInput,
  aniosTrabajados: number,
  diasPagables: number,
  diasMes: number
): Money {
  const diasDelAnio = diasVacacionesPorAnio(Math.max(0, Math.floor(aniosTrabajados)) + 1);
  const valorAnual = money(salarioMensual).div(30).times(diasDelAnio);
  return redondear(valorAnual.div(12).times(diasPagables).div(diasMes));
}

// ─── CÁLCULO HORAS EXTRA ──────────────────────────────────────────────────────

/**
 * Recargos sobre la hora extraordinaria — Art. 330 del Código del Trabajo:
 *
 *   1.º +25 % sobre el salario de la jornada DIURNA, si se trabaja en el período
 *       diurno (05:00 a 19:00).
 *   2.º +50 % sobre el salario de la jornada DIURNA, si se trabaja en el período
 *       nocturno (19:00 a 05:00).
 *   3.º +75 % sobre el salario de la jornada NOCTURNA, cuando la extra prolonga
 *       una jornada nocturna.
 *
 * Los nombres de las claves (y de las columnas `horasExtraDiurna`, `…Mixta` y
 * `…Nocturna`) vienen de cuando el recargo se asignaba por jornada; hoy cada
 * cubeta es un recargo: DIURNA = 1.º, MIXTA = 2.º, NOCTURNA = 3.º. Es lo que dicen
 * las columnas «Extra 25 %», «Extra 50 %» y «Extra 75 %» de la plantilla.
 *
 * Antes la extra de un trabajador diurno después de las 19:00 se pagaba al 75 %
 * (la ley da 50 %), un bloque que cruzaba las 19:00 iba entero al 50 %, y la
 * prolongación de una jornada nocturna se valoraba con la hora diurna.
 */
export const RECARGO_EXTRA = {
  DIURNA: 0.25,   // período diurno: 125 % de la hora diurna
  MIXTA: 0.50,    // período nocturno: 150 % de la hora diurna
  NOCTURNA: 0.75, // prolongación de jornada nocturna: 175 % de la hora nocturna
} as const;

/** Jornada nocturna ordinaria (Art. 322): base de la hora del recargo del 75 %. */
export const HORAS_JORNADA_NOCTURNA = 6;

/**
 * Art. 339: el trabajo en día de descanso semanal o feriado se remunera al
 * doble. Se expresa como recargo del 100 % para operar igual que los de arriba.
 */
export const RECARGO_FERIADO = 1.0;

export type TipoJornadaExtra = keyof typeof RECARGO_EXTRA;

/**
 * Horas extraordinarias del período, desglosadas por recargo (Art. 330).
 *
 * El desglose es obligatorio para liquidar bien: cada cubeta lleva su propio
 * recargo. Un `number` suelto se acepta como atajo y se interpreta como extra en
 * período diurno, que es el caso mayoritario y el único que el sistema capturaba antes.
 */
export interface HorasExtraPorJornada {
  /** Extra en período diurno: +25 % sobre la hora diurna. */
  diurnas?: number;
  /** Extra en período nocturno de una jornada diurna o mixta: +50 % sobre la hora diurna. */
  mixtas?: number;
  /** Prolongación de una jornada nocturna: +75 % sobre la hora nocturna. */
  nocturnas?: number;
  /** Horas trabajadas en feriado o día de descanso semanal. */
  feriado?: number;
}

export function normalizarHorasExtra(h: HorasExtraPorJornada | number): HorasExtraPorJornada {
  return typeof h === "number" ? { diurnas: h } : h;
}

/** Valor de una hora ordinaria: el mes se toma de 30 días. */
export function salarioHora(salarioMensual: MoneyInput, jornadaHoras: number = JORNADA_HORAS): Money {
  return money(salarioMensual).div(30).div(jornadaHoras);
}

/**
 * Importe de las horas extra del período.
 *
 * `jornadaHoras` es la jornada DIURNA ordinaria (8 h por omisión): da la hora de
 * los recargos 1.º y 2.º del Art. 330 y la del feriado. La prolongación de la
 * jornada nocturna (3.º) se paga sobre la hora NOCTURNA, salario ÷ 30 ÷ 6.
 */
export function calcularMontoHorasExtra(
  salarioMensual: MoneyInput,
  horas: HorasExtraPorJornada | number,
  jornadaHoras: number = JORNADA_HORAS
): Money {
  const h = normalizarHorasExtra(horas);
  const horaDiurna = salarioHora(salarioMensual, jornadaHoras);
  const horaNocturna = salarioHora(salarioMensual, HORAS_JORNADA_NOCTURNA);

  const tramo = (hora: Money, cantidad: number | undefined, recargo: number): Money =>
    cantidad && cantidad > 0 ? hora.times(cantidad).times(1 + recargo) : CERO;

  return redondear(
    sumar(
      tramo(horaDiurna, h.diurnas, RECARGO_EXTRA.DIURNA),
      tramo(horaDiurna, h.mixtas, RECARGO_EXTRA.MIXTA),
      tramo(horaNocturna, h.nocturnas, RECARGO_EXTRA.NOCTURNA),
      tramo(horaDiurna, h.feriado, RECARGO_FERIADO)
    )
  );
}

/** Total de horas extraordinarias, sin distinguir jornada (para la boleta). */
export function totalHorasExtra(horas: HorasExtraPorJornada | number): number {
  const h = normalizarHorasExtra(horas);
  return (h.diurnas ?? 0) + (h.mixtas ?? 0) + (h.nocturnas ?? 0) + (h.feriado ?? 0);
}

// ─── CLASIFICACIÓN DE JORNADA ────────────────────────────────────────────────

/**
 * Límites de la jornada diurna — Arts. 322 y 323 del Código del Trabajo:
 * diurna de 05:00 a 19:00, nocturna de 19:00 a 05:00.
 */
export const HORA_INICIO_DIURNA = 5;
export const HORA_FIN_DIURNA = 19;

/**
 * Fracción de un intervalo horario que cae dentro de la franja diurna.
 *
 * Las horas se expresan como horas decimales desde la medianoche del día de
 * entrada; un turno que cruza la medianoche continúa más allá de 24 (p. ej.
 * 22:00→02:00 es [22, 26]). El cálculo se hace franja por franja para que un
 * intervalo que cruza varios días siga siendo correcto.
 */
export function horasDiurnasEnIntervalo(desdeHora: number, hastaHora: number): number {
  if (hastaHora <= desdeHora) return 0;

  let diurnas = 0;
  // Se recorre día a día: cada día aporta su ventana [05:00, 19:00).
  const primerDia = Math.floor(desdeHora / 24);
  const ultimoDia = Math.floor((hastaHora - 1e-9) / 24);

  for (let dia = primerDia; dia <= ultimoDia; dia++) {
    const inicioFranja = dia * 24 + HORA_INICIO_DIURNA;
    const finFranja = dia * 24 + HORA_FIN_DIURNA;
    const solape = Math.min(hastaHora, finFranja) - Math.max(desdeHora, inicioFranja);
    if (solape > 0) diurnas += solape;
  }

  return diurnas;
}

export interface ClasificacionJornada {
  tipo: TipoJornadaExtra;
  horas: number;
  horasDiurnas: number;
  horasNocturnas: number;
}

/**
 * Describe un bloque de horas según la franja en que cae: todo diurno, todo
 * nocturno o mixto, con las horas de cada período.
 *
 * NO decide el recargo: el Art. 330 lo fija hora por hora según el período y según
 * si la extra prolonga una jornada nocturna. Eso lo hace `repartirJornada`.
 */
export function clasificarJornadaExtra(desdeHora: number, hastaHora: number): ClasificacionJornada {
  const horas = Math.max(0, hastaHora - desdeHora);
  const horasDiurnas = horasDiurnasEnIntervalo(desdeHora, hastaHora);
  const horasNocturnas = horas - horasDiurnas;

  // Tolerancia de un segundo: evita clasificar como MIXTA un bloque que roza el
  // límite por redondeo del reloj biométrico.
  const EPS = 1 / 3600;
  const tipo: TipoJornadaExtra =
    horasNocturnas <= EPS ? "DIURNA" : horasDiurnas <= EPS ? "NOCTURNA" : "MIXTA";

  return { tipo, horas, horasDiurnas, horasNocturnas };
}

/**
 * Reparte la jornada de un día en horas ordinarias y extraordinarias ya
 * clasificadas, a partir de las marcas de entrada y salida.
 *
 * `esFeriado` cubre tanto el feriado nacional como el día de descanso semanal:
 * en ambos casos TODAS las horas trabajadas llevan el recargo del Art. 339, no
 * sólo las que exceden la jornada.
 *
 * `minutosDescanso` es el almuerzo (u otra pausa) que NO es tiempo de trabajo.
 * Se resta del lapso entre entrada y salida. Sin él, el horario por defecto del
 * propio sistema —08:00 a 17:00 con jornada de 8 h— generaba una hora extra
 * diaria a cada persona: la del almuerzo.
 *
 * Recargo de la extra (Art. 330): si la jornada ordinaria es NOCTURNA, la extra la
 * prolonga y va toda al 75 % (cubeta `nocturnas`). Si es diurna o mixta, cada hora
 * va según el período en que cae: del período diurno al 25 % (`diurnas`) y del
 * nocturno al 50 % (`mixtas`). `tipoJornada` es la del turno; sin él se deduce de
 * la jornada ordinaria marcada con la regla del Art. 321.
 */
export function repartirJornada(opts: {
  horaEntrada: Date;
  horaSalida: Date;
  jornadaHoras?: number;
  esFeriado?: boolean;
  minutosDescanso?: number;
  tipoJornada?: TipoJornadaLegal;
}): { horasNormales: number; extra: HorasExtraPorJornada; totalExtra: number } {
  const {
    horaEntrada, horaSalida, jornadaHoras = JORNADA_HORAS, esFeriado = false, minutosDescanso = 0,
  } = opts;

  const lapsoHoras = (horaSalida.getTime() - horaEntrada.getTime()) / 3_600_000;
  const descansoHoras = Math.max(minutosDescanso, 0) / 60;
  const totalHoras = lapsoHoras - descansoHoras;
  if (totalHoras <= 0) return { horasNormales: 0, extra: {}, totalExtra: 0 };

  if (esFeriado) {
    // Día de descanso o feriado: la jornada entera se remunera al doble.
    return { horasNormales: 0, extra: { feriado: redondearHoras(totalHoras) }, totalExtra: redondearHoras(totalHoras) };
  }

  const horasNormales = Math.min(totalHoras, jornadaHoras);
  const horasExtra = Math.max(totalHoras - jornadaHoras, 0);
  if (horasExtra <= 0) return { horasNormales: redondearHoras(horasNormales), extra: {}, totalExtra: 0 };

  // El bloque extraordinario empieza cuando termina la jornada ordinaria, que
  // se completa DESPUÉS del descanso: con entrada a las 07:00, 8 h de jornada y
  // una hora de almuerzo, la extra arranca a las 16:00, no a las 15:00. Importa
  // porque el período en que cae cada hora decide el recargo.
  const inicioDecimal = horaEntrada.getHours() + horaEntrada.getMinutes() / 60;
  const inicioExtra = inicioDecimal + jornadaHoras + descansoHoras;
  const finExtra = inicioDecimal + lapsoHoras;
  const cantidad = redondearHoras(horasExtra);

  const tipoOrdinaria = opts.tipoJornada
    ?? tipoJornadaLegal(Math.round(inicioDecimal * 60), Math.round(inicioExtra * 60));
  if (tipoOrdinaria === "NOCTURNA") {
    return { horasNormales: redondearHoras(horasNormales), extra: { nocturnas: cantidad }, totalExtra: cantidad };
  }

  // Las dos partes suman exactamente la cantidad redondeada.
  const diurnas = Math.min(cantidad, redondearHoras(horasDiurnasEnIntervalo(inicioExtra, finExtra)));
  const nocturnas = redondearHoras(cantidad - diurnas);
  const extra: HorasExtraPorJornada = {
    ...(diurnas > 0 ? { diurnas } : {}),
    ...(nocturnas > 0 ? { mixtas: nocturnas } : {}),
  };

  return { horasNormales: redondearHoras(horasNormales), extra, totalExtra: cantidad };
}

/** Horas a dos decimales: es la precisión de la columna Decimal(5,2). */
function redondearHoras(h: number): number {
  return Math.round(h * 100) / 100;
}

// ─── DÍAS CON DERECHO A SALARIO ──────────────────────────────────────────────

const MS_DIA = 24 * 60 * 60 * 1000;

/** Día comercial de una fecha: el 31 cuenta como 30 y el último de febrero también. */
export function diaComercial(f: Date): number {
  const d = f.getUTCDate();
  const ultimo = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  return d === ultimo || d > 30 ? 30 : d;
}

/**
 * Días COMERCIALES entre dos fechas de calendario, ambos inclusive: cada mes vale
 * 30 días, como en la nómina, los décimos (Decreto 112-82) y las vacaciones. Del
 * 1 al 31 de cualquier mes son 30; del 16 al último de febrero, 15; del 1 de julio
 * al 31 de diciembre, 180.
 */
export function diasComerciales(inicio: Date, fin: Date): number {
  if (fin < inicio) return 0;
  const meses = (fin.getUTCFullYear() - inicio.getUTCFullYear()) * 12 + (fin.getUTCMonth() - inicio.getUTCMonth());
  return Math.max(0, meses * 30 + diaComercial(fin) - diaComercial(inicio) + 1);
}

/**
 * Días del período en los que el empleado tuvo relación laboral vigente.
 *
 * Es el `diasPagables` que espera el motor. La capa de datos pasaba `diasMes`
 * fijo, de modo que quien ingresaba el día 20 cobraba el mes completo y quien
 * causaba baja a mitad de período cobraba de más.
 *
 * Las fechas son de CALENDARIO (medianoche UTC): se comparan en UTC y el tramo
 * es inclusivo en ambos extremos, porque el día de ingreso y el de salida son
 * días trabajados.
 *
 * En planillas mensuales y quincenales el tramo parcial se cuenta en días
 * comerciales (`diasComerciales`): quien sale el 20 cobra 20 días y quien entra el
 * 16 cobra 15, sea el mes de 28, 30 o 31 días. Antes se prorrateaban los días de
 * calendario y salía el 20 de un mes de 31 cobraba 19. La semanal sigue en días
 * de calendario.
 */
export function diasConDerechoASalario(opts: {
  fechaIngreso: Date;
  fechaSalida?: Date | null;
  desde: Date;
  hasta: Date;
  /** Días que el período tiene por convención (30, 15 o 7). */
  diasMes: number;
}): number {
  const { fechaIngreso, fechaSalida, desde, hasta, diasMes } = opts;

  // Tramo efectivo = intersección de [desde, hasta] con la relación laboral.
  const inicio = fechaIngreso > desde ? fechaIngreso : desde;
  const fin = fechaSalida && fechaSalida < hasta ? fechaSalida : hasta;
  if (fin < inicio) return 0;

  const diasEfectivos = Math.floor((fin.getTime() - inicio.getTime()) / MS_DIA) + 1;

  // El período completo se expresa como `diasMes` por convención de nómina (un
  // mes son 30 días aunque el calendario diga 28 o 31). Cuando el empleado
  // estuvo presente todo el período se devuelve `diasMes` tal cual, para no
  // introducir una diferencia donde no la hay.
  const diasCalendario = Math.floor((hasta.getTime() - desde.getTime()) / MS_DIA) + 1;
  if (diasEfectivos >= diasCalendario) return diasMes;

  // Tramo parcial de la semanal: días de calendario.
  if (diasMes === 7) return Math.min(diasMes, diasEfectivos);
  return Math.min(diasMes, diasComerciales(inicio, fin));
}

// ─── DESCUENTO POR AUSENCIA DOBLE ────────────────────────────────────────────

/**
 * Descuento por ausencia injustificada.
 *
 * IMPORTANTE: este es el ÚNICO lugar donde la ausencia afecta la remuneración.
 * `salarioBase` NO debe reducirse además por los días ausentes — hacerlo produce
 * doble descuento. El modelo contable lo asume así: se debita Sueldos por el
 * salario íntegro y se acredita "Descuento Ausencias" (ver partida-contable.ts).
 *
 * Recibe SIEMPRE el salario mensual íntegro: el valor de un día de ausencia no
 * depende de si la planilla es semanal, quincenal o mensual.
 *
 * Se descuentan los días ausentes más `(factor − 1)` séptimos por cada SEMANA con
 * ausencias (`semanasConAusencia`): dos faltas en la misma semana pierden un solo
 * descanso semanal. Sin ese dato se asume una semana por ausencia, el peor caso.
 */
export function calcularDescuentoAusencia(
  salarioMensual: MoneyInput,
  diasAusentes: number,
  factor: number = FACTOR_DESCUENTO_AUSENCIA,
  semanasConAusencia?: number
): Money {
  if (diasAusentes <= 0) return CERO;
  const salarioDiario = money(salarioMensual).div(30);
  const semanas = Math.min(diasAusentes, Math.max(0, semanasConAusencia ?? diasAusentes));
  const dias = diasAusentes + Math.max(0, factor - 1) * semanas;
  return redondear(salarioDiario.times(dias));
}

/**
 * Cuántas semanas (de lunes a domingo) tienen al menos una de estas fechas de
 * calendario. Es el número de séptimos días que se pierden por ausencias.
 */
export function semanasDistintas(fechas: Date[]): number {
  const semanas = new Set<number>();
  for (const f of fechas) {
    const lunes = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()) - ((f.getUTCDay() + 6) % 7) * MS_DIA;
    semanas.add(lunes);
  }
  return semanas.size;
}

// ─── CÁLCULO PLANILLA COMPLETA ────────────────────────────────────────────────

/** Los montos fijos MENSUALES de Parámetros de ley, llevados a una fracción del mes. */
/** Los montos fijos generales son mensuales: a una fracción de mes le toca su parte. */
export function escalarMontosFijos(p: ParametrosLegales, fraccion: Money): ParametrosLegales {
  const f = p.fijos ?? SIN_MONTOS_FIJOS;
  const x = (n: number) => aNumeroExacto(money(n).times(fraccion));
  const par = (v: { empleado: number; empleador: number } | null) => (v ? { empleado: x(v.empleado), empleador: x(v.empleador) } : null);
  return {
    ...p,
    fijos: {
      ihss: par(f.ihss),
      ivm: par(f.ivm),
      rap: par(f.rap),
      infop: f.infop ? { empleador: x(f.infop.empleador) } : null,
      reservaLaboral: f.reservaLaboral ? { empleador: x(f.reservaLaboral.empleador) } : null,
    },
  };
}

function aNumeroExacto(m: Money): number {
  return Number(m.toString());
}

export interface EntradaCalculoPlanilla {
  /** Acepta el Decimal que devuelve Prisma sin conversión intermedia. */
  salarioMensual: MoneyInput;
  tipoPlanilla: "SEMANAL" | "QUINCENAL" | "MENSUAL";
  /**
   * Días CON DERECHO A SALARIO en el período (= `diasMes` salvo ingreso o baja a
   * mitad de período). NO restar los días ausentes: la ausencia se descuenta
   * exclusivamente en la línea `ausencias`. Restarla aquí produce doble descuento.
   */
  diasPagables: number;
  diasMes: number;
  /** Desglose por jornada (Art. 330). Un `number` se interpreta como diurnas. */
  horasExtra: HorasExtraPorJornada | number;
  bonificaciones: MoneyInput;
  otrosIngresos: MoneyInput;
  diasAusentes: number;
  /**
   * Semanas del período con al menos una ausencia: cada una pierde UN séptimo día.
   * Sin el dato se asume una semana por ausencia (ver `calcularDescuentoAusencia`).
   */
  semanasConAusencia?: number;
  /**
   * Lo que ya calculó el motor de deducciones por asistencia (ausencias, séptimo, permisos
   * sin goce y, si la política lo enciende, llegadas tarde y salidas anticipadas). Si viene,
   * REEMPLAZA a `calcularDescuentoAusencia`; `diasAusentes` queda sólo para los días
   * trabajados. Ver `lib/asistencia/deducciones`.
   */
  descuentoAsistencia?: MoneyInput;
  /**
   * Salario que el patrono no paga por días de incapacidad a cargo del IHSS,
   * ya calculado (ver `lib/asistencia/incapacidades.ts`). Va en su propia
   * línea, igual que las ausencias. Por omisión, cero.
   */
  incapacidad?: MoneyInput;
  otrosDeducciones: MoneyInput; // suma de cooperativa, préstamos, adelantos, etc.
  /**
   * Aporte AFP del período, ya resuelto desde la deducción individual del
   * empleado. Es un IMPORTE, no un porcentaje: la AFP es voluntaria y cada
   * trabajador tiene la suya. Deducible de la base del ISR.
   */
  afpEmpleado: MoneyInput;
  aniosTrabajados: number;
  /**
   * IHSS mensual fijo pactado en la ficha del empleado, o `null` para calcularlo
   * por porcentaje. Es MENSUAL: se prorratea al período igual que el calculado.
   */
  ihssMontoFijoMensual?: MoneyInput | null;
  /**
   * `false` = esta ficha no cotiza al IHSS / al RAP (la persona cotiza en otra ficha):
   * ni lo del trabajador ni lo patronal, y no se resta de la base del ISR. INFOP y
   * Reserva Laboral siguen. Sin el dato, cotiza.
   */
  aplicaIhss?: boolean;
  aplicaRap?: boolean;
  /**
   * Sólo en planilla quincenal: qué quincena es, los días con derecho a salario
   * de TODO el mes y si la persona también tiene días en la otra quincena del mes.
   * Lo usan los aportes que se deducen completos en una sola quincena
   * (`distribucionQuincenal`). Sin el dato, se dividen en las dos.
   */
  quincena?: { numero: 1 | 2; diasPagablesMes: number; enOtraQuincena: boolean } | null;
  /**
   * ISR del PERÍODO ya calculado por otro método (el cálculo personalizado,
   * `isr-personalizado.ts`). Si viene, reemplaza al del método estándar y los
   * totales se arman con él. Por omisión, método estándar.
   */
  isrDelPeriodo?: MoneyInput | null;
  /**
   * Impuesto vecinal del PERÍODO ya decidido (`vecinal-anual.ts`): con el cobro anual,
   * lo confirmado para esta planilla, o 0. Si viene, reemplaza al doceavo calculado.
   */
  vecinalDelPeriodo?: MoneyInput | null;
  /**
   * RAP y Reserva Laboral a MES VENCIDO (ver `rap-mes-vencido.ts`): `base` es lo
   * devengado el mes anterior y reemplaza a lo del período. Lo del mes de salida de
   * quien se va no se cobra aquí: lo toma su liquidación. Sin el dato, todo sobre el
   * mes en curso.
   */
  rapMesVencido?: { base: MoneyInput } | null;
}

/**
 * Todos los importes son Decimal exacto. Se pueden pasar directo a Prisma para
 * escribir columnas `Decimal`; usar `aNumero()` solo al presentar.
 */
export interface ResultadoCalculoPlanilla {
  // Ingresos
  salarioBase: Money;
  montoHorasExtra: Money;
  totalBruto: Money;
  // Deducciones empleado
  ihssEmpleado: Money;
  rapEmpleado: Money;
  afpEmpleado: Money;
  isr: Money;
  impuestoVecinal: Money;
  ausencias: Money;
  /** Días de incapacidad a cargo del IHSS que el patrono no paga. */
  incapacidad: Money;
  otrosDeducciones: Money;
  totalDeducciones: Money;
  // Aportaciones empleador
  ihssEmpleador: Money;
  rapEmpleador: Money;
  infop: Money;
  /** Aporte patronal al Fondo de Reserva Laboral (Decreto 47-2024). */
  reservaLaboral: Money;
  // Desglose IVM (parte del total IHSS)
  ivmEmpleado: Money;
  ivmEmpleador: Money;
  ivmEstado: Money;
  /** La parte del empleado del IHSS vino de su monto fijo, no del porcentaje. */
  ihssFijo: boolean;
  // Resultado
  salarioNeto: Money;
  // Provisiones
  provision13vo: Money;
  provision14vo: Money;
  provisionVacaciones: Money;
}

export function calcularPlanilla(
  entrada: EntradaCalculoPlanilla,
  parametros: ParametrosLegales = PARAMETROS_DEFAULT
): ResultadoCalculoPlanilla {
  const { salarioMensual: salarioEntrada, tipoPlanilla, diasPagables, diasMes, horasExtra,
    bonificaciones, otrosIngresos, diasAusentes, otrosDeducciones,
    afpEmpleado: afpEntrada, aniosTrabajados } = entrada;

  const salarioMensual = money(salarioEntrada);

  // Factor de pago según tipo de planilla. Se mantiene como fracción exacta para
  // que no arrastre error binario al multiplicar.
  //
  // SEMANAL usa 12/52, no 7/30.4: el año tiene 52 semanas de pago, y 7/30.4
  // acumula sólo 11.97 meses al cabo del año — un defecto de ~0.25% arrastrado a
  // salario, IHSS, RAP e ISR de cada empleado.
  const factorPlanilla = tipoPlanilla === "SEMANAL" ? money(12).div(52)
    : tipoPlanilla === "QUINCENAL" ? money(0.5) : money(1);

  // Salario íntegro del período, proporcional SOLO a los días con derecho a
  // salario (ingreso/baja a mitad de período). Las ausencias no entran aquí.
  const salarioBase = redondear(salarioMensual.times(factorPlanilla).times(diasPagables).div(diasMes));
  const montoHorasExtra = calcularMontoHorasExtra(salarioMensual, horasExtra, parametros.jornadaHoras);
  const totalBruto = redondear(sumar(salarioBase, montoHorasExtra, bonificaciones, otrosIngresos));

  // Base ORDINARIA mensual: sobre ella cotizan IHSS, RAP y AFP, cuyas bases
  // legales son el salario ordinario y no las remuneraciones extraordinarias.
  //
  // Dos bases distintas:
  //  · La PROYECCIÓN del ISR usa el mes completo: el impuesto anualiza el salario
  //    de un mes normal, aunque éste sea parcial.
  //  · Los APORTES del período (IHSS, RAP, Reserva, INFOP) se calculan sobre lo
  //    DEVENGADO: el salario mensual por la fracción del período con derecho a
  //    salario, con los techos mensuales. Quien entra el 16 con 20,000 cotiza
  //    sobre 10,000. Antes cotizaba sobre los 20,000 del mes completo.
  const fraccion = diasMes > 0 ? money(Math.min(diasPagables, diasMes)).div(diasMes) : money(1);
  const completo = fraccion.equals(1);
  const baseDevengada = salarioMensual.times(fraccion);
  const parametrosDevengados = completo ? parametros : escalarMontosFijos(parametros, fraccion);
  const ihssFijoDevengado = entrada.ihssMontoFijoMensual === undefined || entrada.ihssMontoFijoMensual === null || completo
    ? entrada.ihssMontoFijoMensual
    : money(entrada.ihssMontoFijoMensual).times(fraccion);

  // Con monto fijo, el ISR de abajo resta ESE monto de su base: es el IHSS que
  // realmente se le descuenta al trabajador.
  const ihssProyeccion = calcularIHSS(salarioMensual, parametros, entrada.ihssMontoFijoMensual);
  const rapProyeccion = calcularRAP(salarioMensual, parametros);
  const ihssPeriodo = completo ? ihssProyeccion : calcularIHSS(baseDevengada, parametrosDevengados, ihssFijoDevengado);
  const rapPeriodo = completo ? rapProyeccion : calcularRAP(baseDevengada, parametrosDevengados);

  // Planilla quincenal con aportes «completos en una quincena»: en la elegida se
  // deduce el mes entero sobre lo devengado EN EL MES; en la otra, nada. Quien no
  // tiene días en la otra quincena paga el mes en ésta.
  const q = tipoPlanilla === "QUINCENAL" ? entrada.quincena ?? null : null;
  const fraccionMes = q ? money(Math.min(Math.max(q.diasPagablesMes, 0), 30)).div(30) : money(1);
  const mesCompleto = fraccionMes.equals(1);
  const parametrosMes = mesCompleto ? parametros : escalarMontosFijos(parametros, fraccionMes);
  const ihssFijoMes = entrada.ihssMontoFijoMensual === undefined || entrada.ihssMontoFijoMensual === null || mesCompleto
    ? entrada.ihssMontoFijoMensual
    : money(entrada.ihssMontoFijoMensual).times(fraccionMes);
  const distribucion = parametros.distribucionQuincenal ?? DISTRIBUCION_POR_OMISION;
  /** `null` = en esta quincena no se deduce; `mes` = el mes entero, sin prorratear. */
  const tramo = (modo: ModoQuincenal): { mes: boolean; factor: Money } | null => {
    if (!q) return { mes: false, factor: factorPlanilla };
    const t = tramoQuincenal(modo, q.numero, q.enOtraQuincena);
    return t === "quincena" ? { mes: false, factor: factorPlanilla } : t === "mes" ? { mes: true, factor: money(1) } : null;
  };
  const tramoIhss = tramo(distribucion.ihss);
  const tramoRap = tramo(distribucion.rap);
  const tramoVecinal = tramo(distribucion.vecinal);
  const ihss = tramoIhss?.mes ? calcularIHSS(salarioMensual.times(fraccionMes), parametrosMes, ihssFijoMes) : ihssPeriodo;
  const rap = tramoRap?.mes ? calcularRAP(salarioMensual.times(fraccionMes), parametrosMes) : rapPeriodo;
  // Una ficha que no cotiza (la persona cotiza en otra nómina) deja el aporte en cero:
  // lo del trabajador, lo patronal y el desglose del IVM salen de este factor.
  const cotizaIhss = entrada.aplicaIhss !== false;
  const cotizaRap = entrada.aplicaRap !== false;
  const factorIhss = cotizaIhss && tramoIhss ? tramoIhss.factor : CERO;
  const factorRap = cotizaRap && tramoRap ? tramoRap.factor : CERO;
  const factorVecinal = tramoVecinal ? tramoVecinal.factor : CERO;

  // RAP y Reserva a mes vencido: la base es de un mes ya cerrado y va entera, sin
  // prorratear por los días de este período. En quincenal se reparte según la opción
  // del RAP; con «la mitad en cada quincena», quien no está en la otra quincena paga
  // aquí todo el mes. Lo del mes de salida lo toma la liquidación.
  const vencido = entrada.rapMesVencido ?? null;
  let aMesVencido: { empleado: Money; empleador: Money; reserva: Money } | null = null;
  if (vencido) {
    const factorV = !q
      ? factorPlanilla
      : distribucion.rap === "DIVIDIDO"
        ? (q.enOtraQuincena ? factorPlanilla : money(1))
        : (tramoQuincenal(distribucion.rap, q.numero, q.enOtraQuincena) === "mes" ? money(1) : CERO);
    const delMes = calcularRAP(vencido.base, parametros);
    const reservaMes = calcularReservaLaboral(vencido.base, parametros).empleador;
    aMesVencido = {
      empleado: cotizaRap ? redondear(delMes.empleado.times(factorV)) : CERO,
      empleador: cotizaRap ? redondear(delMes.empleador.times(factorV)) : CERO,
      // La Reserva Laboral no depende de que esta ficha cotice al RAP.
      reserva: redondear(reservaMes.times(factorV)),
    };
  }

  // La AFP llega ya resuelta como importe DEL PERÍODO (cuota de la deducción
  // individual del empleado). Para la base del ISR —que es mensual— se lleva a
  // equivalente mensual, igual que se hace con horas extra y bonificaciones.
  const afpPeriodo = redondear(afpEntrada);
  const afpMensual = afpPeriodo.isZero() ? CERO : afpPeriodo.div(factorPlanilla);

  // Base IMPONIBLE mensual del ISR: comprende toda remuneración por el trabajo
  // personal — salario ordinario MÁS horas extra, bonificaciones y otros
  // ingresos gravables (Arts. 10 y 11 Ley del ISR). Excluirlas retiene en
  // defecto y deja una contingencia frente al SAR.
  //
  // Horas extra, bonificaciones y otros ingresos llegan como importes DEL
  // PERÍODO; se llevan a equivalente mensual antes de anualizar, porque la
  // tabla del ISR es anual. Es el mismo método de proyección con que ya se
  // trata el salario: se asume que el ingreso se repite en los demás períodos
  // del año. Un bono extraordinario e irrepetible queda así sobre-retenido en
  // el mes y se regulariza en la declaración anual del empleado.
  const ingresosGravablesPeriodo = sumar(montoHorasExtra, bonificaciones, otrosIngresos);
  const ingresosGravablesMensual = ingresosGravablesPeriodo.isZero()
    ? CERO
    : ingresosGravablesPeriodo.div(factorPlanilla);
  const baseImponibleMensual = salarioMensual.plus(ingresosGravablesMensual);

  // Sólo se resta del ISR lo que esta ficha de verdad le deduce.
  const baseISR = baseImponibleMensual
    .minus(cotizaIhss ? ihssProyeccion.empleado : CERO)
    .minus(cotizaRap ? rapProyeccion.empleado : CERO)
    .minus(afpMensual);
  const isrMensual = calcularISRMensual(baseISR, parametros);

  // Impuesto vecinal: su base son los ingresos totales SIN DEDUCCIONES (Art. 77
  // Ley de Municipalidades). Se usa `baseImponibleMensual` —salario más horas
  // extra, bonificaciones y otros ingresos— y NO `baseISR`, que ya viene neta de
  // IHSS, RAP y AFP. Antes se calculaba sólo sobre el salario ordinario.
  const impVecinal = calcularImpuestoVecinal(baseImponibleMensual, parametros.tablaVecinalAnual);

  // Proporcionar al período de pago
  const ihssEmp = redondear(ihss.empleado.times(factorIhss));
  const rapEmp = aMesVencido ? aMesVencido.empleado : redondear(rap.empleado.times(factorRap));
  // La AFP NO se prorratea: ya viene como importe del período.
  const afpEmp = afpPeriodo;
  const isrProp = entrada.isrDelPeriodo !== undefined && entrada.isrDelPeriodo !== null
    ? redondear(entrada.isrDelPeriodo)
    : redondear(isrMensual.times(factorPlanilla));
  const impVecProp = entrada.vecinalDelPeriodo !== undefined && entrada.vecinalDelPeriodo !== null
    ? redondear(entrada.vecinalDelPeriodo)
    : redondear(impVecinal.times(factorVecinal));
  // Lo que se deja de pagar por ausencias e incapacidad nunca pasa del sueldo
  // del período: ocho faltas en una quincena no pueden descontar más que la quincena.
  const ausencias = minimo(
    entrada.descuentoAsistencia !== undefined
      ? redondear(entrada.descuentoAsistencia)
      : calcularDescuentoAusencia(salarioMensual, diasAusentes, parametros.factorDescuentoAusencia, entrada.semanasConAusencia),
    salarioBase
  );
  const incapacidad = minimo(redondear(entrada.incapacidad ?? 0), maximo(salarioBase.minus(ausencias), 0));

  const totalDeducciones = redondear(
    sumar(ihssEmp, rapEmp, afpEmp, isrProp, impVecProp, ausencias, incapacidad, otrosDeducciones)
  );
  const salarioNeto = redondear(totalBruto.minus(totalDeducciones));

  // Aportaciones empleador
  const ihssEmpleador = redondear(ihss.empleador.times(factorIhss));
  const rapEmpleador = aMesVencido ? aMesVencido.empleador : redondear(rap.empleador.times(factorRap));
  const infopMensual = parametrosDevengados.fijos?.infop
    ? money(parametrosDevengados.fijos.infop.empleador)
    : baseDevengada.times(parametros.infopEmpleador);
  const infop = redondear(infopMensual.times(factorPlanilla));
  // El Fondo de Reserva Laboral es mensual como los demás aportes: se prorratea. A mes
  // vencido sigue al RAP: misma base y misma planilla.
  const reservaLaboral = aMesVencido
    ? aMesVencido.reserva
    : redondear(calcularReservaLaboral(baseDevengada, parametrosDevengados).empleador.times(factorPlanilla));

  // Desglose IVM proporcionado al período
  const ivmEmpleadoProp = redondear(ihss.ivmEmpleado.times(factorIhss));
  const ivmEmpleadorProp = redondear(ihss.ivmEmpleador.times(factorIhss));
  const ivmEstadoProp = redondear(ihss.ivmEstado.times(factorIhss));

  // Provisiones
  // Las provisiones devengan sobre el tiempo de servicio (días con derecho a
  // salario), en la misma base que `salarioBase`.
  const provision13vo = calcularProvision13vo(salarioMensual, diasPagables, diasMes).times(factorPlanilla);
  const provision14vo = calcularProvision14vo(salarioMensual, diasPagables, diasMes).times(factorPlanilla);
  const provisionVacaciones = calcularProvisionVacaciones(salarioMensual, aniosTrabajados, diasPagables, diasMes).times(factorPlanilla);

  return {
    salarioBase,
    montoHorasExtra,
    totalBruto,
    ihssEmpleado: ihssEmp,
    rapEmpleado: rapEmp,
    afpEmpleado: afpEmp,
    isr: isrProp,
    impuestoVecinal: impVecProp,
    ausencias,
    incapacidad,
    otrosDeducciones: money(otrosDeducciones),
    totalDeducciones,
    ihssEmpleador,
    rapEmpleador,
    infop,
    reservaLaboral,
    ivmEmpleado: ivmEmpleadoProp,
    ivmEmpleador: ivmEmpleadorProp,
    ivmEstado: ivmEstadoProp,
    ihssFijo: ihss.fijo,
    salarioNeto,
    provision13vo: redondear(provision13vo),
    provision14vo: redondear(provision14vo),
    provisionVacaciones: redondear(provisionVacaciones),
  };
}

// ─── CARGA DE PARÁMETROS DESDE FILAS DE BD ────────────────────────────────────

export interface FilaTablaISR {
  rangoDesde: number;
  rangoHasta: number | null;
  cuotaFija: number;
  porcentaje: number;
  excedenteDesde: number;
}

export interface FilaTablaVecinal {
  rangoDesde: number;
  rangoHasta: number | null;
  porMillar: number;
}

/**
 * Construye ParametrosLegales a partir de datos de BD. Cualquier campo ausente
 * cae al default 2026. La capa de datos es responsable de leer las filas.
 */
export function construirParametros(opts: {
  filasISR?: FilaTablaISR[];
  filasVecinal?: FilaTablaVecinal[];
  ihssEmpleado?: number | null;
  ihssEmpleador?: number | null;
  ihssTope?: number | null;
  ivmEmpleado?: number | null;
  ivmEmpleador?: number | null;
  ivmEstado?: number | null;
  ivmTope?: number | null;
  rapEmpleado?: number | null;
  rapEmpleador?: number | null;
  rapPiso?: number | null;
  infopEmpleador?: number | null;
  reservaLaboralEmpleador?: number | null;
  reservaLaboralTope?: number | null;
  deduccionMedicaAnual?: number | null;
  factorDescuentoAusencia?: number | null;
  jornadaHoras?: number | null;
  /** Conceptos en modo monto fijo; lo que no venga se calcula por porcentaje. */
  fijos?: Partial<MontosFijos>;
  distribucionQuincenal?: DistribucionQuincenal | null;
}): ParametrosLegales {
  const tablaISRAnual: TramoISR[] =
    opts.filasISR && opts.filasISR.length > 0
      ? opts.filasISR
          .map((f) => ({
            desde: f.rangoDesde,
            hasta: f.rangoHasta,
            cuotaFija: f.cuotaFija,
            porcentaje: f.porcentaje,
            excedenteDesde: f.excedenteDesde,
          }))
          .sort((a, b) => a.desde - b.desde)
      : TABLA_ISR_ANUAL_2026;

  const tablaVecinalAnual: TramoVecinal[] =
    opts.filasVecinal && opts.filasVecinal.length > 0
      ? opts.filasVecinal
          .map((f) => ({
            desde: f.rangoDesde,
            hasta: f.rangoHasta,
            porMillar: f.porMillar,
          }))
          .sort((a, b) => a.desde - b.desde)
      : TABLA_VECINAL_SPS;

  return {
    ihssEmpleado: opts.ihssEmpleado ?? IHSS_EMPLEADO,
    ihssEmpleador: opts.ihssEmpleador ?? IHSS_EMPLEADOR,
    ihssTope: opts.ihssTope ?? IHSS_TOPE_MENSUAL,
    ivmEmpleado: opts.ivmEmpleado ?? IVM_EMPLEADO,
    ivmEmpleador: opts.ivmEmpleador ?? IVM_EMPLEADOR,
    ivmEstado: opts.ivmEstado ?? IVM_ESTADO,
    ivmTope: opts.ivmTope ?? IVM_TOPE_MENSUAL,
    rapEmpleado: opts.rapEmpleado ?? RAP_EMPLEADO,
    rapEmpleador: opts.rapEmpleador ?? RAP_EMPLEADOR,
    rapPiso: opts.rapPiso ?? RAP_PISO_MENSUAL,
    infopEmpleador: opts.infopEmpleador ?? INFOP_EMPLEADOR,
    reservaLaboralEmpleador: opts.reservaLaboralEmpleador ?? RESERVA_LABORAL_EMPLEADOR,
    reservaLaboralTope: opts.reservaLaboralTope ?? RESERVA_LABORAL_TECHO_MENSUAL,
    deduccionMedicaAnual: opts.deduccionMedicaAnual ?? DEDUCCION_MEDICA_ANUAL,
    factorDescuentoAusencia: opts.factorDescuentoAusencia ?? FACTOR_DESCUENTO_AUSENCIA,
    jornadaHoras: opts.jornadaHoras ?? JORNADA_HORAS,
    tablaISRAnual,
    tablaVecinalAnual,
    fijos: { ...SIN_MONTOS_FIJOS, ...opts.fijos },
    distribucionQuincenal: opts.distribucionQuincenal ?? DISTRIBUCION_POR_OMISION,
  };
}

/**
 * Redondeo para magnitudes NO monetarias (días de vacaciones devengados).
 * Los importes usan `redondear()` de ./money — nunca esta función.
 */
function roundDos(n: number): number {
  return Math.round(n * 100) / 100;
}
