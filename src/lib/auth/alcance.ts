/**
 * Alcance de datos: sobre QUIÉNES puede actuar un usuario.
 *
 * POR QUÉ ES UN EJE APARTE: los permisos de `permisos.ts` responden a "¿qué
 * acciones puede ejecutar?". Este módulo responde a "¿sobre qué filas?". Hasta
 * ahora sólo existía el primero, y por eso un supervisor de una sucursal veía la
 * plantilla de las tres: el menú lateral le ocultaba enlaces, pero
 * `GET /api/empleados` le devolvía todo.
 *
 * La pieza clave es `filtroEmpleados()`, que produce un `where` de Prisma. Se
 * COMBINA con el `where` propio de cada consulta mediante `AND`, nunca se
 * sustituye: si alguien lo sobrescribiera, el alcance desaparecería sin que
 * ningún test lo note.
 *
 * FALLO SEGURO: cuando el alcance exige un dato que no tenemos (un usuario con
 * alcance SUCURSAL sin sucursales asignadas, o alcance PROPIO sin empleado
 * vinculado), el filtro no devuelve "todo": devuelve un predicado imposible.
 * Equivocarse hacia cero filas es recuperable; hacia todas las filas, no.
 */

import type { Prisma, AlcanceDatos } from "@prisma/client";

export interface UsuarioConAlcance {
  alcance?: AlcanceDatos | null;
  /** Sucursales asignadas cuando el alcance es SUCURSAL. */
  sucursalesIds?: string[] | null;
  /** Empleado vinculado a la cuenta. Necesario para DEPARTAMENTO y PROPIO. */
  empleadoId?: string | null;
  /** Departamento del empleado vinculado. Se sella en el token al iniciar sesión. */
  departamentoId?: string | null;
}

/**
 * Predicado que no puede cumplir ninguna fila. `id: { in: [] }` es más explícito
 * que un `AND` contradictorio y Postgres lo resuelve sin tocar la tabla.
 */
const NINGUNA: Prisma.EmpleadoWhereInput = { id: { in: [] } };

/** ¿El alcance permite ver a toda la empresa? Útil para decidir si mostrar filtros. */
export function alcanceEsTotal(usuario: UsuarioConAlcance): boolean {
  return (usuario.alcance ?? "TODO") === "TODO";
}

/**
 * Filtro de empleados según el alcance del usuario.
 *
 * Devuelve `{}` sólo para alcance TODO. Cualquier otro caso acota, y si no puede
 * acotar con seguridad, cierra.
 */
export function filtroEmpleados(usuario: UsuarioConAlcance): Prisma.EmpleadoWhereInput {
  switch (usuario.alcance ?? "TODO") {
    case "TODO":
      return {};

    case "SUCURSAL": {
      const ids = usuario.sucursalesIds ?? [];
      // Sin sucursales asignadas no hay nada que ver. Devolver `{}` aquí sería
      // convertir "no le asignaron sucursales" en "puede verlas todas".
      if (ids.length === 0) return NINGUNA;
      return { sucursalId: { in: ids } };
    }

    case "DEPARTAMENTO": {
      if (!usuario.departamentoId) return NINGUNA;
      return { departamentoId: usuario.departamentoId };
    }

    case "PROPIO": {
      if (!usuario.empleadoId) return NINGUNA;
      return { id: usuario.empleadoId };
    }

    default:
      return NINGUNA;
  }
}

/**
 * El mismo filtro, expresado sobre entidades que cuelgan de un empleado
 * (DeduccionEmpleado, Marcaje, Permiso, PlanillaDetalle…).
 */
export function filtroPorEmpleado(usuario: UsuarioConAlcance): { empleado?: Prisma.EmpleadoWhereInput } {
  const filtro = filtroEmpleados(usuario);
  return Object.keys(filtro).length === 0 ? {} : { empleado: filtro };
}

/**
 * Combina el `where` de una consulta con el alcance del usuario.
 *
 * Se usa así en vez de fusionar las claves a mano porque un `where` con `OR` de
 * búsqueda fusionado ingenuamente puede ANULAR la restricción de sucursal: el
 * `AND` explícito garantiza que ambas condiciones se cumplen a la vez.
 */
export function conAlcance(
  where: Prisma.EmpleadoWhereInput,
  usuario: UsuarioConAlcance
): Prisma.EmpleadoWhereInput {
  const filtro = filtroEmpleados(usuario);
  if (Object.keys(filtro).length === 0) return where;
  return { AND: [where, filtro] };
}

/**
 * ¿Este usuario alcanza a este empleado concreto?
 *
 * Para las rutas que actúan sobre un único registro (`/api/empleados/[id]`),
 * donde la comprobación no es un `where` sino un sí/no antes de responder 404.
 * Se responde 404 y no 403 a propósito: un 403 confirmaría que el empleado
 * existe en otra sucursal, que es justo lo que el alcance intenta no revelar.
 */
export function alcanzaEmpleado(
  usuario: UsuarioConAlcance,
  empleado: { id: string; sucursalId: string; departamentoId: string }
): boolean {
  switch (usuario.alcance ?? "TODO") {
    case "TODO":
      return true;
    case "SUCURSAL":
      return (usuario.sucursalesIds ?? []).includes(empleado.sucursalId);
    case "DEPARTAMENTO":
      return !!usuario.departamentoId && usuario.departamentoId === empleado.departamentoId;
    case "PROPIO":
      return !!usuario.empleadoId && usuario.empleadoId === empleado.id;
    default:
      return false;
  }
}

/** Etiquetas para la interfaz de perfiles. */
export const ETIQUETAS_ALCANCE: Record<AlcanceDatos, { titulo: string; detalle: string }> = {
  TODO: {
    titulo: "Toda la empresa",
    detalle: "Ve y actúa sobre el personal de todas las sucursales.",
  },
  SUCURSAL: {
    titulo: "Sus sucursales",
    detalle: "Sólo el personal de las sucursales que se le asignen en su cuenta.",
  },
  DEPARTAMENTO: {
    titulo: "Su departamento",
    detalle: "Sólo el personal del departamento del empleado vinculado a la cuenta.",
  },
  PROPIO: {
    titulo: "Sólo su expediente",
    detalle: "Únicamente sus propios datos. Pensado para cuentas de autoservicio.",
  },
};
