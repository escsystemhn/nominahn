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

import { money, minimo, sumar, CERO, type Money, type MoneyInput } from "./money";

/** Una deducción ya filtrada por vigencia de fechas por la capa de datos. */
export interface DeduccionVigente {
  id: string;
  /** Cuota del período. */
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
}

/** Una deducción está liquidada cuando agotó su saldo o completó su plazo. */
export function estaLiquidada(d: DeduccionVigente): boolean {
  const saldo = d.saldo === null ? null : money(d.saldo);
  if (saldo !== null && saldo.lessThanOrEqualTo(0)) return true;
  if (d.cuotasMeses !== null && d.cuotasPagadas >= d.cuotasMeses) return true;
  return false;
}

/**
 * Importe a cobrar en este período: la cuota, acotada al saldo pendiente.
 *
 * El acotamiento evita el sobrecobro de la última cuota: un préstamo de L 1,000
 * en 3 cuotas de L 400 cobraría L 1,200 sin él.
 */
export function cuotaDelPeriodo(d: DeduccionVigente): Money {
  if (estaLiquidada(d)) return CERO;
  const cuota = money(d.monto);
  if (cuota.lessThanOrEqualTo(0)) return CERO;
  return d.saldo === null ? cuota : minimo(cuota, money(d.saldo));
}

/**
 * Reparte las deducciones vigentes por categoría y produce las instrucciones de
 * amortización correspondientes.
 *
 * Sólo amortizan las deducciones con plazo o saldo definido. Una recurrente
 * indefinida (cuota sindical, seguro voluntario) se cobra cada período y no
 * lleva contador.
 */
export function aplicarDeducciones(deducciones: DeduccionVigente[]): ResultadoDeducciones {
  let prestamos = CERO, adelantos = CERO, cooperativa = CERO, afp = CERO, otros = CERO;
  const amortizaciones: Amortizacion[] = [];

  for (const d of deducciones) {
    const aplicado = cuotaDelPeriodo(d);
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
      desactivar:
        (d.cuotasMeses !== null && nuevasCuotas >= d.cuotasMeses) ||
        (nuevoSaldo !== null && nuevoSaldo.lessThanOrEqualTo(0)),
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
 * ESTA FUNCIÓN Y EL SQL DE `/api/planillas/[id]` HACEN LO MISMO. Si cambia una,
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
