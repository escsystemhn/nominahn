/**
 * Préstamos y anticipos solicitados por el empleado. PURO.
 *
 * El monto y la cuota son libres: Recursos Humanos analiza cada solicitud antes de
 * aprobarla (decisión del cliente, 2026-11-21). Antes se marcaba la que pasaba de la
 * cuarta parte del excedente sobre el salario mínimo (Arts. 371 y 372) y aprobarla
 * exigía confirmarlo; ya no.
 *
 * Queda una regla de plazo, no de monto: un ANTICIPO de salario se descuenta en al
 * menos cinco períodos de pago (Art. 372 del Código del Trabajo).
 */

export type TipoSolicitud = "PRESTAMO" | "ADELANTO";

export const CUOTAS_MINIMAS_ADELANTO = 5;
export const CUOTAS_MAXIMAS = 60;

/** Cuota por período, redondeada hacia arriba al centavo: la última se ajusta sola al saldo. */
export function cuotaPorPeriodo(monto: number, cuotas: number): number {
  if (!(monto > 0) || !(cuotas >= 1)) return 0;
  return Math.ceil((monto / cuotas) * 100) / 100;
}

export interface EvaluacionSolicitud {
  errores: string[];
  cuotaPeriodo: number;
}

export function evaluarSolicitud(o: { tipo: TipoSolicitud; monto: number; cuotas: number }): EvaluacionSolicitud {
  const errores: string[] = [];
  if (!(o.monto > 0)) errores.push("El monto debe ser mayor que cero.");
  if (!Number.isInteger(o.cuotas) || o.cuotas < 1) errores.push("Indique en cuántas cuotas se descuenta.");
  if (o.cuotas > CUOTAS_MAXIMAS) errores.push(`El plazo máximo es de ${CUOTAS_MAXIMAS} cuotas.`);
  if (o.tipo === "ADELANTO" && o.cuotas < CUOTAS_MINIMAS_ADELANTO) {
    errores.push(`Un anticipo de salario se descuenta en al menos ${CUOTAS_MINIMAS_ADELANTO} períodos de pago (Art. 372 del Código del Trabajo).`);
  }
  return { errores, cuotaPeriodo: cuotaPorPeriodo(o.monto, o.cuotas) };
}
