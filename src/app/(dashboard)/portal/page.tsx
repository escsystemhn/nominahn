import { prisma } from "@/lib/prisma";
import PortalClient from "@/components/portal/PortalClient";

export default async function PortalPage() {
  // Sin lista de empleados para «Autor»: la API publica a nombre del usuario de la sesión.
  const [posts, anuncios, contactos] = await Promise.all([
    prisma.portalPost.findMany({
      where: { activo: true },
      include: { autor: { select: { primerNombre: true, primerApellido: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.anuncio.findMany({
      where: { activo: true },
      include: { autor: { select: { primerNombre: true, primerApellido: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.contactoRRHH.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
  ]);

  return <PortalClient posts={posts} anuncios={anuncios} contactos={contactos} />;
}
