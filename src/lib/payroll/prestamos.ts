/**
 * Préstamos y anticipos solicitados por el empleado. PURO.
 *
 * Reglas del Código del Trabajo, en la lectura que aplica esta aplicación (el
 * asesor laboral de cada empresa debe confirmarla):
 *
 *   · Art. 371: el salario mínimo no es embargable; del excedente sólo es
 *     embargable una cuarta parte.
 *   · Art. 372: los anticipos no devengan intereses y se amortizan en un mínimo
 *     de cinco períodos de pago; las demás deudas con el patrono sólo pueden
 *     descontarse en la proporción en que el salario es embargable.
 *
 * Por eso: un ANTICIPO exige al menos 5 cuotas; un PRÉSTAMO no debe llevar la
 * suma de cuotas por encima del 25 % del excedente sobre el salario mínimo. Si
 * lo hace, la solicitud se registra marcada y la aprobación exige confirmarlo
 * de forma expresa.
 */

export type TipoSolicitud = "PRESTAMO" | "ADELANTO";
export type TipoPlanilla = "MENSUAL" | "QUINCENAL" | "SEMANAL";

export const CUOTAS_MINIMAS_ADELANTO = 5;
export const CUOTAS_MAXIMAS = 60;
export const PROPORCION_EMBARGABLE = 0.25;

export function periodosPorMes(tipo: TipoPlanilla): number {
  return tipo === "QUINCENAL" ? 2 : tipo === "SEMANAL" ? 52 / 12 : 1;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Cuota por período, redondeada hacia arriba al centavo: la última se ajusta sola al saldo. */
export function cuotaPorPeriodo(monto: number, cuotas: number): number {
  if (!(monto > 0) || !(cuotas >= 1)) return 0;
  return Math.ceil((monto / cuotas) * 100) / 100;
}

export interface LimiteDescuento {
  /** Parte embargable del salario en el mes (Art. 371). */
  embargableMensual: number;
  /** La misma, llevada al período de pago del empleado. */
  embargablePeriodo: number;
  /** Cuotas de préstamos y anticipos que ya se le descuentan por período. */
  comprometidoPeriodo: number;
  /** Lo que queda disponible por período para una nueva cuota. */
  disponiblePeriodo: number;
}

export function limiteDescuento(o: {
  salarioMensual: number;
  salarioMinimo: number;
  tipoPlanilla: TipoPlanilla;
  cuotasVigentesPeriodo: number;
}): LimiteDescuento {
  const embargableMensual = centavos(Math.max(0, o.salarioMensual - o.salarioMinimo) * PROPORCION_EMBARGABLE);
  const embargablePeriodo = centavos(embargableMensual / periodosPorMes(o.tipoPlanilla));
  const comprometidoPeriodo = centavos(o.cuotasVigentesPeriodo);
  return {
    embargableMensual,
    embargablePeriodo,
    comprometidoPeriodo,
    disponiblePeriodo: centavos(Math.max(0, embargablePeriodo - comprometidoPeriodo)),
  };
}

export interface EvaluacionSolicitud {
  errores: string[];
  cuotaPeriodo: number;
  /** El préstamo pasa de la parte embargable: se registra marcado. */
  excedeLimite: boolean;
  aviso: string | null;
}

export function evaluarSolicitud(o: {
  tipo: TipoSolicitud;
  monto: number;
  cuotas: number;
  limite: LimiteDescuento | null;
}): EvaluacionSolicitud {
  const errores: string[] = [];
  if (!(o.monto > 0)) errores.push("El monto debe ser mayor que cero.");
  if (!Number.isInteger(o.cuotas) || o.cuotas < 1) errores.push("Indique en cuántas cuotas se descuenta.");
  if (o.cuotas > CUOTAS_MAXIMAS) errores.push(`El plazo máximo es de ${CUOTAS_MAXIMAS} cuotas.`);
  if (o.tipo === "ADELANTO" && o.cuotas < CUOTAS_MINIMAS_ADELANTO) {
    errores.push(`Un anticipo de salario se descuenta en al menos ${CUOTAS_MINIMAS_ADELANTO} períodos de pago (Art. 372 del Código del Trabajo).`);
  }
  const cuotaPeriodo = cuotaPorPeriodo(o.monto, o.cuotas);

  let excedeLimite = false;
  let aviso: string | null = null;
  if (o.tipo === "PRESTAMO" && errores.length === 0) {
    if (!o.limite) {
      aviso = "No hay salario mínimo configurado: no se pudo comprobar el límite de descuento.";
    } else if (cuotaPeriodo > o.limite.disponiblePeriodo + 0.004) {
      excedeLimite = true;
      aviso =
        `La cuota de este préstamo pasa de lo que se puede descontar del salario: quedan disponibles ` +
        `${o.limite.disponiblePeriodo.toFixed(2)} por período (25 % del excedente sobre el salario mínimo, Arts. 371 y 372).`;
    }
  }
  return { errores, cuotaPeriodo, excedeLimite, aviso };
}
