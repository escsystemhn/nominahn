/**
 * Aplicación y amortización de deducciones a plazo (préstamos, adelantos y
 * cualquier otra con cuotas o saldo definido).
 *
 * PRINCIPIO: una deducción a plazo se cobra un número finito de veces. Cada cobro
 * consume una cuota y reduce el saldo; al agotarse cualquiera de los dos, la
 * deducción se desactiva. Sin esto el descuento se repite indefinidamente sobre
 * el salario del trabajador (Art. 371 C.T.: toda deducción requiere causa vigente).
 *
 * Es lógica pura (sin Prisma ni red) para poder probarse de forma aislada; la
 * capa de datos aplica el resultado dentro de la transacción de la planilla.
 */

import { money, minimo, maximo, redondear, sumar, CERO, type Money, type MoneyInput } from "./money";

/**
 * Código del tipo de deducción «Retención de ISR fija por período» (tipo IMPUESTO).
 * Quien la tiene asignada retiene ese monto como ISR del período en lugar del
 * cálculo (estándar o personalizado): sirve para respetar la retención que el
 * contador ya proyectó para el año. No es una deducción más: va en la columna ISR.
 */
export const CODIGO_ISR_FIJO = "ISR-FIJO";

// ─── MONTOS DEL PERÍODO ──────────────────────────────────────────────────────

/**
 * Así empieza la observación de un «monto del período»: lo que se descuenta de un
 * tipo sólo en un período (la cooperativa o el préstamo de banco que cambia cada
 * quincena). Se importa desde el archivo de deducciones por empleado.
 *
 * Es una deducción sin saldo ni cuotas con `fechaFin`: vale sólo entre sus dos
 * fechas. La marca va en la observación porque una deducción de cada planilla con
 * fecha final también existe (importación por filas) y esa no reemplaza a nadie.
 */
export const MARCA_MONTO_PERIODO = "Monto del período";

export function esMontoDelPeriodo(d: { observacion: string | null; fechaFin: Date | string | null }): boolean {
  return d.fechaFin !== null && (d.observacion ?? "").startsWith(MARCA_MONTO_PERIODO);
}

/** Se cobra en cada planilla, sin saldo ni plazo (cuota sindical, seguro, cooperativa fija). */
export function esCadaPlanilla(d: { saldo: unknown; cuotasMeses: number | null }): boolean {
  return d.saldo === null && d.cuotasMeses === null;
}

/**
 * En un período con monto del período de un tipo, las deducciones de CADA PLANILLA de
 * ese mismo tipo no se cobran: el monto importado las reemplaza sólo en ese período, y
 * en el siguiente vuelven solas. Las de saldo o cuotas (préstamos) siguen su curso: no
 * cobrarlas alargaría la deuda sin que nadie lo decidiera.
 */
export function conMontosDelPeriodo<T extends {
  tipoDeduccionId: string;
  observacion: string | null;
  fechaFin: Date | string | null;
  saldo: unknown;
  cuotasMeses: number | null;
}>(deducciones: readonly T[]): T[] {
  const reemplazados = new Set(deducciones.filter(esMontoDelPeriodo).map((d) => d.tipoDeduccionId));
  if (reemplazados.size === 0) return [...deducciones];
  return deducciones.filter((d) => esMontoDelPeriodo(d) || !(reemplazados.has(d.tipoDeduccionId) && esCadaPlanilla(d)));
}

/** Una deducción ya filtrada por vigencia de fechas por la capa de datos. */
export interface DeduccionVigente {
  id: string;
  /**
   * La cuota acordada, o el TOTAL a repartir cuando iguala al saldo inicial: un
   * préstamo de Mi espacio guarda la cuota, una deducción por pantalla o plantilla
   * guarda el total. Ver `cuotaDelPeriodo`.
   */
  monto: MoneyInput;
  /** Saldo pendiente; `null` en deducciones recurrentes sin monto total. */
  saldo: MoneyInput | null;
  /** Plazo en cuotas; `null` en deducciones indefinidas. */
  cuotasMeses: number | null;
  cuotasPagadas: number;
  /** `TipoDeduccion` de Prisma. */
  tipo: string;
}

/** Instrucción de actualización para una deducción efectivamente cobrada. */
export interface Amortizacion {
  id: string;
  cuotasPagadas: number;
  /** `null` = la deducción no lleva saldo; no debe tocarse la columna. */
  saldo: Money | null;
  desactivar: boolean;
  /**
   * Importe efectivamente cobrado en este período.
   *
   * Es el DELTA que hay que devolver si la planilla se anula. Se expone aquí
   * —y no se reconstruye después restando saldos— porque la última cuota se
   * acota al saldo pendiente y entonces no coincide con `monto`.
   */
  montoAplicado: Money;
}

export interface ResultadoDeducciones {
  prestamos: Money;
  adelantos: Money;
  cooperativa: Money;
  /**
   * Aporte a la Administradora de Fondos de Pensiones.
   *
   * NO se suma a `total`: la AFP tiene columna propia en PlanillaDetalle y, a
   * diferencia del resto, es DEDUCIBLE de la base del ISR. Mezclarla con las
   * demás deducciones la haría tributar.
   *
   * Es voluntaria e individual, de modo que se resuelve aquí, empleado por
   * empleado. Antes se aplicaba un porcentaje global buscado por
   * `codigo: "AFP"` —código que no existe en la configuración, donde la fila
   * real es "AFP-ATL"— así que la deducción valía cero para todo el mundo.
   */
  afp: Money;
  otros: Money;
  /** Suma de las cuatro categorías no-AFP: lo que entra al motor como `otrosDeducciones`. */
  total: Money;
  amortizaciones: Amortizacion[];
  /** Cuotas que no se cobraron completas: no alcanzó lo disponible (el neto quedaría negativo). */
  recortadas: CuotaRecortada[];
  /**
   * Cada deducción que tocaba cobrar, también las que no llevan plazo ni saldo y las que
   * el tope dejó en cero: el detalle por tipo de la línea y sus avisos.
   */
  cobradas: CobroDeDeduccion[];
}

/** Lo que pasó con una deducción en el período. */
export interface CobroDeDeduccion {
  id: string;
  /** Lo cobrado (puede ser cero si no alcanzó). */
  monto: Money;
  /** Lo que tocaba cobrar: la cuota del período. */
  cuota: Money;
  /** Hasta dónde llegaban los topes de los Arts. 371 y 372: si es menor que `monto`, se avisa. */
  tope: Money;
}

/**
 * Una deducción está liquidada cuando agotó su saldo o, si no lleva saldo, cuando
 * completó su plazo. Con saldo manda el saldo: una cuota que el tope del Art. 372
 * recortó deja deuda pendiente aunque ya se hayan contado todas las cuotas.
 */
export function estaLiquidada(d: Pick<DeduccionVigente, "saldo" | "cuotasMeses" | "cuotasPagadas">): boolean {
  if (d.saldo !== null) return money(d.saldo).lessThanOrEqualTo(0);
  return d.cuotasMeses !== null && d.cuotasPagadas >= d.cuotasMeses;
}

/**
 * Importe a cobrar en este período: la cuota, acotada al saldo pendiente.
 *
 * El acotamiento evita el sobrecobro de la última cuota: un préstamo de L 1,000
 * en 3 cuotas de L 400 cobraría L 1,200 sin él.
 *
 * Con varias cuotas por delante, el monto es el TOTAL si iguala al saldo antes del
 * primer cobro o lo supera después, y se reparte entre las que faltan. Sin esto,
 * 6,000 en 6 cuotas se cobraban completos en la primera planilla. Una cuota acordada
 * que ya cobró y queda igual al saldo no es un total: cierra la deuda. Se reparte
 * sobre lo que falta para que el redondeo de los centavos no se acumule.
 */
export function cuotaDelPeriodo(d: Pick<DeduccionVigente, "monto" | "saldo" | "cuotasMeses" | "cuotasPagadas">): Money {
  if (estaLiquidada(d)) return CERO;
  const monto = money(d.monto);
  if (monto.lessThanOrEqualTo(0)) return CERO;
  if (d.saldo === null) return monto;
  const saldo = money(d.saldo);
  const restantes = d.cuotasMeses === null ? 1 : Math.max(1, d.cuotasMeses - d.cuotasPagadas);
  const esElTotal = d.cuotasPagadas === 0 ? monto.equals(saldo) : monto.greaterThan(saldo);
  if (restantes > 1 && esElTotal) return redondear(saldo.div(restantes));
  return minimo(monto, saldo);
}

/**
 * Topes del período para las deducciones que no son de ley (Código del Trabajo).
 * Sólo `disponible` corta; los otros dos se calculan para AVISAR en el borrador: el
 * cliente decidió (2026-11-21) cobrar lo que asigna aunque pase la cuarta parte.
 *
 *  · `disponible`: lo que queda del salario tras IHSS, RAP, ISR, vecinal, AFP,
 *    ausencias e incapacidad. Ninguna deducción lo pasa: el neto nunca es negativo.
 *  · `embargable`: la cuarta parte de lo que excede al salario mínimo del período
 *    (Art. 371). Lo comparten los embargos ordinarios y las deudas con el patrono,
 *    que «sólo pueden amortizarse en la proporción en que sean embargables»
 *    (Art. 372).
 *  · `alimentos`: hasta el 50 % del salario, incluso del mínimo (Art. 371, 1.º).
 *
 * Los anticipos por cuenta de salario (ADELANTO) y las cuotas de cooperativa
 * (Art. 373) no entran en la cuarta parte, sólo en lo disponible.
 */
export interface TopesDeducciones {
  disponible: MoneyInput;
  embargable: MoneyInput;
  alimentos: MoneyInput;
}

/** Orden de cobro: primero lo judicial, luego las deudas con el patrono, al final lo voluntario. */
const PRIORIDAD: Record<string, number> = {
  PENSION_ALIMENTICIA: 1,
  EMBARGO: 2,
  PRESTAMO: 3,
  ADELANTO: 4,
  COOPERATIVA: 5,
};

/** Una cuota que el tope dejó corta: la diferencia queda en el saldo. */
export interface CuotaRecortada {
  id: string;
  tipo: string;
  cuota: Money;
  aplicado: Money;
}

/**
 * Reparte las deducciones vigentes por categoría y produce las instrucciones de
 * amortización correspondientes. Cada cuota se cobra completa mientras el neto no
 * quede negativo; lo que pase de los topes de ley queda en `cobradas[].tope` para avisar.
 *
 * Sólo amortizan las deducciones con plazo o saldo definido. Una recurrente
 * indefinida (cuota sindical, seguro voluntario) se cobra cada período y no
 * lleva contador.
 *
 * Con `topes`, cada cuota se cobra en orden de prioridad hasta donde alcance lo
 * disponible (ver `TopesDeducciones`). Lo que no se cobra de un préstamo sigue en el
 * saldo y se cobra en los períodos siguientes. La AFP no lleva tope: es un aporte de pensión que ya
 * está restado de lo disponible.
 */
export function aplicarDeducciones(deducciones: DeduccionVigente[], topes?: TopesDeducciones): ResultadoDeducciones {
  let prestamos = CERO, adelantos = CERO, cooperativa = CERO, afp = CERO, otros = CERO;
  const amortizaciones: Amortizacion[] = [];
  const cobradas: CobroDeDeduccion[] = [];
  const recortadas: CuotaRecortada[] = [];

  let disponible = topes ? maximo(money(topes.disponible), 0) : null;
  let embargable = topes ? maximo(money(topes.embargable), 0) : null;
  let alimentos = topes ? maximo(money(topes.alimentos), 0) : null;

  const ordenadas = deducciones
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (PRIORIDAD[a.d.tipo] ?? 6) - (PRIORIDAD[b.d.tipo] ?? 6) || a.i - b.i)
    .map((x) => x.d);

  for (const d of ordenadas) {
    const cuota = cuotaDelPeriodo(d);
    if (cuota.lessThanOrEqualTo(0)) continue;

    let aplicado = cuota;
    let tope = cuota;
    if (disponible !== null && d.tipo !== "AFP") {
      // Sólo se corta para que el neto no quede negativo (decisión del cliente, 2026-11-21).
      aplicado = maximo(redondear(minimo(cuota, disponible)), 0);
      // Los topes de ley no cortan: se calculan para avisar en el borrador.
      tope = aplicado;
      if (d.tipo === "PENSION_ALIMENTICIA") tope = minimo(tope, alimentos!);
      if (d.tipo === "EMBARGO" || d.tipo === "PRESTAMO") tope = minimo(tope, embargable!);
      tope = maximo(redondear(tope), 0);
      disponible = disponible.minus(aplicado);
      if (d.tipo === "PENSION_ALIMENTICIA") alimentos = maximo(alimentos!.minus(aplicado), 0);
      if (d.tipo === "EMBARGO" || d.tipo === "PRESTAMO") embargable = maximo(embargable!.minus(aplicado), 0);
      if (aplicado.lessThan(cuota)) recortadas.push({ id: d.id, tipo: d.tipo, cuota, aplicado });
    }
    cobradas.push({ id: d.id, monto: aplicado, cuota, tope });
    if (aplicado.lessThanOrEqualTo(0)) continue;

    if (d.tipo === "PRESTAMO") prestamos = prestamos.plus(aplicado);
    else if (d.tipo === "ADELANTO") adelantos = adelantos.plus(aplicado);
    else if (d.tipo === "COOPERATIVA") cooperativa = cooperativa.plus(aplicado);
    else if (d.tipo === "AFP") afp = afp.plus(aplicado);
    else otros = otros.plus(aplicado);

    const esAPlazo = d.cuotasMeses !== null || d.saldo !== null;
    if (!esAPlazo) continue;

    const nuevoSaldo = d.saldo === null ? null : money(d.saldo).minus(aplicado);
    const nuevasCuotas = d.cuotasPagadas + 1;
    amortizaciones.push({
      id: d.id,
      cuotasPagadas: nuevasCuotas,
      saldo: nuevoSaldo,
      // Con saldo, se cierra cuando se agota; sin saldo, al completar el plazo.
      desactivar: nuevoSaldo !== null
        ? nuevoSaldo.lessThanOrEqualTo(0)
        : d.cuotasMeses !== null && nuevasCuotas >= d.cuotasMeses,
      montoAplicado: aplicado,
    });
  }

  return {
    prestamos,
    adelantos,
    cooperativa,
    afp,
    otros,
    // La AFP queda FUERA del total a propósito: viaja por su propia columna
    // porque se resta de la base del ISR antes de aplicar la tabla.
    total: sumar(prestamos, adelantos, cooperativa, otros),
    amortizaciones,
    cobradas,
    recortadas,
  };
}

/**
 * Topes del período a partir de lo que queda tras las deducciones de ley.
 * `salarioMinimoPeriodo` es el mínimo mensual llevado al período; sin él rige el
 * piso literal del Art. 371 (los primeros L 100 del mes, también al período).
 */
export function topesDelPeriodo(netoDeLey: MoneyInput, salarioMinimoPeriodo: MoneyInput): TopesDeducciones {
  const neto = maximo(money(netoDeLey), 0);
  const excedente = maximo(neto.minus(salarioMinimoPeriodo), 0);
  return {
    disponible: neto,
    embargable: redondear(excedente.div(4)),
    alimentos: redondear(neto.div(2)),
  };
}

// ─── REVERSIÓN AL ANULAR UNA PLANILLA ────────────────────────────────────────

/**
 * Lo que una planilla cobró de una deducción, tal y como queda registrado en
 * `AmortizacionPlanilla`. Es un DELTA, no un estado previo.
 */
export interface AmortizacionRegistrada {
  deduccionId: string;
  /** Importe efectivamente cobrado por la planilla que se anula. */
  montoAplicado: MoneyInput;
  /** La deducción lleva columna `saldo`. Si es false, revertir no la toca. */
  llevaSaldo: boolean;
  /** Fue ESTA amortización la que agotó la deducción y la desactivó. */
  desactivo: boolean;
}

/** Estado de una deducción a plazo, en lo que respecta a su amortización. */
export interface EstadoDeduccion {
  saldo: Money | null;
  cuotasPagadas: number;
  activo: boolean;
}

/**
 * Deshace una amortización: devuelve el importe al saldo, descuenta la cuota y
 * reactiva la deducción si fue esta amortización la que la cerró.
 *
 * POR QUÉ UN DELTA Y NO EL ESTADO PREVIO: la reversión debe ser independiente
 * del orden. Si dos planillas cobraron cuotas del mismo préstamo y se anula la
 * PRIMERA, devolver su importe deja el saldo correcto aunque la segunda siga
 * vigente. Restaurar un "estado anterior" habría pisado lo que la segunda
 * cobró, y el trabajador habría vuelto a deber lo que ya pagó.
 *
 * `cuotasPagadas` se acota a cero: un contador negativo no significa nada y
 * haría que `estaLiquidada` dejara de cerrar la deducción.
 *
 * ESTA FUNCIÓN Y EL SQL DE `devolverCobros` HACEN LO MISMO. Si cambia una,
 * cambia el otro: aquí se prueba la aritmética; allí se aplica en una sentencia.
 */
export function revertirAmortizacion(
  actual: EstadoDeduccion,
  amortizacion: AmortizacionRegistrada
): EstadoDeduccion {
  const devuelto = money(amortizacion.montoAplicado);

  return {
    saldo: amortizacion.llevaSaldo ? money(actual.saldo ?? 0).plus(devuelto) : actual.saldo,
    cuotasPagadas: Math.max(0, actual.cuotasPagadas - 1),
    activo: amortizacion.desactivo ? true : actual.activo,
  };
}

/** Convierte las instrucciones de amortización en las filas que se guardan para revertirlas. */
export function registrosDeAmortizacion(amortizaciones: Amortizacion[]): AmortizacionRegistrada[] {
  return amortizaciones.map((a) => ({
    deduccionId: a.id,
    montoAplicado: a.montoAplicado,
    llevaSaldo: a.saldo !== null,
    desactivo: a.desactivar,
  }));
}
