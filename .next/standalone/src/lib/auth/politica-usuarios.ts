/**
 * Reglas de seguridad de la administración de usuarios y perfiles.
 *
 * Son las que deciden si el módulo protege algo o sólo lo aparenta. Están aquí,
 * como funciones puras, y no repartidas por los handlers, porque cada una tiene
 * un caso límite concreto que hay que poder probar:
 *
 * · AUTO-ESCALADA: quien administra usuarios podría, sin la regla, crear un
 *   perfil con TODOS los permisos y asignárselo. Administrar cuentas se
 *   convertiría en administrarlo todo, por la puerta de atrás.
 *
 * · AUTO-BLOQUEO: desactivarse o quitarse el propio permiso deja a la persona
 *   fuera de la pantalla desde la que podría deshacerlo.
 *
 * · BLOQUEO TOTAL: si se desactiva o degrada al último administrador, la
 *   instalación queda sin nadie capaz de gestionar accesos. La única salida
 *   sería tocar la base a mano.
 */

import { tienePermiso, expandir, COMODIN } from "./permisos";

export type Veredicto = { ok: true } | { ok: false; motivo: string };

const PERMITIR: Veredicto = { ok: true };
const negar = (motivo: string): Veredicto => ({ ok: false, motivo });

/** Permiso sin el cual nadie puede volver a administrar accesos. */
export const PERMISO_LLAVE = "seguridad.usuarios_gestionar";

export interface Actor {
  id?: string;
  permisos?: string[];
}

/**
 * ¿Puede este actor conceder este conjunto de permisos?
 *
 * LA REGLA: nadie otorga lo que no tiene. Quien administra usuarios sólo puede
 * repartir permisos de su propio conjunto; para conceder algo más, alguien con
 * ese permiso tiene que dárselo antes.
 *
 * El comodín queda reservado a quien ya lo posee, para que no se pueda fabricar
 * un perfil «todo» desde un conjunto parcial.
 */
export function puedeOtorgar(actor: Actor, permisos: readonly string[]): Veredicto {
  const propios = actor.permisos ?? [];

  if (permisos.includes(COMODIN) && !propios.includes(COMODIN)) {
    return negar("No puede crear un perfil con acceso total.");
  }

  const excedidos = expandir(permisos).filter((p) => !tienePermiso(propios, p));
  if (excedidos.length > 0) {
    return negar(
      `No puede conceder permisos que usted no tiene: ${excedidos.slice(0, 3).join(", ")}` +
        (excedidos.length > 3 ? ` y ${excedidos.length - 3} más.` : ".")
    );
  }

  return PERMITIR;
}

export interface EstadoUsuario {
  id: string;
  activo: boolean;
  /** Permisos efectivos ACTUALES del usuario objetivo. */
  permisos: string[];
}

export interface CambioUsuario {
  activo?: boolean;
  /** Permisos efectivos que TENDRÍA tras el cambio. `undefined` = no cambian. */
  permisos?: string[];
}

/**
 * ¿Puede el actor aplicarse este cambio a sí mismo?
 *
 * Se prohíbe desactivarse y quedarse sin el permiso llave. Ambas cosas dejan a
 * la persona al otro lado de una puerta que acaba de cerrar; y si además era la
 * última con ese permiso, dejan al sistema entero fuera.
 */
export function cambioSobreSiMismo(actor: Actor, cambio: CambioUsuario): Veredicto {
  if (cambio.activo === false) {
    return negar("No puede desactivar su propia cuenta.");
  }
  if (cambio.permisos !== undefined && !tienePermiso(cambio.permisos, PERMISO_LLAVE)) {
    return negar(
      "No puede quitarse a sí mismo la gestión de usuarios: quedaría sin acceso a esta pantalla."
    );
  }
  return PERMITIR;
}

/**
 * ¿Deja este cambio a la instalación sin ningún administrador?
 *
 * `otrosAdministradores` es cuántas cuentas ACTIVAS Y DISTINTAS de la afectada
 * conservan el permiso llave. Si es cero y el cambio se lo quita a esta, nadie
 * queda para volver a concederlo.
 */
export function dejariaSinAdministrador(
  objetivo: EstadoUsuario,
  cambio: CambioUsuario,
  otrosAdministradores: number
): Veredicto {
  const eraAdministrador = objetivo.activo && tienePermiso(objetivo.permisos, PERMISO_LLAVE);
  if (!eraAdministrador || otrosAdministradores > 0) return PERMITIR;

  const seguiraActivo = cambio.activo ?? objetivo.activo;
  const conservaLlave = tienePermiso(cambio.permisos ?? objetivo.permisos, PERMISO_LLAVE);

  if (!seguiraActivo || !conservaLlave) {
    return negar(
      "Es la única cuenta activa que puede gestionar usuarios. Asigne antes ese permiso a otra persona."
    );
  }
  return PERMITIR;
}

/**
 * Comprobación completa de un cambio sobre un usuario. Es la que llaman las
 * rutas, para no tener que acordarse de encadenar las tres.
 */
export function validarCambioUsuario(
  actor: Actor,
  objetivo: EstadoUsuario,
  cambio: CambioUsuario,
  otrosAdministradores: number
): Veredicto {
  if (cambio.permisos !== undefined) {
    const otorga = puedeOtorgar(actor, cambio.permisos);
    if (!otorga.ok) return otorga;
  }

  // Reasignar a alguien que hoy tiene MÁS permisos que el actor equivale a
  // decidir sobre un acceso que no se controla; también se bloquea.
  const sobrepasa = expandir(objetivo.permisos).filter((p) => !tienePermiso(actor.permisos, p));
  if (sobrepasa.length > 0) {
    return negar("No puede modificar una cuenta con más permisos que la suya.");
  }

  if (actor.id && actor.id === objetivo.id) {
    const propio = cambioSobreSiMismo(actor, cambio);
    if (!propio.ok) return propio;
  }

  return dejariaSinAdministrador(objetivo, cambio, otrosAdministradores);
}

/**
 * ¿Se puede borrar este perfil?
 *
 * Los de sistema no, y ninguno con usuarios asignados: borrarlo los dejaría sin
 * permisos de golpe y sin rastro de por qué.
 */
export function puedeBorrarPerfil(perfil: {
  esSistema: boolean;
  usuariosAsignados: number;
}): Veredicto {
  if (perfil.esSistema) return negar("Los perfiles de sistema no se pueden eliminar.");
  if (perfil.usuariosAsignados > 0) {
    return negar(
      `Hay ${perfil.usuariosAsignados} usuario(s) con este perfil. Reasígnelos antes de eliminarlo.`
    );
  }
  return PERMITIR;
}
