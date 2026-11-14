/**
 * Dónde se crea un departamento nuevo: en una empresa, en todas o en las que se
 * elijan, dentro de un grupo o en todos.
 *
 * Cada destino es una fila aparte en `Departamento`, a propósito: la empresa de
 * una persona sale de su departamento, y de ahí dependen su planilla, su RTN y lo
 * que se imprime por empresa. Un «Ventas» compartido mezclaría las nóminas.
 *
 * Con jerarquía, sucursal = grupo de nómina y división = empresa. Un grupo sin
 * empresas activas (o con las divisiones apagadas) recibe el departamento
 * directo, como lo acepta `validarDivisionDeDepartamento`.
 */

import { enumerar } from "@/lib/horarios/fechas";
import { claveNombre } from "./puestos";

export interface LugarDepartamento {
  sucursalId: string;
  divisionId: string | null;
}

/** Una empresa, todas, o las que se marquen. */
export type AlcanceDepartamento = "una" | "todas" | "elegir";

export const claveLugar = (l: LugarDepartamento) => `${l.sucursalId}|${l.divisionId ?? ""}`;

/**
 * Todos los lugares donde puede crearse un departamento: cada división activa de
 * cada sucursal activa y, si la sucursal no tiene divisiones activas, la sucursal
 * misma. `divisiones` va vacío cuando el nivel División está apagado. Con
 * `sucursalId`, sólo los de esa sucursal. Respeta el orden recibido.
 */
export function lugaresParaDepartamento(
  sucursales: readonly { id: string; activa: boolean }[],
  divisiones: readonly { id: string; sucursalId: string; activa: boolean }[],
  sucursalId?: string
): LugarDepartamento[] {
  const lugares: LugarDepartamento[] = [];
  for (const s of sucursales) {
    if (!s.activa || (sucursalId && s.id !== sucursalId)) continue;
    const propias = divisiones.filter((v) => v.sucursalId === s.id && v.activa);
    if (propias.length === 0) lugares.push({ sucursalId: s.id, divisionId: null });
    else for (const v of propias) lugares.push({ sucursalId: s.id, divisionId: v.id });
  }
  return lugares;
}

/**
 * Qué lugares todavía no tienen un departamento con ese nombre (`crear`) y cuáles
 * ya lo tienen, activo o no (`omitir`). Sin acentos ni mayúsculas, como el resto
 * de la estructura: no debe quedar «Administracion» junto a «Administración».
 * Un lugar repetido cuenta una sola vez.
 */
export function lugaresSinDepartamento(
  nombre: string,
  lugares: readonly LugarDepartamento[],
  existentes: readonly { nombre: string; sucursalId: string; divisionId: string | null }[]
): { crear: LugarDepartamento[]; omitir: LugarDepartamento[] } {
  const clave = claveNombre(nombre);
  const ocupados = new Set(existentes.filter((d) => clave && claveNombre(d.nombre) === clave).map(claveLugar));
  const vistos = new Set<string>();
  const crear: LugarDepartamento[] = [];
  const omitir: LugarDepartamento[] = [];
  for (const l of lugares) {
    const k = claveLugar(l);
    if (vistos.has(k)) continue;
    vistos.add(k);
    (ocupados.has(k) ? omitir : crear).push({ sucursalId: l.sucursalId, divisionId: l.divisionId });
  }
  return { crear, omitir };
}

export interface NombresEstructura {
  sucursal: ReadonlyMap<string, string>;
  division: ReadonlyMap<string, string>;
}

/** Palabras de cada nivel: «grupo»/«grupos», «empresa»/«empresas», o «sucursal», «división»… */
export interface PalabrasNivel {
  sucursal: string;
  sucursales: string;
  division: string;
  divisiones: string;
}

/** «Tegucigalpa» si la sucursal tiene divisiones; si no, el nombre de la sucursal. */
function nombreLugar(l: LugarDepartamento, n: NombresEstructura): string {
  return l.divisionId ? (n.division.get(l.divisionId) ?? "?") : (n.sucursal.get(l.sucursalId) ?? "?");
}

/**
 * Los lugares en una frase, agrupados por sucursal cuando hay varias:
 * · uno: «Grupo PAGSA / Tegucigalpa»
 * · varios de un grupo: «las 6 empresas de Grupo PAGSA: San Pedro Sula, …»
 * · varios grupos: «3 grupos: Grupo PAGSA (6 empresas), Confidencial (4 empresas) y PRASA»
 */
export function describirLugares(lugares: readonly LugarDepartamento[], n: NombresEstructura, p: PalabrasNivel, todas = false): string {
  if (lugares.length === 0) return "";
  const porSucursal = new Map<string, LugarDepartamento[]>();
  for (const l of lugares) porSucursal.set(l.sucursalId, [...(porSucursal.get(l.sucursalId) ?? []), l]);
  const grupos = [...porSucursal];

  if (grupos.length === 1) {
    const [sucursalId, propios] = grupos[0];
    const sucursal = n.sucursal.get(sucursalId) ?? "?";
    const conDivision = propios.filter((l) => l.divisionId);
    if (conDivision.length === 0) return sucursal;
    if (propios.length === 1) return `${sucursal} / ${nombreLugar(propios[0], n)}`;
    const cuantas = `${todas ? "las " : ""}${propios.length} ${p.divisiones}`;
    return `${cuantas} de ${sucursal}: ${enumerar(propios.map((l) => nombreLugar(l, n)))}`;
  }

  const partes = grupos.map(([sucursalId, propios]) => {
    const sucursal = n.sucursal.get(sucursalId) ?? "?";
    const conDivision = propios.filter((l) => l.divisionId).length;
    if (conDivision === 0) return sucursal;
    if (conDivision === 1) return `${sucursal} (${nombreLugar(propios.find((l) => l.divisionId)!, n)})`;
    return `${sucursal} (${conDivision} ${p.divisiones})`;
  });
  return `${grupos.length} ${p.sucursales}: ${enumerar(partes)}`;
}

/** El aviso al terminar: dónde se creó y, si algo se saltó, dónde ya existía. */
export function mensajeCreacion(
  nombre: string,
  creados: readonly LugarDepartamento[],
  omitidos: readonly LugarDepartamento[],
  n: NombresEstructura,
  p: PalabrasNivel,
  todas = false
): string {
  const titulo = `«${nombre.trim()}»`;
  const donde = describirLugares(creados, n, p, todas && omitidos.length === 0);
  const ya = omitidos.length ? ` Ya existía en ${enumerar(omitidos.map((l) => nombreLugar(l, n)))}, y ahí no se tocó.` : "";
  return `Se creó ${titulo} en ${donde}.${ya}`;
}
