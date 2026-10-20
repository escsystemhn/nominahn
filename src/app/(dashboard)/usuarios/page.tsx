import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import UsuariosClient from "@/components/seguridad/UsuariosClient";

/**
 * Cuentas de acceso al sistema.
 *
 * Sólo se cargan aquí los datos que la pantalla necesita: nunca el hash de la
 * contraseña, ni siquiera para descartarlo después en el cliente.
 */
export default async function UsuariosPage() {
  const usuario = await requerirPermisoPagina(["seguridad.usuarios_ver", "seguridad.usuarios_gestionar"]);

  const [usuarios, perfiles, sucursales, empleadosSinCuenta] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        activo: true,
        debeCambiarPassword: true,
        ultimoAcceso: true,
        createdAt: true,
        sucursalesIds: true,
        perfil: { select: { id: true, nombre: true, alcance: true, activo: true } },
        empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
      },
      orderBy: [{ activo: "desc" }, { name: "asc" }],
    }),
    prisma.perfilAcceso.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, alcance: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.sucursal.findMany({
      where: { activa: true },
      select: { id: true, nombre: true, codigo: true },
      orderBy: { nombre: "asc" },
    }),
    // Sólo los que aún no tienen cuenta: ofrecer los demás llevaría a un 409 al
    // guardar, porque la relación empleado↔usuario es uno a uno.
    prisma.empleado.findMany({
      where: { userId: null, estado: "ACTIVO" },
      select: { id: true, codigo: true, primerNombre: true, primerApellido: true },
      orderBy: { primerApellido: "asc" },
      take: 500,
    }),
  ]);

  return (
    <UsuariosClient
      usuarios={usuarios.map((u) => ({
        ...u,
        ultimoAcceso: u.ultimoAcceso?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      }))}
      perfiles={perfiles}
      sucursales={sucursales}
      empleadosSinCuenta={empleadosSinCuenta}
      usuarioActualId={usuario.id ?? ""}
      puedeGestionar={puede(usuario, "seguridad.usuarios_gestionar")}
      puedeResetear={puede(usuario, "seguridad.usuarios_password")}
      puedeVerPerfiles={puede(usuario, "seguridad.perfiles")}
    />
  );
}
