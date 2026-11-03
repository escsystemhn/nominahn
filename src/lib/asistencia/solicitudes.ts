import type { Prisma } from "@prisma/client";
import { alcanceEsTotal, type UsuarioConAlcance } from "@/lib/auth/alcance";

/**
 * Qué solicitudes de permiso le corresponde resolver a esta cuenta: con alcance total,
 * todas las pendientes; con cualquier alcance más estrecho, sólo las de su equipo directo.
 *
 * Se conserva además el criterio por rol para las cuentas SIN perfil: un gerente heredado
 * tiene alcance TODO por omisión, y sin esta segunda condición pasaría de ver su equipo a
 * ver toda la empresa.
 *
 * Quien responde por un equipo pero no tiene empleado vinculado no tiene equipo: no ve
 * ninguna, igual que al aprobar, donde se le rechazaría.
 */
export function permisosPorResolver(usuario: UsuarioConAlcance & { role?: string | null }): Prisma.PermisoWhereInput {
  const soloEquipo = !alcanceEsTotal(usuario) || usuario.role === "GERENTE" || usuario.role === "SUPERVISOR";
  if (!soloEquipo) return { estado: "PENDIENTE" };
  if (!usuario.empleadoId) return { id: { in: [] } };
  return { estado: "PENDIENTE", empleado: { supervisorId: usuario.empleadoId } };
}
