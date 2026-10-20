import "next-auth";
import { UserRole, AlcanceDatos } from "@prisma/client";

/**
 * Datos de autorización que viajan en el token y llegan a la sesión.
 *
 * Los permisos van RESUELTOS (perfil si lo hay, si no el mapa del rol) en lugar
 * de guardar sólo `perfilId`: comprobar un permiso es la operación más frecuente
 * de la aplicación y así no cuesta una consulta por petición. La contrapartida
 * —que un cambio de permisos tarde en propagarse— ya estaba resuelta: el token
 * se revalida contra la base cada 5 minutos.
 */
interface DatosAutorizacion {
  role?: UserRole;
  empleadoId?: string | null;
  permisos?: string[];
  alcance?: AlcanceDatos | null;
  sucursalesIds?: string[] | null;
  /** Departamento del empleado vinculado; sostiene el alcance DEPARTAMENTO. */
  departamentoId?: string | null;
  /** Obliga a pasar por el cambio de contraseña antes de usar el sistema. */
  debeCambiarPassword?: boolean;
}

declare module "next-auth" {
  // La fusión de interfaces es justo el objetivo: añade los campos de
  // autorización al `User` de next-auth sin declarar miembros propios.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends DatosAutorizacion {}
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    } & DatosAutorizacion;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DatosAutorizacion {
    /** Epoch (ms) de la próxima revalidación del token contra la BD. */
    checasEn?: number;
  }
}
