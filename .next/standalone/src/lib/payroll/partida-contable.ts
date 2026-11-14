/**
 * Generación de la partida contable (asiento de diario) de una planilla.
 *
 * Toma los totales ya calculados en PlanillaDetalle y produce un asiento
 * balanceado (Debe = Haber) listo para registrar o exportar al sistema contable.
 *
 * Función PURA: no accede a BD. La capa de datos pasa los detalles.
 *
 * Estructura del asiento (Honduras):
 *   DEBE  (gastos):    Sueldos, horas extra, bonificaciones, aportes patronales
 *                      (IHSS/RAP/INFOP) y provisiones (13vo/14vo/vacaciones).
 *   HABER (pasivos):   Instituciones por pagar (IHSS/RAP/INFOP/AFP), retenciones
 *                      (ISR, impuesto vecinal), cooperativa, recuperaciones de
 *                      préstamos/adelantos, provisiones por pagar y el neto a
 *                      pagar a los empleados.
 *
 * Los códigos por omisión son los del catálogo de ejemplo (`CATALOGO_POR_OMISION`
 * en catalogo-contable.ts); el contador asigna los de su propio catálogo desde
 * Configuración contable. Las provisiones se incluyen por defecto (contabilidad
 * de acumulación); pueden omitirse con la opción `incluirProvisiones: false`.
 *
 * PRECISIÓN: los importes se acumulan en Decimal, nunca en `number`. El cuadre
 * se exige EXACTO (diferencia cero, sin tolerancia), y eso se sostiene porque la
 * entrada son columnas `Decimal(12,2)`: como mucho 12 dígitos significativos por
 * línea y ~10 en el total de 200 empleados, holgadamente dentro de los 20 de
 * precisión de decimal.js. Si alguna vez se alimenta esta función con valores de
 * más decimales (p. ej. un `number` de JS con residuo binario), la suma de
 * cientos de líneas puede dejar un residuo del orden de 1e-12 y `cuadra` daría
 * false. La solución en ese caso es sanear la entrada, no reintroducir una
 * tolerancia: la tolerancia es justo lo que ocultó este defecto durante años.
 */

import { sumarPor, esCero, CERO, type Money, type MoneyInput } from "./money";

/**
 * Acepta directamente los `Decimal` que devuelve Prisma: los importes viajan de
 * la BD al asiento sin pasar por `Number()`, que es donde se perdía precisión.
 */
export interface DetalleParaPartida {
  salarioBase: MoneyInput;
  montoHorasExtra: MoneyInput;
  bonificaciones: MoneyInput;
  otrosIngresos: MoneyInput;
  ihssEmpleado: MoneyInput;
  rapEmpleado: MoneyInput;
  afpEmpleado: MoneyInput;
  isr: MoneyInput;
  impuestoVecinal: MoneyInput;
  cooperativa: MoneyInput;
  prestamos: MoneyInput;
  adelantos: MoneyInput;
  ausencias: MoneyInput;
  /** Días de incapacidad del IHSS no pagados; va con las ausencias en el asiento. */
  incapacidad?: MoneyInput | null;
  otrosDeducciones: MoneyInput;
  ihssEmpleador: MoneyInput;
  rapEmpleador: MoneyInput;
  infop: MoneyInput;
  reservaLaboral: MoneyInput;
  ivmEmpleado: MoneyInput;
  ivmEmpleador: MoneyInput;
  salarioNeto: MoneyInput;
  provision13vo: MoneyInput;
  provision14vo: MoneyInput;
  provisionVacaciones: MoneyInput;
}

export interface LineaPartida {
  /**
   * Concepto que representa la línea (`sueldos`, `isrPorPagar`, …).
   *
   * Es lo ESTABLE del asiento. El código de cuenta lo remapea el contador a su
   * catálogo, así que cualquier lógica que dependa del número —por ejemplo saber
   * si una línea es gasto para repartirla por centro de costo— se rompe en
   * cuanto lo cambia. La clave no cambia nunca.
   */
  clave: ClaveCuenta;
  cuenta: string;
  nombre: string;
  debe: Money;
  haber: Money;
}

export interface PartidaContable {
  lineas: LineaPartida[];
  totalDebe: Money;
  totalHaber: Money;
  /** Cuadre EXACTO: Debe − Haber = 0 al céntimo. Sin tolerancia. */
  cuadra: boolean;
  diferencia: Money;
  /**
   * Rubros que llegaron con signo negativo. Un concepto de nómina nunca debería
   * serlo; cuando ocurre es un dato corrupto o una configuración de topes mal
   * puesta. Se registran en el lado contrario (el asiento sigue cuadrando) y se
   * listan aquí para que el contador lo vea, en vez de desaparecer en silencio.
   */
  anomalias: string[];
}

/**
 * Plan de cuentas POR OMISIÓN.
 *
 * Es el punto de partida, no la verdad: el contador remapea códigos y nombres a
 * su propio catálogo desde `/plan-cuentas`, y lo guardado prevalece sobre esto.
 * Lo que NO cambia nunca es la `clave` de cada concepto (`sueldos`, `isrPorPagar`),
 * porque es lo que el motor usa para saber qué está registrando.
 *
 * `naturaleza` decide si el importe es GASTO —y por tanto se reparte por centro
 * de costo— o PASIVO de la empresa frente a terceros, que no se reparte. Se
 * declara aquí y no se deduce del código: en cuanto el contador remapea 5101 a
 * su propia numeración, cualquier deducción a partir del número deja de valer.
 */
export const CUENTAS = {
  sueldos:            { cuenta: "610201", nombre: "Sueldos y Salarios Ordinarios", naturaleza: "GASTO" },
  horasExtra:         { cuenta: "610202", nombre: "Horas Extra", naturaleza: "GASTO" },
  bonificaciones:     { cuenta: "610203", nombre: "Bonificaciones", naturaleza: "GASTO" },
  otrosIngresos:      { cuenta: "610204", nombre: "Otros Ingresos Laborales", naturaleza: "GASTO" },
  patronalIhss:       { cuenta: "610601", nombre: "Aporte Patronal IHSS-EM", naturaleza: "GASTO" },
  patronalIvm:        { cuenta: "610602", nombre: "Aporte Patronal IVM", naturaleza: "GASTO" },
  patronalRap:        { cuenta: "610603", nombre: "Aporte Patronal RAP", naturaleza: "GASTO" },
  patronalInfop:      { cuenta: "610604", nombre: "Aporte Patronal INFOP", naturaleza: "GASTO" },
  patronalReservaLab: { cuenta: "610605", nombre: "Aporte Patronal Reserva Laboral (RAP)", naturaleza: "GASTO" },
  gasto13vo:          { cuenta: "610901", nombre: "Provisión Décimo Tercer Mes (Aguinaldo)", naturaleza: "GASTO" },
  gasto14vo:          { cuenta: "610902", nombre: "Provisión Décimo Cuarto Mes", naturaleza: "GASTO" },
  gastoVacaciones:    { cuenta: "610903", nombre: "Provisión Vacaciones", naturaleza: "GASTO" },
  descuentoAusencias: { cuenta: "610205", nombre: "Descuentos por Ausencia (otros ingresos)", naturaleza: "GASTO" },

  ihssPorPagar:       { cuenta: "210301", nombre: "IHSS-EM por Pagar", naturaleza: "PASIVO" },
  ivmPorPagar:        { cuenta: "210302", nombre: "IHSS-IVM por Pagar", naturaleza: "PASIVO" },
  rapPorPagar:        { cuenta: "210303", nombre: "RAP por Pagar", naturaleza: "PASIVO" },
  infopPorPagar:      { cuenta: "210304", nombre: "INFOP por Pagar", naturaleza: "PASIVO" },
  reservaLabPorPagar: { cuenta: "210305", nombre: "Reserva Laboral RAP por Pagar", naturaleza: "PASIVO" },
  afpPorPagar:        { cuenta: "210306", nombre: "AFP por Pagar", naturaleza: "PASIVO" },
  isrPorPagar:        { cuenta: "210307", nombre: "ISR Retenido por Pagar", naturaleza: "PASIVO" },
  impVecinalPorPagar: { cuenta: "210308", nombre: "Impuesto Vecinal por Pagar", naturaleza: "PASIVO" },
  cooperativaPorPagar:{ cuenta: "210309", nombre: "Cooperativa por Pagar", naturaleza: "PASIVO" },
  otrasDeducciones:   { cuenta: "210310", nombre: "Otras Deducciones por Pagar", naturaleza: "PASIVO" },
  prestamosEmpleados: { cuenta: "111401", nombre: "Préstamos a Empleados (recuperación)", naturaleza: "PASIVO" },
  adelantosEmpleados: { cuenta: "111402", nombre: "Adelantos a Empleados (recuperación)", naturaleza: "PASIVO" },
  provision13Pagar:   { cuenta: "210601", nombre: "Décimo Tercer Mes por Pagar", naturaleza: "PASIVO" },
  provision14Pagar:   { cuenta: "210602", nombre: "Décimo Cuarto Mes por Pagar", naturaleza: "PASIVO" },
  provisionVacPagar:  { cuenta: "210603", nombre: "Provisión Vacaciones por Pagar", naturaleza: "PASIVO" },
  sueldosPorPagar:    { cuenta: "2111", nombre: "Sueldos por Pagar (Neto)", naturaleza: "PASIVO" },
} as const;

/** Concepto del asiento. No cambia aunque el contador remapee códigos. */
export type ClaveCuenta = keyof typeof CUENTAS;

/** Naturaleza contable: decide si el importe se reparte por centro de costo. */
export type NaturalezaCuenta = "GASTO" | "PASIVO";

/**
 * Plan de cuentas del contador: sustituye código y nombre de los conceptos que
 * haya remapeado. Lo que no aparezca aquí usa el valor por omisión de `CUENTAS`.
 */
export type PlanCuentas = Partial<Record<ClaveCuenta, { cuenta: string; nombre: string }>>;

/** Conceptos que son GASTO y por tanto se distribuyen por centro de costo. */
export const CLAVES_GASTO: ReadonlySet<ClaveCuenta> = new Set(
  (Object.keys(CUENTAS) as ClaveCuenta[]).filter((k) => CUENTAS[k].naturaleza === "GASTO")
);

export function generarPartidaContable(
  detalles: DetalleParaPartida[],
  opts: { incluirProvisiones?: boolean; plan?: PlanCuentas } = {}
): PartidaContable {
  const incluirProvisiones = opts.incluirProvisiones ?? true;
  /** Lo guardado por el contador manda; lo que falte cae al plan por omisión. */
  const cuentaDe = (clave: ClaveCuenta) => opts.plan?.[clave] ?? CUENTAS[clave];

  // Suma exacta: los detalles ya vienen redondeados a 2 decimales desde la BD,
  // así que acumularlos en Decimal no introduce ningún error que redondear.
  const sum = (f: (d: DetalleParaPartida) => MoneyInput) => sumarPor(detalles, f);

  const salarioBase       = sum((d) => d.salarioBase);
  const montoHorasExtra   = sum((d) => d.montoHorasExtra);
  const bonificaciones    = sum((d) => d.bonificaciones);
  const otrosIngresos     = sum((d) => d.otrosIngresos);
  const ihssEmpleado      = sum((d) => d.ihssEmpleado);
  const rapEmpleado       = sum((d) => d.rapEmpleado);
  const afpEmpleado       = sum((d) => d.afpEmpleado);
  const isr               = sum((d) => d.isr);
  const impuestoVecinal   = sum((d) => d.impuestoVecinal);
  const cooperativa       = sum((d) => d.cooperativa);
  const prestamos         = sum((d) => d.prestamos);
  const adelantos         = sum((d) => d.adelantos);
  // La incapacidad no pagada es, contablemente, lo mismo que una ausencia:
  // salario devengado en el gasto que no se paga. Misma cuenta.
  const ausencias         = sum((d) => d.ausencias).plus(sum((d) => d.incapacidad ?? 0));
  const otrosDeducciones  = sum((d) => d.otrosDeducciones);
  const ihssEmpleador     = sum((d) => d.ihssEmpleador);
  const rapEmpleador      = sum((d) => d.rapEmpleador);
  const infop             = sum((d) => d.infop);
  const reservaLaboral    = sum((d) => d.reservaLaboral);
  const ivmEmpleado       = sum((d) => d.ivmEmpleado);
  const ivmEmpleador      = sum((d) => d.ivmEmpleador);
  // Régimen EM = total IHSS menos la porción IVM
  const emEmpleado        = ihssEmpleado.minus(ivmEmpleado);
  const emEmpleador       = ihssEmpleador.minus(ivmEmpleador);
  const salarioNeto       = sum((d) => d.salarioNeto);
  const provision13vo     = sum((d) => d.provision13vo);
  const provision14vo     = sum((d) => d.provision14vo);
  const provisionVac      = sum((d) => d.provisionVacaciones);

  const lineas: LineaPartida[] = [];
  const anomalias: string[] = [];

  /**
   * Coloca un importe en su lado del asiento.
   *
   * Un importe en cero simplemente no genera línea. Uno NEGATIVO sí la genera,
   * en el lado contrario y por su valor absoluto: contablemente un cargo
   * negativo ES un abono, así que el asiento sigue cuadrando, y además queda
   * anotado como anomalía. Antes se descartaba con un `if (monto > 0)`, lo que
   * descuadraba el asiento sin dejar rastro.
   */
  const registrar = (clave: ClaveCuenta, monto: Money, lado: "debe" | "haber") => {
    if (esCero(monto)) return;
    const c = cuentaDe(clave);

    let ladoFinal = lado;
    let importe = monto;

    if (monto.isNegative()) {
      ladoFinal = lado === "debe" ? "haber" : "debe";
      importe = monto.negated();
      anomalias.push(
        `${c.cuenta} ${c.nombre}: importe negativo (${monto.toFixed(2)}); ` +
        `se registró en el ${ladoFinal.toUpperCase()} por ${importe.toFixed(2)}`
      );
    }

    lineas.push({
      clave,
      cuenta: c.cuenta,
      nombre: c.nombre,
      debe: ladoFinal === "debe" ? importe : CERO,
      haber: ladoFinal === "haber" ? importe : CERO,
    });
  };

  const debe = (clave: ClaveCuenta, monto: Money) => registrar(clave, monto, "debe");
  const haber = (clave: ClaveCuenta, monto: Money) => registrar(clave, monto, "haber");

  // ── DEBE: gastos ──────────────────────────────────────────────────────────
  debe("sueldos", salarioBase);
  debe("horasExtra", montoHorasExtra);
  debe("bonificaciones", bonificaciones);
  debe("otrosIngresos", otrosIngresos);
  debe("patronalIhss", emEmpleador);
  debe("patronalIvm", ivmEmpleador);
  debe("patronalRap", rapEmpleador);
  debe("patronalInfop", infop);
  debe("patronalReservaLab", reservaLaboral);
  if (incluirProvisiones) {
    debe("gasto13vo", provision13vo);
    debe("gasto14vo", provision14vo);
    debe("gastoVacaciones", provisionVac);
  }

  // ── HABER: pasivos / por pagar ───────────────────────────────────────────
  haber("ihssPorPagar", emEmpleado.plus(emEmpleador));
  haber("ivmPorPagar", ivmEmpleado.plus(ivmEmpleador));
  haber("rapPorPagar", rapEmpleado.plus(rapEmpleador));
  haber("infopPorPagar", infop);
  haber("reservaLabPorPagar", reservaLaboral);
  haber("afpPorPagar", afpEmpleado);
  haber("isrPorPagar", isr);
  haber("impVecinalPorPagar", impuestoVecinal);
  haber("cooperativaPorPagar", cooperativa);
  haber("prestamosEmpleados", prestamos);
  haber("adelantosEmpleados", adelantos);
  haber("otrasDeducciones", otrosDeducciones);
  haber("descuentoAusencias", ausencias);
  if (incluirProvisiones) {
    haber("provision13Pagar", provision13vo);
    haber("provision14Pagar", provision14vo);
    haber("provisionVacPagar", provisionVac);
  }
  haber("sueldosPorPagar", salarioNeto);

  const totalDebe = sumarPor(lineas, (l) => l.debe);
  const totalHaber = sumarPor(lineas, (l) => l.haber);
  const diferencia = totalDebe.minus(totalHaber);

  return {
    lineas,
    totalDebe,
    totalHaber,
    // Exacto, sin tolerancia. La antigua `< 0.01` toleraba justo el error de
    // centavo que introducía el punto flotante: daba por cuadrado un asiento
    // que no lo estaba, que es la única forma de que el defecto pasara años
    // sin detectarse.
    cuadra: diferencia.isZero(),
    diferencia,
    anomalias,
  };
}

// ─── DISTRIBUCIÓN POR CENTRO DE COSTO ────────────────────────────────────────

/**
 * El centro de costo es la SEGUNDA DIMENSIÓN del asiento, no una cuenta más.
 *
 * La cuenta dice QUÉ es el gasto (5101 Sueldos); el centro de costo dice DÓNDE
 * se imputa (Producción, Administración). El asiento deja de ser una lista de
 * cuentas y pasa a ser una matriz cuenta × centro.
 *
 * SÓLO SE DISTRIBUYE EL DEBE, y esto es contabilidad, no una simplificación:
 * las cuentas del Haber —IHSS por pagar, ISR retenido, neto por pagar— son
 * PASIVOS de la empresa frente a terceros. Reflejan lo que se le debe al IHSS o
 * al trabajador, no el consumo de un área. Repartirlas por centro de costo
 * sugeriría que Producción le debe algo al IHSS por separado, que no es cierto:
 * la obligación es de la empresa, y es una sola.
 *
 * El resultado se acompaña de la conciliación con el asiento consolidado, para
 * que el contador no tenga que fiarse: si la suma de los centros no cuadra con
 * el total, se ve.
 */
export interface GrupoCentroCosto {
  /** Detalles imputados a este centro. */
  detalles: DetalleParaPartida[];
  centroCostoId: string | null;
  codigo: string;
  nombre: string;
  /** Cuenta de gasto propia del centro, si la contabilidad la definió. */
  cuentaGasto?: string | null;
}

export interface LineaCentroCosto extends LineaPartida {
  centroCostoId: string | null;
  centroCodigo: string;
  centroNombre: string;
}

export interface PartidaPorCentroCosto {
  /** Gasto (Debe) desglosado por centro de costo. */
  gastoPorCentro: LineaCentroCosto[];
  /** Pasivos y retenciones, a nivel de empresa. No se reparten. */
  pasivos: LineaPartida[];
  /** Totales por centro, para el resumen de arriba. */
  totalesPorCentro: Array<{
    centroCostoId: string | null;
    codigo: string;
    nombre: string;
    empleados: number;
    gasto: Money;
  }>;
  totalGasto: Money;
  totalPasivos: Money;
  /**
   * ¿La suma de los centros reproduce EXACTAMENTE el asiento consolidado?
   *
   * Se compara el NETO por cuenta (debe − haber) y no sólo el debe: un centro
   * con un importe negativo genera su línea en el lado contrario, y comparar
   * sólo el debe daría una descuadre falso.
   */
  conciliado: boolean;
  diferenciaConciliacion: Money;
  anomalias: string[];
}

/**
 * Aplica la cuenta propia del centro cuando existe.
 *
 * Sirve para las contabilidades que abren subcuenta por área (5101-01
 * Producción, 5101-02 Administración) en vez de llevar el centro como dimensión
 * separada. Sin `cuentaGasto`, la cuenta del plan general se deja intacta.
 */
function cuentaDelCentro(cuentaBase: string, cuentaGasto?: string | null): string {
  if (!cuentaGasto) return cuentaBase;
  // Un sufijo corto se concatena; una cuenta completa sustituye.
  return cuentaGasto.startsWith("-") ? `${cuentaBase}${cuentaGasto}` : cuentaGasto;
}

export function generarPartidaPorCentroCosto(
  grupos: GrupoCentroCosto[],
  opts: { incluirProvisiones?: boolean; plan?: PlanCuentas } = {}
): PartidaPorCentroCosto {
  // El consolidado es la referencia contra la que se concilia todo lo demás.
  const consolidado = generarPartidaContable(
    grupos.flatMap((g) => g.detalles),
    opts
  );

  const gastoPorCentro: LineaCentroCosto[] = [];
  const totalesPorCentro: PartidaPorCentroCosto["totalesPorCentro"] = [];
  const anomalias = [...consolidado.anomalias];

  for (const grupo of grupos) {
    if (grupo.detalles.length === 0) continue;
    const parcial = generarPartidaContable(grupo.detalles, opts);

    // Del asiento parcial sólo interesa el gasto: los pasivos son de la empresa.
    let gastoDelCentro = CERO;

    for (const linea of parcial.lineas) {
      // Una línea del parcial pertenece al gasto si su cuenta es de gasto en el
      // consolidado; se reconoce por estar en el Debe del plan de cuentas.
      const esGasto = CLAVES_GASTO.has(linea.clave);
      if (!esGasto) continue;

      gastoPorCentro.push({
        ...linea,
        cuenta: cuentaDelCentro(linea.cuenta, grupo.cuentaGasto),
        centroCostoId: grupo.centroCostoId,
        centroCodigo: grupo.codigo,
        centroNombre: grupo.nombre,
      });
      gastoDelCentro = gastoDelCentro.plus(linea.debe).minus(linea.haber);
    }

    for (const a of parcial.anomalias) {
      anomalias.push(`[${grupo.codigo}] ${a}`);
    }

    totalesPorCentro.push({
      centroCostoId: grupo.centroCostoId,
      codigo: grupo.codigo,
      nombre: grupo.nombre,
      empleados: grupo.detalles.length,
      gasto: gastoDelCentro,
    });
  }

  const pasivos = consolidado.lineas.filter((l) => !CLAVES_GASTO.has(l.clave));

  const totalGasto = sumarPor(totalesPorCentro, (t) => t.gasto);
  const totalPasivos = sumarPor(pasivos, (l) => l.haber).minus(sumarPor(pasivos, (l) => l.debe));

  // Conciliación: el neto de gasto repartido debe reproducir el neto de gasto
  // del consolidado, al céntimo.
  const gastoConsolidado = consolidado.lineas
    .filter((l) => CLAVES_GASTO.has(l.clave))
    .reduce<Money>((acc, l) => acc.plus(l.debe).minus(l.haber), CERO);
  const diferenciaConciliacion = totalGasto.minus(gastoConsolidado);

  return {
    gastoPorCentro,
    pasivos,
    totalesPorCentro,
    totalGasto,
    totalPasivos,
    conciliado: diferenciaConciliacion.isZero(),
    diferenciaConciliacion,
    anomalias,
  };
}

