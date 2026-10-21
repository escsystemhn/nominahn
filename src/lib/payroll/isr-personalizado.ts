/**
 * ISR — CÁLCULO PERSONALIZADO: replica la hoja «Retención en la fuente» que usan
 * algunos clientes, en lugar de anualizar el mes (método estándar,
 * `calcularISRMensual`). PURO: sin base de datos.
 *
 * Para el mes M de una planilla mensual, igual que la hoja:
 *
 *   ingreso anual = sueldos pagados de enero a M + salario × (12 − M)
 *                 + promedio de comisiones/variables de enero a M × 12
 *                   (en diciembre, la suma real)
 *   deducciones   = gastos médicos según la edad
 *                 + IVM: techo × % del empleado por cada mes con sueldo
 *                 + RAP y AFP (opcionales)
 *   ISR anual     = tabla progresiva sobre (ingreso − deducciones)
 *   retención     = máx(0, (ISR anual − lo ya retenido en el año) ÷ meses que faltan, incluido M)
 *
 * Planillas quincenales y semanales siguen la misma lógica por PERÍODO (24 o 52
 * en el año): «meses» se vuelve «parte del año», y la retención se reparte entre
 * los períodos que faltan. Para la planilla mensual coincide con la hoja.
 *
 * Diferencias con el método estándar: proyecta con lo realmente pagado (meses
 * parciales, incapacidades), promedia las comisiones en vez de multiplicar las
 * del mes por 12 y corrige lo retenido de más o de menos en los meses
 * siguientes. Como la hoja, nunca devuelve: una retención negativa queda en 0.
 */

import { CERO, maximo, money, redondear, sumarPor, type Money, type MoneyInput } from "./money";
import { isrAnualSegunTabla, type TramoISR } from "./calculos-hn";

export type MetodoIsr = "ESTANDAR" | "PERSONALIZADO";

export interface TramoEdad {
  /** Edad (en años, como la hoja: año de la planilla − año de nacimiento) desde la que aplica. */
  desdeEdad: number;
  /** Deducción anual por gastos médicos. */
  monto: number;
}

export interface ConfigIsrPersonalizado {
  /** Gastos médicos según la edad. */
  deduccionPorEdad: TramoEdad[];
  /** Resta el IVM del IHSS: techo × % del empleado por cada mes con sueldo, como la hoja. */
  deducirIvm: boolean;
  /** Resta el RAP del empleado (la hoja tiene la columna, pero vacía). */
  deducirRap: boolean;
  /** Resta la AFP del empleado. */
  deducirAfp: boolean;
}

/**
 * Valores de la FÓRMULA de la hoja (columna GASTOS MEDICOS): menos de 60 años,
 * L40,000; de 60 a 64, L70,000; 65 o más, L460,000. Ojo: la tabla oculta de la
 * misma hoja dice L40,000 / L40,000 / L80,000; no se verificó cuál es la vigente.
 */
export const CONFIG_ISR_PERSONALIZADO_DEFAULT: ConfigIsrPersonalizado = {
  deduccionPorEdad: [
    { desdeEdad: 0, monto: 40000 },
    { desdeEdad: 60, monto: 70000 },
    { desdeEdad: 65, monto: 460000 },
  ],
  deducirIvm: true,
  deducirRap: false,
  deducirAfp: true,
};

/** Un período ya pagado del año (una línea de planilla) o un mes importado. */
export interface PeriodoPagadoIsr {
  /** Cuántos meses representa: 1 un mes, 0.5 una quincena, 12/52 una semana. */
  meses: number;
  /** Salario ordinario efectivamente pagado (descontadas ausencias e incapacidad). */
  sueldo: MoneyInput;
  /** Comisiones, horas extra, bonificaciones y otros ingresos. */
  variables: MoneyInput;
  isrRetenido: MoneyInput;
  rap?: MoneyInput;
  afp?: MoneyInput;
}

export interface EntradaIsrPersonalizado {
  /** 12, 24 o 52 según el tipo de planilla. */
  periodosAnio: number;
  /** Número del período que se calcula dentro del año (1 = el primero). */
  indicePeriodo: number;
  /** Períodos ANTERIORES del mismo año (planillas e importados). */
  historial: PeriodoPagadoIsr[];
  /** El período que se está calculando. */
  actual: { sueldo: MoneyInput; variables: MoneyInput; rap?: MoneyInput; afp?: MoneyInput };
  /** Salario mensual vigente: con él se proyecta lo que falta del año. */
  salarioMensual: MoneyInput;
  /** false si la persona deja la empresa en este período: no se proyecta nada más. */
  proyectar: boolean;
  edad: number;
  /** Techo y % del empleado del IVM, de los parámetros de ley. */
  ivmTope: number;
  ivmEmpleado: number;
  /** RAP mensual del empleado, para proyectarlo si se deduce. */
  rapMensual?: MoneyInput;
  tabla: TramoISR[];
  config: ConfigIsrPersonalizado;
}

/** Lo que se guarda en `PlanillaDetalle.isrDetalle` y muestra el reporte DMR. */
export interface DetalleIsrPersonalizado {
  metodo: "PERSONALIZADO";
  edad: number;
  ingresoAnual: number;
  gastosMedicos: number;
  ivm: number;
  rap: number;
  afp: number;
  deducciones: number;
  renta: number;
  isrAnual: number;
  retenidoPrevio: number;
  periodosRestantes: number;
  retencion: number;
}

/** Período dentro del año según la fecha en que termina: mes, quincena o semana. */
export function indicePeriodoDelAnio(tipo: "MENSUAL" | "QUINCENAL" | "SEMANAL", fechaFin: Date): { periodosAnio: number; indice: number } {
  const mes = fechaFin.getUTCMonth() + 1;
  if (tipo === "MENSUAL") return { periodosAnio: 12, indice: mes };
  if (tipo === "QUINCENAL") return { periodosAnio: 24, indice: (mes - 1) * 2 + (fechaFin.getUTCDate() <= 15 ? 1 : 2) };
  const inicioAnio = Date.UTC(fechaFin.getUTCFullYear(), 0, 1);
  const dia = Math.floor((fechaFin.getTime() - inicioAnio) / 86_400_000) + 1;
  return { periodosAnio: 52, indice: Math.min(52, Math.ceil(dia / 7)) };
}

/** Cuántos meses representa una planilla de ese tipo. */
export const mesesDeTipo = (tipo: "MENSUAL" | "QUINCENAL" | "SEMANAL"): number =>
  tipo === "MENSUAL" ? 1 : tipo === "QUINCENAL" ? 0.5 : 12 / 52;

/** Gastos médicos del tramo de edad que corresponde (el de mayor «desde» que no la supere). */
export function gastosMedicosPorEdad(edad: number, tramos: TramoEdad[]): number {
  const orden = [...tramos].sort((a, b) => a.desdeEdad - b.desdeEdad);
  let monto = orden[0]?.monto ?? 0;
  for (const t of orden) if (edad >= t.desdeEdad) monto = t.monto;
  return monto;
}

const n2 = (m: Money) => Number(redondear(m).toFixed(2));

export function calcularIsrPersonalizado(e: EntradaIsrPersonalizado): { retencion: Money; detalle: DetalleIsrPersonalizado } {
  // En MESES y no en fracciones del año: para la planilla mensual todo queda en
  // enteros exactos (1/12 sumado seis veces no da 0.5 en punto flotante).
  const mesesPeriodo = 12 / e.periodosAnio;
  const registros = [...e.historial, { ...e.actual, meses: mesesPeriodo, isrRetenido: 0 }];
  const periodosDespues = e.proyectar ? Math.max(0, e.periodosAnio - e.indicePeriodo) : 0;
  const mesesRestantes = periodosDespues * mesesPeriodo;

  // Sueldos: lo pagado + el salario vigente en lo que falta del año.
  const sueldos = sumarPor(registros, (r) => r.sueldo).plus(money(e.salarioMensual).times(mesesRestantes));

  // Variables: promedio de los períodos con registro × el año, como el
  // PROMEDIO de la hoja (que ignora los meses en blanco, p. ej. antes del
  // ingreso). Al cierre del año, o si la persona se va, la suma real.
  const sumaVariables = sumarPor(registros, (r) => r.variables);
  const mesesConRegistro = registros.reduce((s, r) => s + r.meses, 0);
  const variables = e.indicePeriodo >= e.periodosAnio || !e.proyectar || mesesConRegistro <= 0
    ? sumaVariables
    : sumaVariables.div(mesesConRegistro).times(12);

  const ingresoAnual = sueldos.plus(variables);

  // Deducciones.
  const gastosMedicos = money(gastosMedicosPorEdad(e.edad, e.config.deduccionPorEdad));
  const mesesConSueldo = registros.reduce((s, r) => s + (money(r.sueldo).greaterThan(0) ? r.meses : 0), 0) + mesesRestantes;
  const ivm = e.config.deducirIvm ? money(e.ivmTope).times(e.ivmEmpleado).times(mesesConSueldo) : CERO;
  const rap = e.config.deducirRap
    ? sumarPor(registros, (r) => r.rap ?? 0).plus(money(e.rapMensual ?? 0).times(mesesRestantes))
    : CERO;
  const afp = e.config.deducirAfp
    ? sumarPor(registros, (r) => r.afp ?? 0).plus(money(e.actual.afp ?? 0).times(periodosDespues))
    : CERO;
  const deducciones = gastosMedicos.plus(ivm).plus(rap).plus(afp);

  const renta = maximo(ingresoAnual.minus(deducciones), 0);
  const isrAnual = isrAnualSegunTabla(renta, e.tabla);
  const retenidoPrevio = sumarPor(e.historial, (r) => r.isrRetenido);
  const periodosRestantes = Math.max(1, e.periodosAnio - e.indicePeriodo + 1);
  const retencion = redondear(maximo(isrAnual.minus(retenidoPrevio).div(periodosRestantes), 0));

  return {
    retencion,
    detalle: {
      metodo: "PERSONALIZADO",
      edad: e.edad,
      ingresoAnual: n2(ingresoAnual),
      gastosMedicos: n2(gastosMedicos),
      ivm: n2(ivm),
      rap: n2(rap),
      afp: n2(afp),
      deducciones: n2(deducciones),
      renta: n2(renta),
      isrAnual: n2(isrAnual),
      retenidoPrevio: n2(retenidoPrevio),
      periodosRestantes,
      retencion: n2(retencion),
    },
  };
}
