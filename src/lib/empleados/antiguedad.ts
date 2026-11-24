/**
 * Antigüedad del empleado en las planillas. Puro.
 *
 * Pedido de Edbin (2026-11-23): en la planilla, dentro de cada departamento, primero
 * quien tiene más antigüedad. A igual fecha de ingreso, por nombre; sin fecha, al final.
 */

import { calcularAniosTrabajados } from "@/lib/utils";

export interface ConAntiguedad {
  fechaIngreso?: Date | string | null;
  nombre: string;
}

export function compararPorAntiguedad(a: ConAntiguedad, b: ConAntiguedad): number {
  const fa = a.fechaIngreso ? new Date(a.fechaIngreso).getTime() : Number.POSITIVE_INFINITY;
  const fb = b.fechaIngreso ? new Date(b.fechaIngreso).getTime() : Number.POSITIVE_INFINITY;
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
}

/** «11 años», «1 año» o «menos de un año», contados hasta `hasta` (el cierre del período). */
export function textoAntiguedad(fechaIngreso: Date | string, hasta: Date): string {
  const anios = calcularAniosTrabajados(fechaIngreso, hasta);
  return anios === 0 ? "menos de un año" : anios === 1 ? "1 año" : `${anios} años`;
}
