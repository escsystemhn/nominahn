/**
 * Liquidación final de prestaciones laborales (Honduras).
 *
 * CRITERIO: el de la calculadora oficial de la Secretaría de Trabajo y
 * Seguridad Social (consulta.trabajo.gob.hn), que es el que aplica la
 * inspectoría en un reclamo. Los conceptos y las causas de terminación son los
 * que maneja ese formulario.
 *
 * MARCO LEGAL
 *   · Preaviso — Art. 116 del Código del Trabajo.
 *   · Auxilio de cesantía — Art. 120, reformado por el Decreto Legislativo
 *     150-2008, que además añadió el Art. 120-A.
 *   · Vacaciones — Art. 346.
 *   · Décimo tercer y décimo cuarto mes — ver `./decimos.ts`.
 *
 * QUÉ SE PAGA SEGÚN LA CAUSA
 *
 *   Concepto            Despido injust.  Renuncia          Despido justif.  Muerte
 *   ─────────────────── ───────────────  ────────────────  ───────────────  ──────────────
 *   Preaviso            sí               no                no               no
 *   Auxilio cesantía    100 %            35 % si >15 años  no               75 % si >6 meses
 *   Vacaciones          sí               sí                sí               sí
 *   13.º y 14.º prop.   sí               sí                sí               sí
 *
 * Vacaciones y décimos se pagan SIEMPRE: son salario ya devengado, no una
 * indemnización, y por tanto no dependen de por qué terminó la relación.
 *
 * Es lógica pura (sin Prisma ni red) para poder probarse de forma aislada.
 */

import { money, redondear, minimo, sumar, CERO, type Money, type MoneyInput } from "./money";
import { calcularVacacionesDevengadas } from "./calculos-hn";

export type CausaTerminacion =
  | "DESPIDO_INJUSTIFICADO"
  | "RENUNCIA"
  | "DESPIDO_JUSTIFICADO"
  | "MUERTE";

// ─── CONSTANTES LEGALES ───────────────────────────────────────────────────────

/**
 * Preaviso — Art. 116. Días de salario según el tiempo de servicio continuo.
 * Ordenada de mayor a menor antigüedad: se toma el primer tramo que aplique.
 */
export const TABLA_PREAVISO: { mesesMin: number; dias: number }[] = [
  { mesesMin: 24, dias: 60 }, // más de 2 años → 2 meses
  { mesesMin: 12, dias: 30 }, // de 1 a 2 años → 1 mes
  { mesesMin: 6, dias: 14 },  // de 6 meses a 1 año → 2 semanas
  { mesesMin: 3, dias: 7 },   // de 3 a 6 meses → 1 semana
  { mesesMin: 0, dias: 1 },   // menos de 3 meses → 24 horas
];

/** Auxilio de cesantía — Art. 120. Días de salario para servicios menores a un año. */
export const CESANTIA_DIAS_3_A_6_MESES = 10;
export const CESANTIA_DIAS_6_A_12_MESES = 20;
/** A partir del año: un mes de salario por cada año de servicio. */
export const CESANTIA_DIAS_POR_ANIO = 30;
/** Menos de tres meses de servicio no generan auxilio de cesantía. */
export const CESANTIA_MESES_MINIMOS = 3;

/**
 * Tope del auxilio de cesantía: 25 meses de salario (750 días).
 *
 * En empresas de hasta DIEZ trabajadores el tope baja a 15 meses (450 días) y
 * además no aplica el 35 % por renuncia con más de 15 años — Art. 120-A,
 * incorporado por el Decreto 150-2008. Es la razón por la que el formulario de
 * la Secretaría de Trabajo pregunta «Más de 10 Empleados».
 */
export const TOPE_CESANTIA_DIAS = 750;
export const TOPE_CESANTIA_DIAS_MICROEMPRESA = 450;
export const MAX_EMPLEADOS_MICROEMPRESA = 10;

/** Renuncia voluntaria: da derecho a parte del auxilio a partir de 15 años. */
export const ANIOS_MINIMOS_CESANTIA_RENUNCIA = 15;
export const PORCENTAJE_CESANTIA_RENUNCIA = 0.35;

/** Muerte del trabajador: los beneficiarios reciben el 75 % desde los 6 meses. */
export const MESES_MINIMOS_CESANTIA_MUERTE = 6;
export const PORCENTAJE_CESANTIA_MUERTE = 0.75;

/** El salario base es el promedio ordinario de los últimos seis meses. */
export const MESES_PROMEDIO_SALARIO = 6;

const MS_DIA = 24 * 60 * 60 * 1000;

// ─── TIEMPO DE SERVICIO ───────────────────────────────────────────────────────

export interface TiempoServicio {
  /** Días naturales entre ingreso y salida, ambos inclusive. */
  dias: number;
  /** Aniversarios cumplidos. */
  aniosCompletos: number;
  /** Meses completos de servicio (para las tablas de preaviso y cesantía). */
  mesesCompletos: number;
  /** Años de servicio con decimales: años completos más la fracción en curso. */
  aniosFraccionarios: number;
}

/**
 * Tiempo de servicio entre dos fechas de calendario.
 *
 * Los meses y aniversarios se cuentan por CALENDARIO, no dividiendo días entre
 * 30: quien entra el 31 de enero cumple un mes el 28 de febrero, y la tabla del
 * Art. 116 habla de meses, no de bloques de treinta días.
 */
export function calcularTiempoServicio(fechaIngreso: Date, fechaSalida: Date): TiempoServicio {
  if (fechaSalida < fechaIngreso) {
    return { dias: 0, aniosCompletos: 0, mesesCompletos: 0, aniosFraccionarios: 0 };
  }

  // Inclusivo en ambos extremos: el día de ingreso y el de salida se trabajan.
  const dias = Math.floor((fechaSalida.getTime() - fechaIngreso.getTime()) / MS_DIA) + 1;

  let mesesCompletos =
    (fechaSalida.getUTCFullYear() - fechaIngreso.getUTCFullYear()) * 12 +
    (fechaSalida.getUTCMonth() - fechaIngreso.getUTCMonth());

  if (fechaSalida.getUTCDate() < fechaIngreso.getUTCDate()) {
    // El mes sólo se completa al llegar al mismo día del mes… salvo cuando el
    // mes de salida no LLEGA a tener ese día: quien ingresa el 31 de enero
    // cumple el mes el 28 de febrero, porque febrero no tiene 31. Sin esta
    // excepción, los ingresos de fin de mes perdían un mes de antigüedad y con
    // él un tramo entero de preaviso o de cesantía.
    const diasDelMesDeSalida = new Date(
      Date.UTC(fechaSalida.getUTCFullYear(), fechaSalida.getUTCMonth() + 1, 0)
    ).getUTCDate();
    const salidaEsUltimoDiaDelMes = fechaSalida.getUTCDate() === diasDelMesDeSalida;
    const mesCortoParaElAniversario = fechaIngreso.getUTCDate() > diasDelMesDeSalida;

    if (!(salidaEsUltimoDiaDelMes && mesCortoParaElAniversario)) mesesCompletos--;
  }

  mesesCompletos = Math.max(0, mesesCompletos);

  const aniosCompletos = Math.floor(mesesCompletos / 12);

  // Fracción del año en curso, medida en días desde el último aniversario.
  const ultimoAniversario = new Date(fechaIngreso);
  ultimoAniversario.setUTCFullYear(fechaIngreso.getUTCFullYear() + aniosCompletos);
  const diasFraccion = Math.max(
    0,
    Math.floor((fechaSalida.getTime() - ultimoAniversario.getTime()) / MS_DIA)
  );
  const aniosFraccionarios = aniosCompletos + diasFraccion / 365;

  return { dias, aniosCompletos, mesesCompletos, aniosFraccionarios };
}

// ─── PREAVISO ─────────────────────────────────────────────────────────────────

/** Días de preaviso que corresponden según el Art. 116. */
export function diasPreaviso(mesesServicio: number): number {
  const tramo = TABLA_PREAVISO.find((t) => mesesServicio >= t.mesesMin);
  return tramo ? tramo.dias : 0;
}

// ─── AUXILIO DE CESANTÍA ──────────────────────────────────────────────────────

/**
 * Días de auxilio de cesantía ANTES de aplicar el porcentaje de la causa.
 *
 * Bajo el año la ley fija cantidades cerradas (10 y 20 días); a partir del año
 * es un mes por año, y la fracción se paga en proporción al tiempo trabajado.
 */
export function diasCesantia(t: TiempoServicio, esMicroempresa = false): number {
  if (t.mesesCompletos < CESANTIA_MESES_MINIMOS) return 0;
  if (t.mesesCompletos < 6) return CESANTIA_DIAS_3_A_6_MESES;
  if (t.mesesCompletos < 12) return CESANTIA_DIAS_6_A_12_MESES;

  const dias = CESANTIA_DIAS_POR_ANIO * t.aniosFraccionarios;
  const tope = esMicroempresa ? TOPE_CESANTIA_DIAS_MICROEMPRESA : TOPE_CESANTIA_DIAS;
  return Math.min(dias, tope);
}

/**
 * Proporción del auxilio que corresponde según la causa de terminación.
 *
 * El despido justificado no genera auxilio. La renuncia sólo a partir de 15
 * años y al 35 %, salvo en microempresa, donde el Art. 120-A lo excluye.
 */
export function porcentajeCesantia(
  causa: CausaTerminacion,
  t: TiempoServicio,
  esMicroempresa = false
): number {
  switch (causa) {
    case "DESPIDO_INJUSTIFICADO":
      return 1;

    case "RENUNCIA":
      if (esMicroempresa) return 0;
      return t.aniosCompletos >= ANIOS_MINIMOS_CESANTIA_RENUNCIA
        ? PORCENTAJE_CESANTIA_RENUNCIA
        : 0;

    case "MUERTE":
      return t.mesesCompletos >= MESES_MINIMOS_CESANTIA_MUERTE ? PORCENTAJE_CESANTIA_MUERTE : 0;

    case "DESPIDO_JUSTIFICADO":
      return 0;
  }
}

/** ¿Corresponde pagar preaviso? Sólo el despido injustificado lo genera. */
export function correspondePreaviso(causa: CausaTerminacion): boolean {
  return causa === "DESPIDO_INJUSTIFICADO";
}

// ─── LIQUIDACIÓN COMPLETA ─────────────────────────────────────────────────────

export interface EntradaLiquidacion {
  fechaIngreso: Date;
  fechaSalida: Date;
  causa: CausaTerminacion;
  /**
   * Salario ordinario PROMEDIO de los últimos seis meses, incluidas comisiones,
   * horas extra y bonificaciones habituales (Art. 361). Usar el último salario
   * a secas sobrevalora la liquidación de quien acaba de recibir un aumento.
   */
  salarioPromedio: MoneyInput;
  /** Empresa de hasta diez trabajadores: tope reducido y sin 35 % por renuncia. */
  esMicroempresa?: boolean;
  /** Días de vacaciones ya gozados; se restan del devengado. */
  diasVacacionesGozados?: number;
  /**
   * El patrono dio el preaviso por escrito y el trabajador lo laboró. En ese
   * caso no se paga: la ley permite omitirlo pagando su equivalente, no cobrarlo
   * dos veces.
   */
  preavisoOtorgado?: boolean;
  /** Décimos del período ya liquidados, para no pagarlos dos veces. */
  decimoTerceroDevengado?: MoneyInput;
  decimoCuartoDevengado?: MoneyInput;
  /** Salario del último período pendiente de pago. */
  salariosPendientes?: MoneyInput;
  /** Otros conceptos adeudados (horas extra pendientes, reajustes). */
  otrosAdeudos?: MoneyInput;
  /** Anticipos, préstamos o adelantos a descontar del finiquito. */
  deducciones?: MoneyInput;
}

export interface ConceptoLiquidacion {
  concepto: string;
  /** Días de salario que sustentan el importe; `null` en conceptos sin base diaria. */
  dias: number | null;
  monto: Money;
  /** Fundamento legal, para que el finiquito sea auditable. */
  base: string;
}

export interface ResultadoLiquidacion {
  tiempoServicio: TiempoServicio;
  salarioDiario: Money;
  /** Conceptos a favor del trabajador, en el orden en que se presentan. */
  conceptos: ConceptoLiquidacion[];
  totalPrestaciones: Money;
  deducciones: Money;
  totalAPagar: Money;
  /** Avisos sobre topes aplicados o derechos que no corresponden. */
  observaciones: string[];
}

/**
 * Liquidación final completa.
 *
 * El salario diario sale de dividir el promedio mensual entre 30, que es la
 * convención de nómina en Honduras y la que usa la Secretaría de Trabajo.
 */
export function calcularLiquidacion(entrada: EntradaLiquidacion): ResultadoLiquidacion {
  const {
    fechaIngreso,
    fechaSalida,
    causa,
    salarioPromedio,
    esMicroempresa = false,
    diasVacacionesGozados = 0,
    preavisoOtorgado = false,
    decimoTerceroDevengado = 0,
    decimoCuartoDevengado = 0,
    salariosPendientes = 0,
    otrosAdeudos = 0,
    deducciones = 0,
  } = entrada;

  const t = calcularTiempoServicio(fechaIngreso, fechaSalida);
  const salarioMensual = money(salarioPromedio);
  const salarioDiario = redondear(salarioMensual.div(30));

  const conceptos: ConceptoLiquidacion[] = [];
  const observaciones: string[] = [];

  const agregar = (concepto: string, dias: number | null, monto: Money, base: string) => {
    if (monto.isZero()) return;
    conceptos.push({ concepto, dias, monto: redondear(monto), base });
  };

  // ── Preaviso ───────────────────────────────────────────────────────────────
  if (correspondePreaviso(causa)) {
    if (preavisoOtorgado) {
      observaciones.push("Preaviso otorgado por escrito: no se paga su equivalente.");
    } else {
      const dias = diasPreaviso(t.mesesCompletos);
      agregar("Preaviso", dias, salarioDiario.times(dias), "Art. 116 C.T.");
    }
  } else if (causa === "RENUNCIA") {
    observaciones.push(
      "La renuncia no genera preaviso a cargo del patrono; es el trabajador quien debe darlo."
    );
  }

  // ── Auxilio de cesantía ────────────────────────────────────────────────────
  const diasBase = diasCesantia(t, esMicroempresa);
  const porcentaje = porcentajeCesantia(causa, t, esMicroempresa);

  if (diasBase > 0 && porcentaje > 0) {
    const dias = diasBase * porcentaje;
    const etiqueta =
      porcentaje === 1
        ? "Auxilio de cesantía"
        : `Auxilio de cesantía (${(porcentaje * 100).toFixed(0)} %)`;
    agregar(etiqueta, redondearDias(dias), salarioDiario.times(dias), "Art. 120 C.T.");

    const tope = esMicroempresa ? TOPE_CESANTIA_DIAS_MICROEMPRESA : TOPE_CESANTIA_DIAS;
    if (CESANTIA_DIAS_POR_ANIO * t.aniosFraccionarios > tope) {
      observaciones.push(
        `Auxilio de cesantía limitado al tope legal de ${tope / 30} meses` +
          (esMicroempresa ? " (empresa de hasta 10 trabajadores, Art. 120-A C.T.)." : ".")
      );
    }
  } else if (causa === "DESPIDO_JUSTIFICADO") {
    observaciones.push("El despido con causa justificada no genera auxilio de cesantía.");
  } else if (causa === "RENUNCIA" && porcentaje === 0) {
    observaciones.push(
      esMicroempresa
        ? "En empresas de hasta 10 trabajadores la renuncia no genera auxilio de cesantía (Art. 120-A C.T.)."
        : `La renuncia genera auxilio de cesantía sólo a partir de ${ANIOS_MINIMOS_CESANTIA_RENUNCIA} años de servicio.`
    );
  } else if (causa === "MUERTE" && porcentaje === 0) {
    observaciones.push(
      `Por muerte del trabajador el auxilio corresponde desde los ${MESES_MINIMOS_CESANTIA_MUERTE} meses de servicio.`
    );
  } else if (diasBase === 0 && t.mesesCompletos < CESANTIA_MESES_MINIMOS) {
    observaciones.push(
      `Menos de ${CESANTIA_MESES_MINIMOS} meses de servicio: no genera auxilio de cesantía.`
    );
  }

  // ── Vacaciones no gozadas ──────────────────────────────────────────────────
  // Salario ya devengado: se paga cualquiera que sea la causa de terminación.
  const diasVacDevengados = calcularVacacionesDevengadas(fechaIngreso, fechaSalida);
  const diasVacSaldo = Math.max(0, diasVacDevengados - diasVacacionesGozados);
  agregar(
    "Vacaciones no gozadas",
    redondearDias(diasVacSaldo),
    salarioDiario.times(diasVacSaldo),
    "Art. 346 C.T."
  );

  // ── Décimos proporcionales ─────────────────────────────────────────────────
  // Los calcula `./decimos.ts`; aquí sólo entran como importe ya devengado.
  agregar("Décimo tercer mes proporcional", null, money(decimoTerceroDevengado), "Decreto 112-82");
  agregar("Décimo cuarto mes proporcional", null, money(decimoCuartoDevengado), "Decreto 135-94");

  // ── Adeudos pendientes ─────────────────────────────────────────────────────
  agregar("Salarios pendientes", null, money(salariosPendientes), "Art. 367 C.T.");
  agregar("Otros adeudos", null, money(otrosAdeudos), "—");

  const totalPrestaciones = redondear(sumar(...conceptos.map((c) => c.monto)));
  // Las deducciones no pueden dejar el finiquito en negativo: un saldo de
  // préstamo mayor que la liquidación se cobra aparte, no convierte el
  // finiquito en una deuda del trabajador.
  const deduccionesAplicadas = minimo(money(deducciones), totalPrestaciones);

  if (money(deducciones).greaterThan(deduccionesAplicadas)) {
    observaciones.push(
      "Las deducciones superan el total de prestaciones: se acotaron al importe liquidado. " +
        "El saldo restante debe gestionarse por separado."
    );
  }

  return {
    tiempoServicio: t,
    salarioDiario,
    conceptos,
    totalPrestaciones,
    deducciones: redondear(deduccionesAplicadas),
    totalAPagar: redondear(totalPrestaciones.minus(deduccionesAplicadas)),
    observaciones,
  };
}

/**
 * Salario ordinario promedio de los últimos seis meses.
 *
 * Se promedia sobre `MESES_PROMEDIO_SALARIO` y no sobre los períodos
 * encontrados: quien lleva menos de seis meses en la empresa debe ver diluido
 * su promedio igual que lo hace la Secretaría de Trabajo. Si no hay ningún
 * período registrado, el llamador debe caer al salario base del empleado.
 */
export function salarioOrdinarioPromedio(
  periodos: { totalBruto: MoneyInput }[],
  meses: number = MESES_PROMEDIO_SALARIO
): Money {
  if (periodos.length === 0) return CERO;
  const total = sumar(...periodos.map((p) => p.totalBruto));
  return redondear(total.div(Math.max(1, Math.min(meses, periodos.length))));
}

/** Días a dos decimales: las fracciones de cesantía y vacaciones no son enteras. */
function redondearDias(d: number): number {
  return Math.round(d * 100) / 100;
}
