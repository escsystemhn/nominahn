import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { construirOrganigrama } from "@/lib/organizacion/organigrama";
import OrganigramaClient from "@/components/organizacion/OrganigramaClient";

/**
 * El árbol se construye llamando a la función compartida, no pidiéndoselo a la
 * propia API por HTTP.
 *
 * La versión anterior hacía `fetch` contra `/api/organigrama` reenviando la
 * cookie. Funcionaba en el portátil y fallaba en cuanto la cabecera `host` no
 * resolvía internamente, y sobre todo convertía cualquier error —un campo que
 * Prisma no reconoce, por ejemplo— en un «no se pudo cargar, vuelva a
 * intentarlo» que no decía nada. Ahora un fallo sube con su mensaje y aparece
 * en el log del servidor como lo que es.
 */
export default async function OrganigramaPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursalId?: string }>;
}) {
  const usuario = await requerirPermisoPagina("organizacion.ver");
  const sp = await searchParams;

  const [organigrama, sucursales] = await Promise.all([
    construirOrganigrama(usuario, { sucursalId: sp.sucursalId }),
    prisma.sucursal.findMany({
      where: { activa: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
  ]);

  return (
    <OrganigramaClient
      raices={organigrama.raices}
      enCiclo={organigrama.enCiclo}
      huerfanos={organigrama.huerfanos}
      totales={organigrama.totales}
      vacantesPorDepartamento={organigrama.vacantesPorDepartamento}
      puedeReasignar={organigrama.puedeReasignar}
      vePII={organigrama.vePII}
      sucursales={sucursales}
      sucursalActiva={sp.sucursalId}
    />
  );
}
