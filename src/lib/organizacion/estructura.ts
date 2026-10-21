/**
 * Estructura organizacional: Empresa → Sucursal → División → Departamento → Empleado.
 *
 * La DIVISIÓN es opcional (ver el modelo `Division`): una sucursal sin
 * divisiones se comporta como antes y sus departamentos cuelgan directo de ella.
 * Este módulo es PURO (sin base de datos): filtros de Prisma por alcance
 * organizacional y la agrupación jerárquica que usan la planilla y los
 * reportes. La validación contra la base vive en `estructura-bd.ts`.
 */

import type { Prisma } from "@prisma/client";

/** Alcance organizacional de una consulta o de una planilla. `null` = todos. */
export interface AlcanceOrg {
  sucursalId: string | null;
  divisionId: string | null;
  departamentoId: string | null;
}

export const ALCANCE_TOTAL: AlcanceOrg = { sucursalId: null, divisionId: null, departamentoId: null };

/** Convierte lo que llega de un formulario o una URL («», undefined) en `null`. */
export function normalizarAlcance(a: Partial<Record<keyof AlcanceOrg, string | null | undefined>>): AlcanceOrg {
  const limpio = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return { sucursalId: limpio(a.sucursalId), divisionId: limpio(a.divisionId), departamentoId: limpio(a.departamentoId) };
}

/**
 * Filtro de empleados por su ubicación ACTUAL. Se combina con otros `where`
 * mediante `AND`; con alcance total devuelve `{}`.
 */
export function filtroEmpleadosOrg(a: AlcanceOrg): Prisma.EmpleadoWhereInput {
  const y: Prisma.EmpleadoWhereInput[] = [];
  if (a.sucursalId) y.push({ sucursalId: a.sucursalId });
  if (a.divisionId) y.push({ departamento: { divisionId: a.divisionId } });
  if (a.departamentoId) y.push({ departamentoId: a.departamentoId });
  return y.length ? { AND: y } : {};
}

/**
 * Filtro de líneas de planilla por la ubicación que la persona tenía AL
 * PAGARSE (columnas de la línea). Las líneas anteriores a esas columnas no las
 * tienen (`departamentoId` null): para ellas se usa la ubicación actual.
 */
export function filtroDetallesOrg(a: AlcanceOrg): Prisma.PlanillaDetalleWhereInput {
  const y: Prisma.PlanillaDetalleWhereInput[] = [];
  const nivel = (propio: Prisma.PlanillaDetalleWhereInput, actual: Prisma.EmpleadoWhereInput) =>
    y.push({ OR: [propio, { departamentoId: null, empleado: actual }] });
  if (a.sucursalId) nivel({ sucursalId: a.sucursalId }, { sucursalId: a.sucursalId });
  if (a.divisionId) nivel({ divisionId: a.divisionId }, { departamento: { divisionId: a.divisionId } });
  if (a.departamentoId) nivel({ departamentoId: a.departamentoId }, { departamentoId: a.departamentoId });
  return y.length ? { AND: y } : {};
}

// ─── Agrupación jerárquica ────────────────────────────────────────────────────

export interface Unidad {
  id: string;
  nombre: string;
}

/** Dónde está (o estaba) una persona dentro de la estructura. */
export interface Ubicacion {
  sucursal: Unidad;
  division: Unidad | null;
  departamento: Unidad;
}

export type NivelEstructura = "SUCURSAL" | "DIVISION" | "DEPARTAMENTO";

export interface GrupoEstructura<T> {
  nivel: NivelEstructura;
  /** `null` sólo en el grupo «Sin división». */
  id: string | null;
  nombre: string;
  /** Subgrupos; vacío en un departamento. */
  hijos: GrupoEstructura<T>[];
  /** Todo lo que cae bajo este grupo, en orden: sirve para los subtotales. */
  items: T[];
}

export const SIN_DIVISION = "Sin división";

const comparar = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

/**
 * Agrupa por Sucursal → División → Departamento. Dentro de una sucursal donde
 * nadie tiene división se omite ese nivel (los departamentos van directo bajo
 * la sucursal), para que una empresa que no usa divisiones vea lo de siempre.
 * Si en una sucursal unos tienen división y otros no, los segundos quedan bajo
 * «Sin división», al final. Los `items` conservan el orden de entrada.
 */
export function agruparPorEstructura<T>(items: T[], ubicacion: (t: T) => Ubicacion): GrupoEstructura<T>[] {
  const sucursales = new Map<string, { unidad: Unidad; items: T[] }>();
  for (const it of items) {
    const u = ubicacion(it);
    const s = sucursales.get(u.sucursal.id) ?? { unidad: u.sucursal, items: [] };
    s.items.push(it);
    sucursales.set(u.sucursal.id, s);
  }

  const departamentos = (lista: T[]): GrupoEstructura<T>[] => {
    const m = new Map<string, { unidad: Unidad; items: T[] }>();
    for (const it of lista) {
      const d = ubicacion(it).departamento;
      const g = m.get(d.id) ?? { unidad: d, items: [] };
      g.items.push(it);
      m.set(d.id, g);
    }
    return [...m.values()]
      .sort((a, b) => comparar(a.unidad.nombre, b.unidad.nombre))
      .map((g) => ({ nivel: "DEPARTAMENTO" as const, id: g.unidad.id, nombre: g.unidad.nombre, hijos: [], items: g.items }));
  };

  return [...sucursales.values()]
    .sort((a, b) => comparar(a.unidad.nombre, b.unidad.nombre))
    .map((s) => {
      const usaDivisiones = s.items.some((it) => ubicacion(it).division !== null);
      let hijos: GrupoEstructura<T>[];
      if (!usaDivisiones) {
        hijos = departamentos(s.items);
      } else {
        const divisiones = new Map<string, { unidad: Unidad | null; items: T[] }>();
        for (const it of s.items) {
          const d = ubicacion(it).division;
          const clave = d?.id ?? "";
          const g = divisiones.get(clave) ?? { unidad: d, items: [] };
          g.items.push(it);
          divisiones.set(clave, g);
        }
        hijos = [...divisiones.values()]
          .sort((a, b) => (a.unidad === null ? 1 : b.unidad === null ? -1 : comparar(a.unidad.nombre, b.unidad.nombre)))
          .map((g) => ({
            nivel: "DIVISION" as const,
            id: g.unidad?.id ?? null,
            nombre: g.unidad?.nombre ?? SIN_DIVISION,
            hijos: departamentos(g.items),
            items: g.items,
          }));
      }
      return { nivel: "SUCURSAL" as const, id: s.unidad.id, nombre: s.unidad.nombre, hijos, items: s.items };
    });
}

export type EntradaEstructura<T> =
  | { tipo: "grupo"; nivel: number; grupo: GrupoEstructura<T> }
  | { tipo: "detalle"; nivel: number; item: T }
  | { tipo: "subtotal"; nivel: number; grupo: GrupoEstructura<T> };

/**
 * Recorre el árbol en el orden en que se lee un reporte: el encabezado de cada
 * grupo, su contenido y, al cerrar, su subtotal. `nivel` es la profundidad
 * (0 = sucursal) y sirve para la sangría.
 */
export function aplanarEstructura<T>(grupos: GrupoEstructura<T>[], conSubtotales = true): EntradaEstructura<T>[] {
  const salida: EntradaEstructura<T>[] = [];
  const visitar = (g: GrupoEstructura<T>, nivel: number) => {
    salida.push({ tipo: "grupo", nivel, grupo: g });
    if (g.hijos.length) for (const h of g.hijos) visitar(h, nivel + 1);
    else for (const it of g.items) salida.push({ tipo: "detalle", nivel: nivel + 1, item: it });
    if (conSubtotales) salida.push({ tipo: "subtotal", nivel, grupo: g });
  };
  for (const g of grupos) visitar(g, 0);
  return salida;
}

/** Alcance de una planilla en palabras: «Toda la empresa» o «Sucursal / División / Departamento». */
export function describirAlcance(p: {
  sucursal?: { nombre: string } | null;
  division?: { nombre: string } | null;
  departamento?: { nombre: string } | null;
}): string {
  if (!p.sucursal) return "Toda la empresa";
  return [p.sucursal.nombre, p.division?.nombre, p.departamento?.nombre].filter(Boolean).join(" / ");
}

/** «Administración (PAGSA MAYOREO)», para distinguir departamentos homónimos en una lista. */
export function etiquetaDepartamento(d: { nombre: string; division?: { nombre: string } | null; sucursal?: { nombre: string } | null }): string {
  const contexto = [d.division?.nombre, d.sucursal?.nombre].filter(Boolean);
  return contexto.length ? `${d.nombre} (${contexto.join(", ")})` : d.nombre;
}
