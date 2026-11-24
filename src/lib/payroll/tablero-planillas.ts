/**
 * El tablero de Planillas (fase 3 de Planillas por período, 2026-11-24): una fila por
 * sucursal y una columna por período (los últimos seis), para ver de un vistazo qué
 * sucursal va atrasada. Cada celda es su planilla (estado y neto), «Falta» si la sucursal
 * tiene gente que cobra en ese período y no tiene la suya, o nada. PURO.
 */

import { claveDePeriodo, type EstadoLista } from "./planillas-por-periodo";
import { claveDeUnidadSinPlanilla } from "./lote-planillas";
import { esPeriodoEstandar, type TipoPlanillaPeriodo } from "./periodos-planilla";

export interface PeriodoClave {
  tipo: TipoPlanillaPeriodo;
  desde: string;
  hasta: string;
}

export interface PlanillaDelTablero extends PeriodoClave {
  id: string;
  estado: EstadoLista;
  neto: number;
  empresaId: string;
  sucursalId: string | null;
  divisionId: string | null;
  departamentoId: string | null;
  /** Nombres: grupo (modelo `Sucursal`), sucursal (modelo `División`) y departamento. */
  grupo: string | null;
  division: string | null;
  departamento: string | null;
}

/** Una unidad sin planilla en un período (de `faltantesDelPeriodo`). */
export interface FaltaDelTablero {
  empresaId: string;
  sucursalId: string;
  divisionId: string | null;
  grupo: string;
  nombre: string;
  empleados: number;
}

export type Celda =
  | { tipo: "planilla"; id: string; estado: EstadoLista; neto: number }
  | { tipo: "falta"; empleados: number; unidad: string }
  | { tipo: "vacia" };

export interface ColumnaTablero extends PeriodoClave {
  clave: string;
  /** «2.ª quincena», «Noviembre», «Semana del 16». */
  titulo: string;
  /** «nov. 2026». */
  sub: string;
  enCurso: boolean;
  /** Suma del neto de las planillas vigentes de la columna. */
  neto: number;
  faltan: number;
}

export interface FilaTablero {
  clave: string;
  nombre: string;
  celdas: Celda[];
}

const MESES_CORTOS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** El encabezado de una columna, en dos renglones cortos. */
export function encabezadoDe(p: PeriodoClave): { titulo: string; sub: string } {
  const anio = p.desde.slice(0, 4);
  const mes = Number(p.desde.slice(5, 7)) - 1;
  const dia = Number(p.desde.slice(8, 10));
  if (!esPeriodoEstandar(p)) {
    const fin = Number(p.hasta.slice(8, 10));
    return { titulo: `Del ${dia} al ${fin}`, sub: `${MESES_CORTOS[mes]} ${anio}` };
  }
  if (p.tipo === "MENSUAL") return { titulo: MESES[mes], sub: anio };
  if (p.tipo === "QUINCENAL") return { titulo: dia === 1 ? "1.ª quincena" : "2.ª quincena", sub: `${MESES_CORTOS[mes]} ${anio}` };
  return { titulo: `Semana del ${dia}`, sub: `${MESES_CORTOS[mes]} ${anio}` };
}

/**
 * Los períodos del tablero, del más antiguo al más reciente: los `n` más recientes que
 * tienen planillas, más el que está en curso si se pasa (porque ya le falta algo).
 */
export function columnasDelTablero(conPlanillas: readonly PeriodoClave[], enCurso: PeriodoClave | null, n = 6): PeriodoClave[] {
  const porClave = new Map<string, PeriodoClave>();
  for (const p of [...conPlanillas, ...(enCurso ? [enCurso] : [])]) porClave.set(claveDePeriodo(p), { tipo: p.tipo, desde: p.desde, hasta: p.hasta });
  return [...porClave.values()].sort((a, b) => b.desde.localeCompare(a.desde) || b.hasta.localeCompare(a.hasta)).slice(0, n).reverse();
}

const claveDePlanilla = (p: Pick<PlanillaDelTablero, "empresaId" | "sucursalId" | "divisionId" | "departamentoId">) =>
  `${p.empresaId}|${p.sucursalId ?? ""}|${p.divisionId ?? ""}|${p.departamentoId ?? ""}`;

export function armarTablero(
  periodos: readonly PeriodoClave[],
  planillas: readonly PlanillaDelTablero[],
  faltan: Readonly<Record<string, readonly FaltaDelTablero[]>>,
  hoy: string,
): { columnas: ColumnaTablero[]; filas: FilaTablero[] } {
  const claves = periodos.map(claveDePeriodo);
  const enTablero = planillas.filter((p) => claves.includes(claveDePeriodo(p)));

  // Las unidades: las de las planillas y las que les falta la suya.
  const unidades = new Map<string, { grupoId: string | null; partes: Array<string | null> }>();
  for (const p of enTablero) {
    const k = claveDePlanilla(p);
    if (!unidades.has(k)) unidades.set(k, { grupoId: p.sucursalId, partes: p.sucursalId ? [p.grupo, p.division, p.departamento] : [] });
  }
  for (const c of claves) {
    for (const u of faltan[c] ?? []) {
      const k = claveDePlanilla({ ...u, departamentoId: null });
      if (!unidades.has(k)) unidades.set(k, { grupoId: u.sucursalId, partes: [u.grupo, u.divisionId ? u.nombre : null, null] });
    }
  }
  // Todas del mismo grupo: en cada fila, sólo la sucursal.
  const unGrupo = new Set([...unidades.values()].map((u) => u.grupoId)).size <= 1;
  const nombre = (u: { partes: Array<string | null> }) => {
    const partes = u.partes.filter((x): x is string => !!x);
    if (partes.length === 0) return "Toda la empresa";
    return unGrupo && partes.length > 1 ? partes.slice(1).join(" / ") : partes.join(" / ");
  };

  const filas: FilaTablero[] = [...unidades.entries()].map(([k, u]) => ({
    clave: k,
    nombre: nombre(u),
    celdas: periodos.map((_, i): Celda => {
      const suyas = enTablero.filter((p) => claveDePlanilla(p) === k && claveDePeriodo(p) === claves[i]);
      // La vigente; si sólo hay anuladas, la anulada (se ve, apagada).
      const p = suyas.find((x) => x.estado !== "ANULADA") ?? suyas[0];
      if (p) return { tipo: "planilla", id: p.id, estado: p.estado, neto: p.neto };
      const f = (faltan[claves[i]] ?? []).find((x) => claveDePlanilla({ ...x, departamentoId: null }) === k);
      if (f) return { tipo: "falta", empleados: f.empleados, unidad: claveDeUnidadSinPlanilla(f) };
      return { tipo: "vacia" };
    }),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));

  const columnas: ColumnaTablero[] = periodos.map((p, i) => {
    const vigentes = enTablero.filter((x) => claveDePeriodo(x) === claves[i] && x.estado !== "ANULADA");
    return {
      ...p, clave: claves[i], ...encabezadoDe(p),
      enCurso: p.desde <= hoy && hoy <= p.hasta,
      neto: vigentes.reduce((s, x) => s + Math.round(x.neto * 100), 0) / 100,
      faltan: (faltan[claves[i]] ?? []).length,
    };
  });
  return { columnas, filas };
}
