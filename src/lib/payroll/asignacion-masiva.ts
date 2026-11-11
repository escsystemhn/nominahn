/**
 * Asignar un tipo de deducción a varios empleados a la vez: qué pasa con quien ya
 * lo tiene. Lógica pura; la ruta `/api/deducciones/masiva` la aplica.
 *
 * «Ya lo tiene» depende de la forma de cobro, porque no es lo mismo:
 *  · CADA PLANILLA: tener ya una de cada planilla del tipo. Con «Actualizar» se le
 *    cambia el monto a esa (si es una sola); con «Saltar» se deja como está.
 *  · UNA VEZ o EN CUOTAS: tener un saldo pendiente del tipo. Un segundo préstamo es
 *    legítimo, así que la otra opción es «Agregar otra», no actualizar: reescribir el
 *    monto de un préstamo con cuotas cobradas descuadraría su saldo.
 * Los montos del período no cuentan: los maneja la importación por período.
 */

import { money, type Money, type MoneyInput } from "./money";
import { esCadaPlanilla, estaLiquidada } from "./deducciones";

export type FormaCobro = "UNA_VEZ" | "CUOTAS" | "SIEMPRE";
export type SiYaLaTiene = "SALTAR" | "ACTUALIZAR" | "AGREGAR";

export interface DeduccionDelTipo {
  id: string;
  monto: MoneyInput;
  saldo: MoneyInput | null;
  cuotasMeses: number | null;
  cuotasPagadas: number;
}

export type DecisionAsignacion =
  | { accion: "CREAR" }
  | { accion: "ACTUALIZAR"; id: string; antes: Money }
  | { accion: "SALTAR"; motivo: string };

/** Las opciones que tienen sentido para cada forma de cobro. */
export function opcionesSiYaLaTiene(forma: FormaCobro): SiYaLaTiene[] {
  return forma === "SIEMPRE" ? ["SALTAR", "ACTUALIZAR"] : ["SALTAR", "AGREGAR"];
}

export function resumenExistentes(existentes: readonly DeduccionDelTipo[]): { cadaPlanilla: Money | null; pendiente: Money | null } {
  const fijas = existentes.filter(esCadaPlanilla);
  const aPlazo = existentes.filter((d) => !esCadaPlanilla(d) && !estaLiquidada(d));
  return {
    cadaPlanilla: fijas.length ? fijas.reduce((s, d) => s.plus(money(d.monto)), money(0)) : null,
    pendiente: aPlazo.length ? aPlazo.reduce((s, d) => s.plus(money(d.saldo ?? d.monto)), money(0)) : null,
  };
}

export function decidirAsignacion(
  forma: FormaCobro,
  siYaLaTiene: SiYaLaTiene,
  existentes: readonly DeduccionDelTipo[],
  monto: MoneyInput
): DecisionAsignacion {
  if (forma === "SIEMPRE") {
    const fijas = existentes.filter(esCadaPlanilla);
    if (fijas.length === 0) return { accion: "CREAR" };
    if (siYaLaTiene !== "ACTUALIZAR") return { accion: "SALTAR", motivo: "ya la tiene en cada planilla" };
    if (fijas.length > 1) return { accion: "SALTAR", motivo: `tiene ${fijas.length} de cada planilla de este tipo; cámbielas una por una` };
    const antes = money(fijas[0].monto);
    if (antes.equals(money(monto))) return { accion: "SALTAR", motivo: "ya tiene ese mismo monto" };
    return { accion: "ACTUALIZAR", id: fijas[0].id, antes };
  }
  const pendientes = existentes.filter((d) => !esCadaPlanilla(d) && !estaLiquidada(d));
  if (pendientes.length === 0 || siYaLaTiene === "AGREGAR") return { accion: "CREAR" };
  return { accion: "SALTAR", motivo: "ya tiene un saldo pendiente de este tipo" };
}
