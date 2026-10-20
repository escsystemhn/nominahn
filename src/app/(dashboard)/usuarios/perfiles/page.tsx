import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { CATALOGO, expandir } from "@/lib/auth/permisos";
import PerfilesClient from "@/components/seguridad/PerfilesClient";

/**
 * Perfiles de acceso: qué puede hacer cada grupo de usuarios y sobre qué datos.
 *
 * Se envían al cliente los permisos EFECTIVOS de quien entra (con los comodines
 * ya expandidos) para que la matriz deshabilite las casillas que esa persona no
 * podría conceder. La comprobación real la hace la API —`puedeOtorgar`—, pero
 * ofrecer casillas que van a devolver 403 sólo confunde.
 */
export default async function PerfilesPage() {
  const usuario = await requerirPermisoPagina("seguridad.perfiles");

  const perfiles = await prisma.perfilAcceso.findMany({
    orderBy: [{ esSistema: "desc" }, { nombre: "asc" }],
    include: { _count: { select: { usuarios: true } } },
  });

  return (
    <PerfilesClient
      perfiles={perfiles.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion,
        permisos: p.permisos,
        alcance: p.alcance,
        esSistema: p.esSistema,
        activo: p.activo,
        usuariosAsignados: p._count.usuarios,
      }))}
      catalogo={CATALOGO.map((m) => ({
        modulo: m.modulo,
        etiqueta: m.etiqueta,
        descripcion: m.descripcion,
        permisos: m.permisos.map((p) => ({
          codigo: p.codigo,
          etiqueta: p.etiqueta,
          descripcion: p.descripcion,
          sensible: "sensible" in p ? p.sensible : false,
        })),
      }))}
      permisosDelActor={expandir(usuario.permisos)}
    />
  );
}
