import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import UsuariosClient from "@/components/seguridad/UsuariosClient";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { nombreCompleto } from "@/lib/utils";

/**
 * Cuentas de acceso al sistema.
 *
 * Sólo se cargan aquí los datos que la pantalla necesita: nunca el hash de la
 * contraseña, ni siquiera para descartarlo después en el cliente.
 */
export default async function UsuariosPage() {
  const usuario = await requerirPermisoPagina(["seguridad.usuarios_ver", "seguridad.usuarios_gestionar"]);
  // La foto la sirve una ruta que pide permiso sobre empleados: sin él saldría rota.
  const veFotos = puede(usuario, "empleados.ver");

  const [usuarios, perfiles, sucursales, jerarquia] = await Promise.all([
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
        empleado: {
          select: {
            id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, estado: true,
            emailCorporativo: true,
            puesto: { select: { nombre: true } },
            departamento: { select: { nombre: true, division: { select: { nombre: true } } } },
            sucursal: { select: { nombre: true } },
            foto: { select: { updatedAt: true } },
          },
        },
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
    jerarquiaNominaHabilitada(prisma),
  ]);

  return (
    <UsuariosClient
      usuarios={usuarios.map(({ empleado: e, ...u }) => ({
        ...u,
        ultimoAcceso: u.ultimoAcceso?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        // Los empleados para vincular se buscan en /api/usuarios/empleados-vinculables;
        // aquí sólo va el ya vinculado, para mostrar su tarjeta al editar.
        empleado: e && {
          id: e.id, codigo: e.codigo, primerNombre: e.primerNombre, primerApellido: e.primerApellido, estado: e.estado,
          buscado: {
            id: e.id, codigo: e.codigo, nombre: nombreCompleto(e), puesto: e.puesto?.nombre ?? null,
            departamento: e.departamento.nombre, lugar: e.departamento.division?.nombre ?? e.sucursal.nombre,
            correo: e.emailCorporativo, foto: veFotos ? (e.foto?.updatedAt.getTime() ?? null) : null,
          },
        },
      }))}
      perfiles={perfiles}
      sucursales={sucursales}
      usuarioActualId={usuario.id ?? ""}
      puedeGestionar={puede(usuario, "seguridad.usuarios_gestionar")}
      puedeResetear={puede(usuario, "seguridad.usuarios_password")}
      puedeVerPerfiles={puede(usuario, "seguridad.perfiles")}
      niveles={etiquetasNiveles(jerarquia)}
    />
  );
}
