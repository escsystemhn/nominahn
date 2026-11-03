/**
 * Quién puede seguir administrando accesos, y cuándo una baja cierra la cuenta.
 *
 * La cuenta de un empleado dado de baja deja de entrar. Se decide al iniciar sesión
 * y al revalidarla, no escribiendo en la cuenta, para que valga igual se le dé de
 * baja desde la ficha, una liquidación o una importación, y para que reincorporarlo
 * le devuelva el acceso sin tocar nada más.
 *
 * La única excepción es la última cuenta capaz de administrar accesos: cerrarla
 * dejaría la instalación sin salida, salvo tocar la base a mano.
 */

import { prisma } from "@/lib/prisma";
import { permisosEfectivos, tienePermiso } from "./permisos";
import { PERMISO_LLAVE } from "./politica-usuarios";

type UsuarioConPermisos = Parameters<typeof permisosEfectivos>[0];

/**
 * Otras cuentas activas que pueden administrar accesos, sin contar las de empleados
 * dados de baja, que ya no entrarían.
 *
 * Se cuenta sobre los permisos EFECTIVOS —perfil si lo hay, si no el mapa del
 * rol—, no sobre una columna: contar sólo los SUPER_ADMIN daría cero en una
 * instalación que ya reparte la administración por perfiles, y bloquearía
 * cambios perfectamente legítimos.
 */
export async function contarAdministradores(excluyendo: string): Promise<number> {
  const candidatos = await prisma.user.findMany({
    where: {
      activo: true,
      id: { not: excluyendo },
      OR: [{ empleado: { is: null } }, { empleado: { is: { estado: { not: "INACTIVO" } } } }],
    },
    select: { role: true, perfil: { select: { permisos: true, activo: true } } },
  });
  return candidatos.filter((u) => tienePermiso(permisosEfectivos(u), PERMISO_LLAVE)).length;
}

/** ¿Esta cuenta queda sin acceso porque su empleado está dado de baja? */
export async function cuentaCerradaPorBaja(
  usuario: UsuarioConPermisos & { id: string },
  estadoEmpleado: string | null | undefined
): Promise<boolean> {
  if (estadoEmpleado !== "INACTIVO") return false;
  if (!tienePermiso(permisosEfectivos(usuario), PERMISO_LLAVE)) return true;
  return (await contarAdministradores(usuario.id)) > 0;
}
