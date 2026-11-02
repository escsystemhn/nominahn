/**
 * Catálogo de puestos: las reglas, sin base de datos.
 *
 * Un puesto cuelga de un departamento, y el departamento de una sucursal. El
 * mismo nombre puede repetirse entre departamentos, no dentro de uno: la
 * importación de empleados busca el puesto por departamento y nombre, y dos
 * iguales volverían ambigua esa búsqueda.
 *
 * Un puesto en uso no se borra, se DESACTIVA: deja de ofrecerse al asignar y
 * quien ya lo tiene lo conserva. Borrarlo dejaría a esas personas sin puesto y
 * se llevaría sin aviso su cobertura de horarios, que está en cascada.
 */

import { enumerar } from "@/lib/horarios/fechas";

export interface UsoPuesto {
  empleados: number;
  competencias: number;
  coberturas: number;
}

const cuenta = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/** Sin espacios de más: «Jefe  de RRHH » se guarda «Jefe de RRHH». */
export function limpiarNombrePuesto(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ");
}

/** Clave para comparar nombres: sin acentos, mayúsculas ni espacios de más. */
export function claveNombre(nombre: string): string {
  return limpiarNombrePuesto(nombre)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** ¿Ya hay otro puesto con ese nombre en la lista? `exceptoId` permite renombrar el propio. */
export function nombreRepetido(nombre: string, existentes: { id: string; nombre: string }[], exceptoId?: string): boolean {
  const clave = claveNombre(nombre);
  return existentes.some((p) => p.id !== exceptoId && claveNombre(p.nombre) === clave);
}

/**
 * Para los horarios, los puestos que se llaman igual son uno solo: id de cada
 * puesto → id del que representa a todos los de su nombre.
 *
 * Un puesto cuelga de un departamento y el departamento de una sola sucursal,
 * así que el «Cajero» de dos sucursales son dos registros. El generador sólo
 * presta personal entre quienes tienen el mismo puesto: comparando registros,
 * ningún traslado era posible. El representante es siempre el mismo (el id
 * menor) para que generar y validar un plan coincidan.
 */
export function unificarPuestosPorNombre(puestos: { id: string; nombre: string }[]): Map<string, string> {
  const representante = new Map<string, string>();
  for (const p of puestos) {
    const clave = claveNombre(p.nombre);
    const actual = representante.get(clave);
    if (actual === undefined || p.id < actual) representante.set(clave, p.id);
  }
  return new Map(puestos.map((p) => [p.id, representante.get(claveNombre(p.nombre))!]));
}

/** Los puestos del origen que al destino le faltan, para copiar un departamento sin duplicar nombres. */
export function puestosPorCopiar<T extends { nombre: string }>(origen: T[], destino: { nombre: string }[]): T[] {
  const yaEstan = new Set(destino.map((p) => claveNombre(p.nombre)));
  return origen.filter((p) => {
    const clave = claveNombre(p.nombre);
    if (yaEstan.has(clave)) return false;
    yaEstan.add(clave);
    return true;
  });
}

/** El rango es opcional: 0 significa «sin definir» y sólo se compara si están los dos. */
export function rangoSalarialValido(minimo: number, maximo: number): boolean {
  return minimo <= 0 || maximo <= 0 || minimo <= maximo;
}

export function motivoParaNoEliminar(uso: UsoPuesto): string | null {
  const partes = [
    uso.empleados > 0 ? cuenta(uso.empleados, "empleado", "empleados") : null,
    uso.competencias > 0 ? cuenta(uso.competencias, "competencia asignada", "competencias asignadas") : null,
    uso.coberturas > 0 ? cuenta(uso.coberturas, "regla de cobertura de horarios", "reglas de cobertura de horarios") : null,
  ].filter((p): p is string => p !== null);
  return partes.length ? `No se puede eliminar: tiene ${enumerar(partes)}. Desactívelo para retirarlo de las listas.` : null;
}

/** Mover el puesto dejaría a su gente en un departamento distinto del de su ficha, y su cobertura en otra sucursal. */
export function motivoParaNoMover(uso: UsoPuesto): string | null {
  if (uso.empleados > 0) return `No se puede cambiar de departamento: tiene ${cuenta(uso.empleados, "empleado", "empleados")}.`;
  if (uso.coberturas > 0) return "No se puede cambiar de departamento: tiene cobertura de horarios. Quítela primero en Horarios y turnos.";
  return null;
}

/**
 * Desactivar con cobertura vigente dejaría un mínimo de personal imposible de
 * cubrir y de corregir: la pantalla de cobertura sólo ofrece puestos activos.
 */
export function motivoParaNoDesactivar(coberturasActivas: number): string | null {
  return coberturasActivas > 0
    ? `No se puede desactivar: ${cuenta(coberturasActivas, "regla de cobertura de horarios lo exige", "reglas de cobertura de horarios lo exigen")}. Quítelas primero en Horarios y turnos.`
    : null;
}
