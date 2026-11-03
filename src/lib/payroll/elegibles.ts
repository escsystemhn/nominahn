/**
 * Quién entra en una planilla.
 *
 * Vacaciones y Permiso siguen cobrando: la relación laboral sigue y el salario se
 * debe. Antes la planilla sólo tomaba ACTIVO y quien estaba de vacaciones se
 * quedaba sin pago, sin ningún aviso. Suspendido no cobra (decisión de negocio).
 *
 * Inactivo cobra hasta su fecha de salida: entra si esa fecha cae en el período o
 * después, y `diasConDerechoASalario` le prorratea los días.
 */

import type { Prisma } from "@prisma/client";

export const ESTADOS_QUE_COBRAN = ["ACTIVO", "VACACIONES", "PERMISO"] as const;

export function filtroCobraEnPeriodo(desde: Date): Prisma.EmpleadoWhereInput {
  return {
    OR: [
      { estado: { in: [...ESTADOS_QUE_COBRAN] } },
      { estado: "INACTIVO", fechaSalida: { gte: desde } },
    ],
  };
}
