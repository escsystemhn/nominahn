/**
 * Alcance de datos sobre las marcas del reloj.
 *
 * `filtroPorEmpleado` no basta aquí: una marca en cuarentena todavía no tiene dueño
 * (`empleadoId` es null), así que ese filtro se la ocultaría a toda cuenta limitada y
 * nadie de la sucursal podría conciliar su propio reloj. Sin dueño, la única pista de
 * a quién pertenece es el equipo que la reportó.
 *
 * Esa pista sólo le sirve al alcance SUCURSAL, y sólo con un equipo asignado a una de
 * sus sucursales. Un reloj sin sucursal («Todas») puede traer marcas de cualquiera, y
 * una cuenta de departamento o de expediente propio no puede saber si un PIN sin dueño
 * es de los suyos. En esos casos se cierra, con el mismo criterio que `filtroEmpleados`:
 * equivocarse hacia cero filas es recuperable.
 */

import type { Prisma } from "@prisma/client";
import { alcanceEsTotal, filtroPorEmpleado, type UsuarioConAlcance } from "@/lib/auth/alcance";

function sucursalesDeSusEquipos(usuario: UsuarioConAlcance): string[] {
  return usuario.alcance === "SUCURSAL" ? (usuario.sucursalesIds ?? []) : [];
}

/** ¿Puede esta cuenta conciliar las marcas sin dueño de este equipo? */
export function alcanzaDispositivo(usuario: UsuarioConAlcance, dispositivo: { sucursalId: string | null }): boolean {
  if (alcanceEsTotal(usuario)) return true;
  return !!dispositivo.sucursalId && sucursalesDeSusEquipos(usuario).includes(dispositivo.sucursalId);
}

/**
 * Los equipos que esta cuenta puede ver y administrar. Un reloj sin sucursal es de toda
 * la empresa: borrarlo se lleva las marcas de todas, así que sólo lo toca el alcance total.
 */
export function filtroDispositivos(usuario: UsuarioConAlcance): Prisma.DispositivoBiometricoWhereInput {
  if (alcanceEsTotal(usuario)) return {};
  return { sucursalId: { in: sucursalesDeSusEquipos(usuario) } };
}

/**
 * Marcas que esta cuenta puede ver: las de empleados a su alcance, y las que aún no
 * tienen dueño si vienen de un equipo de sus sucursales. Se combina con el `where` de
 * la consulta mediante `AND`, como el resto de los filtros de alcance.
 */
export function filtroEventos(usuario: UsuarioConAlcance): Prisma.MarcajeEventoWhereInput {
  const deSusEmpleados = filtroPorEmpleado(usuario);
  const sucursales = sucursalesDeSusEquipos(usuario);
  if (sucursales.length === 0) return deSusEmpleados;
  return { OR: [deSusEmpleados, { empleadoId: null, dispositivo: { sucursalId: { in: sucursales } } }] };
}
