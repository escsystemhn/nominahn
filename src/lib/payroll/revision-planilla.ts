/**
 * Revisar una planilla antes de confirmarla: la conciliación que un contador hace a
 * mano contra el período anterior.
 *
 * El puente va del neto anterior al neto actual y CUADRA AL CENTAVO: lo que no se
 * explica por gente que entra, gente que sale, ingresos o deducciones queda a la vista
 * como «otros ajustes», en vez de esconderse en un redondeo.
 *
 * Es informativa a propósito: que el neto cambie no es un error (hay horas extra, un
 * aumento, una quincena con más días). Sólo señala dónde conviene mirar.
 */

import { CERO, money, sumarPor, type Money, type MoneyInput } from "./money";
import { formatCurrency } from "@/lib/utils";

/** A partir de este cambio en el neto de una persona, vale la pena mirarla de cerca. */
export const CAMBIO_GRANDE = 0.25;

export interface LineaRevision {
  empleadoId: string;
  nombre: string;
  salarioBase: MoneyInput;
  diasTrabajados: MoneyInput;
  horasExtra: MoneyInput;
  totalBruto: MoneyInput;
  totalDeducciones: MoneyInput;
  salarioNeto: MoneyInput;
  tieneCuenta: boolean;
  tieneCorreo: boolean;
}

export interface PartidaPuente {
  clave: "entran" | "salen" | "ingresos" | "deducciones" | "otros";
  /** Cuántas personas explica la partida, si aplica. */
  personas?: number;
  monto: Money;
}

export interface CambioPersona {
  empleadoId: string;
  nombre: string;
  antes: Money;
  ahora: Money;
  diferencia: Money;
  /** Por qué cambió, en palabras. */
  motivos: string[];
  /** Cambió más que `CAMBIO_GRANDE`, o pasó de cero a algo. */
  grande: boolean;
}

export interface PuntoRevision {
  clave: "neto-cero" | "deducciones-altas" | "cambio-grande" | "sin-cuenta" | "sin-correo";
  titulo: string;
  personas: Array<{ empleadoId: string; nombre: string }>;
}

export interface RevisionPlanilla {
  hayAnterior: boolean;
  netoAnterior: Money;
  netoActual: Money;
  diferencia: Money;
  /** Diferencia sobre el neto anterior, de 0 a 1. `null` si no hay contra qué medir. */
  proporcion: number | null;
  puente: PartidaPuente[];
  entran: Array<{ empleadoId: string; nombre: string; neto: Money }>;
  salen: Array<{ empleadoId: string; nombre: string; neto: Money }>;
  /** Quienes siguen y cobran distinto, de mayor a menor cambio. */
  cambios: CambioPersona[];
  /** Quienes siguen y cobran exactamente lo mismo. */
  sinCambio: number;
  puntos: PuntoRevision[];
}

function motivosDe(ahora: LineaRevision, antes: LineaRevision): string[] {
  const motivos: string[] = [];
  const salario = [money(antes.salarioBase), money(ahora.salarioBase)];
  if (!salario[0].equals(salario[1])) motivos.push(`Salario de ${formatCurrency(salario[0])} a ${formatCurrency(salario[1])}`);

  const dias = [money(antes.diasTrabajados), money(ahora.diasTrabajados)];
  if (!dias[0].equals(dias[1])) motivos.push(`${dias[1].toFixed(0)} días, antes ${dias[0].toFixed(0)}`);

  const extra = [money(antes.horasExtra), money(ahora.horasExtra)];
  if (!extra[0].equals(extra[1])) motivos.push(`${extra[1].toFixed(1)} h extra, antes ${extra[0].toFixed(1)}`);

  const deducciones = money(ahora.totalDeducciones).minus(antes.totalDeducciones);
  if (!deducciones.isZero()) {
    motivos.push(`Deducciones ${deducciones.isPositive() ? "suben" : "bajan"} ${formatCurrency(deducciones.abs())}`);
  }

  // Cambió el bruto y nada de lo anterior lo explica: bonos u otros ingresos.
  const bruto = money(ahora.totalBruto).minus(antes.totalBruto);
  if (!bruto.isZero() && motivos.length === 0) {
    motivos.push(`Ingresos ${bruto.isPositive() ? "suben" : "bajan"} ${formatCurrency(bruto.abs())}`);
  }
  return motivos;
}

export function revisarPlanilla(actual: LineaRevision[], anterior: LineaRevision[] | null): RevisionPlanilla {
  const previas = new Map((anterior ?? []).map((l) => [l.empleadoId, l]));
  const vigentes = new Set(actual.map((l) => l.empleadoId));
  const hayAnterior = anterior !== null;

  const netoActual = sumarPor(actual, (l) => l.salarioNeto);
  const netoAnterior = sumarPor(anterior ?? [], (l) => l.salarioNeto);

  const nombrado = (l: LineaRevision) => ({ empleadoId: l.empleadoId, nombre: l.nombre, neto: money(l.salarioNeto) });
  const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");
  const entran = hayAnterior ? actual.filter((l) => !previas.has(l.empleadoId)).map(nombrado).sort(porNombre) : [];
  const salen = (anterior ?? []).filter((l) => !vigentes.has(l.empleadoId)).map(nombrado).sort(porNombre);

  const cambios: CambioPersona[] = [];
  let sinCambio = 0;
  let cambioIngresos: Money = CERO;
  let cambioDeducciones: Money = CERO;
  let cambioNeto: Money = CERO;
  for (const l of hayAnterior ? actual : []) {
    const previa = previas.get(l.empleadoId);
    if (!previa) continue;
    cambioIngresos = cambioIngresos.plus(money(l.totalBruto).minus(previa.totalBruto));
    cambioDeducciones = cambioDeducciones.plus(money(l.totalDeducciones).minus(previa.totalDeducciones));
    const antes = money(previa.salarioNeto);
    const ahora = money(l.salarioNeto);
    const diferencia = ahora.minus(antes);
    cambioNeto = cambioNeto.plus(diferencia);
    if (diferencia.isZero()) {
      sinCambio++;
      continue;
    }
    cambios.push({
      empleadoId: l.empleadoId,
      nombre: l.nombre,
      antes,
      ahora,
      diferencia,
      motivos: motivosDe(l, previa),
      grande: antes.isZero() || diferencia.abs().div(antes.abs()).greaterThan(CAMBIO_GRANDE),
    });
  }
  cambios.sort((a, b) => b.diferencia.abs().comparedTo(a.diferencia.abs()) || porNombre(a, b));

  const puente: PartidaPuente[] = [];
  if (hayAnterior) {
    if (entran.length) puente.push({ clave: "entran", personas: entran.length, monto: sumarPor(entran, (e) => e.neto) });
    if (salen.length) puente.push({ clave: "salen", personas: salen.length, monto: sumarPor(salen, (e) => e.neto).negated() });
    if (!cambioIngresos.isZero()) puente.push({ clave: "ingresos", monto: cambioIngresos });
    if (!cambioDeducciones.isZero()) puente.push({ clave: "deducciones", monto: cambioDeducciones.negated() });
    // Neto ≠ bruto − deducciones en alguna línea: se muestra, no se reparte en silencio.
    const otros = cambioNeto.minus(cambioIngresos.minus(cambioDeducciones));
    if (!otros.isZero()) puente.push({ clave: "otros", monto: otros });
  }

  const quien = (l: LineaRevision) => ({ empleadoId: l.empleadoId, nombre: l.nombre });
  const candidatos: Array<[PuntoRevision["clave"], string, Array<{ empleadoId: string; nombre: string }>]> = [
    ["neto-cero", "Neto en cero o negativo", actual.filter((l) => !money(l.salarioNeto).isPositive() || money(l.salarioNeto).isZero()).map(quien)],
    [
      "deducciones-altas",
      "Deducciones mayores a la mitad del bruto",
      actual.filter((l) => money(l.totalBruto).isPositive() && money(l.totalDeducciones).greaterThan(money(l.totalBruto).div(2))).map(quien),
    ],
    ["cambio-grande", `Neto cambia más de ${CAMBIO_GRANDE * 100} % frente a la anterior`, cambios.filter((c) => c.grande).map((c) => ({ empleadoId: c.empleadoId, nombre: c.nombre }))],
    ["sin-cuenta", "Sin cuenta bancaria: se pagan a mano, no salen en el archivo del banco", actual.filter((l) => !l.tieneCuenta).map(quien)],
    ["sin-correo", "Sin correo: no recibirán su comprobante", actual.filter((l) => !l.tieneCorreo).map(quien)],
  ];
  const puntos = candidatos
    .filter(([, , personas]) => personas.length > 0)
    .map(([clave, titulo, personas]) => ({ clave, titulo, personas: [...personas].sort(porNombre) }));

  const diferencia = netoActual.minus(netoAnterior);
  return {
    hayAnterior,
    netoAnterior,
    netoActual,
    diferencia,
    proporcion: hayAnterior && !netoAnterior.isZero() ? diferencia.abs().div(netoAnterior.abs()).toNumber() : null,
    puente,
    entran,
    salen,
    cambios,
    sinCambio,
    puntos,
  };
}

/** La revisión en una o dos frases, para la ventana de confirmar. */
export function resumenDeRevision(r: RevisionPlanilla): string {
  const partes: string[] = [];
  if (r.hayAnterior) {
    partes.push(
      r.diferencia.isZero()
        ? "Frente a la planilla anterior, el neto no cambia."
        : `Frente a la planilla anterior, el neto ${r.diferencia.isPositive() ? "sube" : "baja"} ${formatCurrency(r.diferencia.abs())}.`
    );
  }
  const revisar = r.puntos.filter((p) => p.clave !== "sin-correo").length;
  if (revisar > 0) partes.push(revisar === 1 ? "Hay 1 punto por revisar." : `Hay ${revisar} puntos por revisar.`);
  return partes.join(" ");
}
