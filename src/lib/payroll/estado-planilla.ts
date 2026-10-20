/**
 * Máquina de estados e integridad de planillas.
 *
 * PRINCIPIO ERP: una planilla APROBADA o PAGADA es un documento contable cerrado.
 * No se edita — se anula y se emite una nueva, o se corrige vía ajuste retroactivo
 * en la planilla corriente. Este módulo es la única autoridad sobre qué
 * transiciones son legales y quién puede ejecutarlas.
 *
 * Es lógica pura (sin Prisma ni red) para poder probarse de forma aislada.
 */

import { createHash } from "crypto";
import { tienePermiso } from "@/lib/auth/permisos";

export type EstadoPlanilla = "BORRADOR" | "CALCULADA" | "APROBADA" | "PAGADA" | "ANULADA";

/**
 * Estados en los que el contenido financiero queda congelado.
 * Ninguna ruta debe modificar montos de una planilla en estos estados.
 */
export const ESTADOS_CERRADOS: readonly EstadoPlanilla[] = ["APROBADA", "PAGADA", "ANULADA"];

/** Estados desde los que ya no hay salida: el documento terminó su ciclo. */
export const ESTADOS_TERMINALES: readonly EstadoPlanilla[] = ["ANULADA"];

/**
 * Estados en los que una planilla OCUPA su período: mientras exista una así
 * para (empresa, sucursal, tipo, período), no puede emitirse otra igual.
 *
 * ANULADA queda deliberadamente fuera: el flujo de corrección de este sistema
 * es anular y reemitir, de modo que un período anulado debe poder recalcularse.
 * El índice único parcial en base de datos replica exactamente esta lista
 * (ver `prisma/sql/01-planilla-periodo-unico.sql`); si cambia una, cambia la otra.
 */
export const ESTADOS_OCUPAN_PERIODO: readonly EstadoPlanilla[] = [
  "BORRADOR",
  "CALCULADA",
  "APROBADA",
  "PAGADA",
];

export function ocupaPeriodo(estado: EstadoPlanilla): boolean {
  return ESTADOS_OCUPAN_PERIODO.includes(estado);
}

/**
 * Transiciones permitidas.
 *
 * PAGADA solo puede anularse: una planilla pagada jamás regresa a edición.
 * La corrección de una planilla pagada se hace por ajuste retroactivo (Fase 4),
 * no reabriendo el período.
 */
export const TRANSICIONES: Record<EstadoPlanilla, EstadoPlanilla[]> = {
  BORRADOR: ["CALCULADA", "ANULADA"],
  CALCULADA: ["APROBADA", "BORRADOR", "ANULADA"],
  APROBADA: ["PAGADA", "CALCULADA", "ANULADA"],
  PAGADA: ["ANULADA"],
  ANULADA: [],
};

/**
 * Permiso exigido por cada transición, con separación de funciones:
 * quien AUTORIZA el gasto (aprobar) no es quien lo EJECUTA (pagar), y quien
 * calcula no se aprueba a sí mismo.
 *
 * ANTES ERA UNA MATRIZ DE ROLES. Se expresa en permisos para que la separación
 * pueda configurarse: con roles fijos, «este contador sí aprueba pero no paga»
 * obligaba a inventar un rol nuevo. El reparto que producía la matriz anterior
 * se conserva intacto a través de `PERMISOS_POR_ROL`, y los tests lo comprueban
 * rol por rol.
 */
export const PERMISOS_TRANSICION: Record<string, string> = {
  BORRADOR_CALCULADA: "planillas.calcular",
  BORRADOR_ANULADA: "planillas.anular",
  CALCULADA_APROBADA: "planillas.aprobar",
  CALCULADA_BORRADOR: "planillas.calcular",
  CALCULADA_ANULADA: "planillas.anular",
  APROBADA_PAGADA: "planillas.pagar",
  // Reapertura de una planilla ya aprobada: acto excepcional.
  APROBADA_CALCULADA: "planillas.reabrir",
  APROBADA_ANULADA: "planillas.reabrir",
  // Anular una planilla PAGADA revierte un desembolso ya ejecutado.
  PAGADA_ANULADA: "planillas.anular_pagada",
};

/** Transiciones que exigen justificación escrita para quedar en el rastro de auditoría. */
export const TRANSICIONES_REQUIEREN_MOTIVO: readonly string[] = [
  "APROBADA_CALCULADA",
  "APROBADA_ANULADA",
  "PAGADA_ANULADA",
];

export type ResultadoValidacion =
  | { ok: true; requiereMotivo: boolean }
  | { ok: false; status: 403 | 409 | 422; error: string };

export function esEstadoCerrado(estado: EstadoPlanilla): boolean {
  return ESTADOS_CERRADOS.includes(estado);
}

export function esEstadoTerminal(estado: EstadoPlanilla): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

export function claveTransicion(actual: EstadoPlanilla, nuevo: EstadoPlanilla): string {
  return `${actual}_${nuevo}`;
}

/**
 * Valida una transición de estado: legalidad, permiso y justificación.
 * Es la única puerta de entrada a un cambio de estado de planilla.
 *
 * `permisos` son los efectivos del usuario, tal como llegan en la sesión.
 */
export function validarTransicion(
  actual: EstadoPlanilla,
  nuevo: EstadoPlanilla,
  permisos: readonly string[] | undefined,
  opts: { motivo?: string | null } = {}
): ResultadoValidacion {
  if (actual === nuevo) {
    return { ok: false, status: 422, error: `La planilla ya está en estado ${actual}` };
  }

  if (esEstadoTerminal(actual)) {
    return {
      ok: false,
      status: 409,
      error: `La planilla está ${actual} y no admite más cambios de estado`,
    };
  }

  const permitidas = TRANSICIONES[actual];
  if (!permitidas) {
    return { ok: false, status: 422, error: `Estado de origen desconocido: ${actual}` };
  }
  if (!permitidas.includes(nuevo)) {
    return {
      ok: false,
      status: 422,
      error: `Transición ${actual} → ${nuevo} no permitida. Permitidas: ${permitidas.join(", ") || "ninguna"}`,
    };
  }

  const clave = claveTransicion(actual, nuevo);
  const requerido = PERMISOS_TRANSICION[clave];
  // Sin permiso declarado la transición no se ejecuta: una entrada que faltara
  // en la matriz debe cerrar el paso, no abrirlo.
  if (!requerido || !tienePermiso(permisos, requerido)) {
    return {
      ok: false,
      status: 403,
      error: `No tiene el permiso necesario (${requerido ?? "sin definir"}) para la transición ${actual} → ${nuevo}`,
    };
  }

  const requiereMotivo = TRANSICIONES_REQUIEREN_MOTIVO.includes(clave);
  if (requiereMotivo && !opts.motivo?.trim()) {
    return {
      ok: false,
      status: 422,
      error: `La transición ${actual} → ${nuevo} exige un motivo justificado`,
    };
  }

  return { ok: true, requiereMotivo };
}

/**
 * Determina si un campo puede editarse dado el estado actual.
 * Los montos quedan congelados al cerrar; las notas siguen siendo editables
 * porque no alteran el resultado contable.
 */
const CAMPOS_EDITABLES_EN_CIERRE: readonly string[] = ["observaciones"];

export function puedeEditarCampo(estado: EstadoPlanilla, campo: string): boolean {
  if (!esEstadoCerrado(estado)) return true;
  return CAMPOS_EDITABLES_EN_CIERRE.includes(campo);
}

// ─── INTEGRIDAD DEL CÁLCULO ──────────────────────────────────────────────────

/**
 * Campos que definen el resultado económico de una línea de planilla.
 * Cualquier cambio en ellos invalida el hash de cierre.
 */
export interface DetalleParaHash {
  empleadoId: string;
  totalBruto: unknown;
  totalDeducciones: unknown;
  salarioNeto: unknown;
}

/**
 * Huella SHA-256 del contenido económico de la planilla.
 *
 * Se calcula al cerrar y se guarda en `Planilla.hashCalculo`. Recalcularla más
 * tarde y comparar detecta cualquier alteración de montos posterior al cierre,
 * incluso hecha directamente sobre la base de datos saltándose la aplicación.
 *
 * Se ordena por empleadoId para que la huella no dependa del orden de lectura,
 * y los montos se normalizan a 2 decimales para que Decimal, string y number
 * produzcan siempre el mismo resultado.
 */
export function calcularHashPlanilla(detalles: DetalleParaHash[]): string {
  const norm = (v: unknown) => Number(v ?? 0).toFixed(2);

  const canonico = [...detalles]
    .sort((a, b) => a.empleadoId.localeCompare(b.empleadoId))
    .map((d) => [d.empleadoId, norm(d.totalBruto), norm(d.totalDeducciones), norm(d.salarioNeto)].join("|"))
    .join("\n");

  return createHash("sha256").update(canonico, "utf8").digest("hex");
}

export interface ResultadoIntegridad {
  intacta: boolean;
  hashEsperado: string | null;
  hashActual: string;
  /** true cuando la planilla se cerró antes de que existiera el hash (datos heredados). */
  sinHashRegistrado: boolean;
}

/** Verifica que los detalles actuales correspondan al hash sellado en el cierre. */
export function verificarIntegridad(
  hashRegistrado: string | null | undefined,
  detalles: DetalleParaHash[]
): ResultadoIntegridad {
  const hashActual = calcularHashPlanilla(detalles);
  if (!hashRegistrado) {
    return { intacta: false, hashEsperado: null, hashActual, sinHashRegistrado: true };
  }
  return {
    intacta: hashRegistrado === hashActual,
    hashEsperado: hashRegistrado,
    hashActual,
    sinHashRegistrado: false,
  };
}
