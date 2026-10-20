/**
 * Ciclo de vida de las liquidaciones finales y de los décimos.
 *
 * Misma separación de funciones que la planilla (`estado-planilla.ts`): quien
 * calcula no aprueba, RRHH aprueba y Contabilidad registra el pago. Anular algo
 * ya pagado revierte un desembolso ejecutado y queda reservado a un permiso que,
 * por omisión, sólo tiene el super administrador.
 *
 * Puro: sin base de datos, para probarlo.
 */

import { tienePermiso } from "@/lib/auth/permisos";

export type EstadoLiquidacion = "BORRADOR" | "APROBADA" | "PAGADA" | "ANULADA";
export type EstadoDecimo = "CALCULADA" | "PAGADA" | "ANULADA";

export const TRANSICIONES_LIQUIDACION: Record<EstadoLiquidacion, EstadoLiquidacion[]> = {
  BORRADOR: ["APROBADA", "ANULADA"],
  APROBADA: ["PAGADA", "ANULADA"],
  PAGADA: ["ANULADA"],
  ANULADA: [],
};

export const PERMISO_TRANSICION_LIQUIDACION: Record<string, string> = {
  BORRADOR_APROBADA: "prestaciones.aprobar",
  BORRADOR_ANULADA: "prestaciones.generar",
  APROBADA_PAGADA: "prestaciones.pagar",
  APROBADA_ANULADA: "prestaciones.aprobar",
  PAGADA_ANULADA: "prestaciones.anular_pagada",
};

export const TRANSICIONES_DECIMO: Record<EstadoDecimo, EstadoDecimo[]> = {
  CALCULADA: ["PAGADA", "ANULADA"],
  PAGADA: ["ANULADA"],
  ANULADA: [],
};

export const PERMISO_TRANSICION_DECIMO: Record<string, string> = {
  CALCULADA_PAGADA: "prestaciones.pagar",
  CALCULADA_ANULADA: "prestaciones.generar",
  PAGADA_ANULADA: "prestaciones.anular_pagada",
};

/** Anular algo aprobado o pagado exige decir por qué: queda en el rastro. */
const REQUIEREN_MOTIVO = new Set(["APROBADA_ANULADA", "PAGADA_ANULADA"]);

export type Validacion = { ok: true } | { ok: false; status: 403 | 409 | 422; error: string };

function validar(
  actual: string,
  nuevo: string,
  matriz: Record<string, string[]>,
  permisosTransicion: Record<string, string>,
  permisos: readonly string[] | undefined,
  motivo?: string | null
): Validacion {
  if (actual === nuevo) return { ok: false, status: 422, error: `Ya está en estado ${actual}` };
  if (!(matriz[actual] ?? []).includes(nuevo)) {
    return { ok: false, status: 409, error: `No se puede pasar de ${actual} a ${nuevo}` };
  }
  const clave = `${actual}_${nuevo}`;
  const permiso = permisosTransicion[clave];
  if (!permiso || !tienePermiso(permisos ?? [], permiso)) {
    return { ok: false, status: 403, error: `No tiene permiso para pasar de ${actual} a ${nuevo}` };
  }
  if (REQUIEREN_MOTIVO.has(clave) && !motivo?.trim()) {
    return { ok: false, status: 422, error: "Indique el motivo de la anulación" };
  }
  return { ok: true };
}

export function validarTransicionLiquidacion(
  actual: EstadoLiquidacion,
  nuevo: EstadoLiquidacion,
  permisos: readonly string[] | undefined,
  motivo?: string | null
): Validacion {
  return validar(actual, nuevo, TRANSICIONES_LIQUIDACION, PERMISO_TRANSICION_LIQUIDACION, permisos, motivo);
}

export function validarTransicionDecimo(
  actual: EstadoDecimo,
  nuevo: EstadoDecimo,
  permisos: readonly string[] | undefined,
  motivo?: string | null
): Validacion {
  return validar(actual, nuevo, TRANSICIONES_DECIMO, PERMISO_TRANSICION_DECIMO, permisos, motivo);
}

/** Qué acciones mostrar en pantalla para una liquidación, según estado y permisos. */
export function accionesLiquidacion(estado: EstadoLiquidacion, permisos: readonly string[]): EstadoLiquidacion[] {
  return (TRANSICIONES_LIQUIDACION[estado] ?? []).filter((n) =>
    tienePermiso(permisos, PERMISO_TRANSICION_LIQUIDACION[`${estado}_${n}`] ?? "")
  );
}

export function accionesDecimo(estado: EstadoDecimo, permisos: readonly string[]): EstadoDecimo[] {
  return (TRANSICIONES_DECIMO[estado] ?? []).filter((n) =>
    tienePermiso(permisos, PERMISO_TRANSICION_DECIMO[`${estado}_${n}`] ?? "")
  );
}
