/**
 * Planillas por período, fase 2 (2026-11-24, ver la maqueta aprobada): lo que hace cada
 * acción por lote, qué planillas marcadas entran y cuáles se omiten (y por qué), y qué
 * sucursales no tienen todavía su planilla en un período. PURO: lo usan el servidor y el
 * navegador.
 *
 * Las acciones no tienen ruta propia: el navegador llama, una planilla tras otra, a las
 * mismas rutas que usa cada planilla (PATCH de estado y POST de recalcular). Así cada una
 * pasa por las mismas validaciones, cobros, auditoría y envío a SAP que si se hiciera a
 * mano, y una que falla no detiene a las demás.
 */

import type { EstadoLista } from "./planillas-por-periodo";

export type AccionLote = "recalcular" | "confirmar" | "aprobar" | "pagar";

export interface DefinicionAccion {
  /** Estado en que debe estar una planilla para entrar en el lote. */
  desde: EstadoLista;
  /** Al que pasa. Recalcular no cambia de estado. */
  hacia: EstadoLista | null;
  permiso: "planillas.calcular" | "planillas.aprobar" | "planillas.pagar";
  boton: string;
  /** «Se confirmarán 3 planillas». */
  verbo: string;
  /** «3 planillas confirmadas». */
  hecho: [singular: string, plural: string];
  /** Lo que conviene saber antes de pulsar. */
  explicacion: string;
  /** Lo que ya no tiene vuelta atrás, en ámbar. */
  aviso?: string;
}

export const ACCIONES_LOTE: Record<AccionLote, DefinicionAccion> = {
  recalcular: {
    desde: "BORRADOR", hacia: null, permiso: "planillas.calcular", boton: "Recalcular",
    verbo: "Se recalcularán", hecho: ["recalculada", "recalculadas"],
    explicacion: "Cada borrador se vuelve a calcular con los datos de ahora: horas, deducciones, salarios y personal. No se cobra nada.",
  },
  confirmar: {
    desde: "BORRADOR", hacia: "CALCULADA", permiso: "planillas.calcular", boton: "Confirmar",
    verbo: "Se confirmarán", hecho: ["confirmada", "confirmadas"],
    explicacion: "Antes de confirmar cada una se recalcula por última vez. Si algo cambió, esa no se confirma: se actualiza y queda marcada para revisarla. Al confirmar se cobran las cuotas de préstamos y se marcan los bonos.",
  },
  aprobar: {
    desde: "CALCULADA", hacia: "APROBADA", permiso: "planillas.aprobar", boton: "Aprobar",
    verbo: "Se aprobarán", hecho: ["aprobada", "aprobadas"],
    explicacion: "Cada empleado podrá ver su comprobante. Si SAP está configurado para enviar al aprobar, el asiento de cada una saldrá en ese momento.",
    aviso: "Aprobadas quedan cerradas, con sus importes sellados: ya no se pueden recalcular ni editar. Un error después se corrige con una partida de ajuste.",
  },
  pagar: {
    desde: "APROBADA", hacia: "PAGADA", permiso: "planillas.pagar", boton: "Marcar pagadas",
    verbo: "Se marcarán pagadas", hecho: ["marcada pagada", "marcadas pagadas"],
    explicacion: "Registra que ya se pagó el neto de cada una. Si SAP está configurado para enviar al pagar, el asiento saldrá en ese momento.",
    aviso: "Una planilla pagada ya no vuelve a edición.",
  },
};

export const ORDEN_ACCIONES: readonly AccionLote[] = ["recalcular", "confirmar", "aprobar", "pagar"];

const CICLO: readonly EstadoLista[] = ["BORRADOR", "CALCULADA", "APROBADA", "PAGADA"];
const YA: Partial<Record<EstadoLista, string>> = { CALCULADA: "ya está confirmada", APROBADA: "ya está aprobada", PAGADA: "ya está pagada" };

/** Por qué una planilla marcada no entra en esa acción. */
export function motivoOmitida(accion: AccionLote, estado: EstadoLista): string {
  if (estado === "ANULADA") return "está anulada";
  const requerido = ACCIONES_LOTE[accion].desde;
  if (CICLO.indexOf(estado) > CICLO.indexOf(requerido)) return YA[estado] ?? "ya pasó ese paso";
  return estado === "BORRADOR" ? "todavía está en borrador" : "todavía no está aprobada";
}

export interface PlanillaMarcada {
  id: string;
  estado: EstadoLista;
  neto: number;
}

export function repartirLote<T extends PlanillaMarcada>(accion: AccionLote, marcadas: readonly T[]) {
  const { desde } = ACCIONES_LOTE[accion];
  const van = marcadas.filter((m) => m.estado === desde);
  const omitidas = marcadas.filter((m) => m.estado !== desde).map((m) => ({ ...m, motivo: motivoOmitida(accion, m.estado) }));
  // En centavos: sumar netos en coma flotante deja colas de 0.0000001.
  const neto = van.reduce((s, m) => s + Math.round(m.neto * 100), 0) / 100;
  return { van, omitidas, neto };
}

/** Las acciones que tienen algo que hacer con lo marcado y que esta cuenta puede hacer, con cuántas entran. */
export function accionesDisponibles(marcadas: readonly PlanillaMarcada[], permisos: readonly string[]): Array<{ accion: AccionLote; cuantas: number }> {
  return ORDEN_ACCIONES
    .filter((a) => permisos.includes(ACCIONES_LOTE[a].permiso))
    .map((a) => ({ accion: a, cuantas: marcadas.filter((m) => m.estado === ACCIONES_LOTE[a].desde).length }))
    .filter((x) => x.cuantas > 0);
}

/** «Norte», «Norte y Sur», «Centro, Norte y Sur». */
export function unirNombres(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? "";
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// ─── Sucursales sin planilla en un período ─────────────────────────────────────

/** Quien cobra en el período, con dónde está hoy. */
export interface EmpleadoDelPeriodo {
  id: string;
  empresaId: string;
  sucursalId: string;
  sucursal: string;
  divisionId: string | null;
  division: string | null;
}

/** Una planilla vigente con exactamente las fechas del período. */
export interface PlanillaDelPeriodo {
  id: string;
  estado: EstadoLista;
  empresaId: string;
  sucursalId: string | null;
  divisionId: string | null;
  departamentoId: string | null;
}

export interface UnidadSinPlanilla {
  clave: string;
  empresaId: string;
  sucursalId: string;
  divisionId: string | null;
  /** El grupo (modelo `Sucursal`). */
  grupo: string;
  /** La sucursal (modelo `División`) o, sin ella, el grupo. */
  nombre: string;
  /** Cuántas personas de aquí cobran en el período y no están en ninguna planilla de esas fechas. */
  empleados: number;
  /**
   * La planilla de esta misma unidad, si ya existe: entonces son personas que entraron o
   * se movieron después de generarla, y lo que corresponde es recalcularla, no otra.
   */
  planilla: { id: string; estado: EstadoLista } | null;
}

/** La clave de una unidad sin planilla: la misma en la lista, el tablero y la ventana de generar. */
export const claveDeUnidadSinPlanilla = (u: { empresaId: string; sucursalId: string; divisionId: string | null }) =>
  `${u.empresaId}|${u.sucursalId}|${u.divisionId ?? ""}`;

/**
 * Agrupa a quienes no están en ninguna planilla del período por la unidad en que se
 * genera la planilla: la sucursal (división) si el nivel está habilitado y la persona
 * tiene una; si no, el grupo. Es la forma en que se trabaja: una planilla por sucursal.
 */
export function unidadesSinPlanilla(
  empleados: readonly EmpleadoDelPeriodo[],
  enPlanilla: ReadonlySet<string>,
  planillas: readonly PlanillaDelPeriodo[],
  conDivisiones: boolean,
): UnidadSinPlanilla[] {
  const unidades = new Map<string, UnidadSinPlanilla>();
  for (const e of empleados) {
    if (enPlanilla.has(e.id)) continue;
    const divisionId = conDivisiones ? e.divisionId : null;
    const clave = claveDeUnidadSinPlanilla({ empresaId: e.empresaId, sucursalId: e.sucursalId, divisionId });
    const u = unidades.get(clave);
    if (u) { u.empleados++; continue; }
    const propia = planillas.find((p) => p.empresaId === e.empresaId && p.sucursalId === e.sucursalId
      && (p.divisionId ?? null) === divisionId && !p.departamentoId && p.estado !== "ANULADA");
    unidades.set(clave, {
      clave, empresaId: e.empresaId, sucursalId: e.sucursalId, divisionId,
      grupo: e.sucursal, nombre: divisionId ? e.division ?? e.sucursal : e.sucursal,
      empleados: 1, planilla: propia ? { id: propia.id, estado: propia.estado } : null,
    });
  }
  return [...unidades.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, "es") || a.nombre.localeCompare(b.nombre, "es"));
}

/** El nombre de cada unidad para una lista: sólo la sucursal si todas son del mismo grupo. */
export function nombresDeUnidades(unidades: readonly Pick<UnidadSinPlanilla, "grupo" | "nombre" | "divisionId">[]): string[] {
  const unGrupo = new Set(unidades.map((u) => u.grupo)).size <= 1;
  return unidades.map((u) => (unGrupo || !u.divisionId ? u.nombre : `${u.grupo} / ${u.nombre}`));
}
