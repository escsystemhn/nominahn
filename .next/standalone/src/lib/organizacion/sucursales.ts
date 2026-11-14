/**
 * Reglas de una sucursal, sin base de datos.
 *
 * Una sucursal no se borra: las planillas y marcajes ya emitidos cuelgan de ella.
 * Se DESACTIVA, lo que la retira de las pantallas donde se crea algo (empleados,
 * planillas, horarios) y la deja en las de consulta, para no perder el historial.
 */

import { claveNombre } from "./puestos";

const cuenta = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/**
 * Con empleados vigentes dejaría a esas personas fuera de planillas y horarios.
 * Sin otra activa, no quedaría dónde dar de alta a nadie.
 */
export function motivoParaNoDesactivarSucursal(uso: { empleadosVigentes: number; otrasActivas: number }): string | null {
  if (uso.empleadosVigentes > 0) {
    return `No se puede desactivar: tiene ${cuenta(uso.empleadosVigentes, "empleado", "empleados")}. Trasládelos o deles de baja primero.`;
  }
  if (uso.otrasActivas === 0) return "No se puede desactivar: es la única sucursal activa.";
  return null;
}

/**
 * La importación de empleados busca la sucursal por código o por nombre, así que
 * dos iguales en una empresa volverían ambigua esa búsqueda.
 */
export function motivoSucursalRepetida(
  sucursal: { nombre: string; codigo: string },
  otras: { nombre: string; codigo: string }[]
): string | null {
  if (otras.some((o) => claveNombre(o.nombre) === claveNombre(sucursal.nombre))) return `Ya existe una sucursal llamada «${sucursal.nombre}».`;
  if (otras.some((o) => claveNombre(o.codigo) === claveNombre(sucursal.codigo))) return `Ya existe una sucursal con el código «${sucursal.codigo}».`;
  return null;
}
