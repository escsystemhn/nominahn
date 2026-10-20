import { prisma } from "@/lib/prisma";
import PortalClient from "@/components/portal/PortalClient";

export default async function PortalPage() {
  const [posts, anuncios, contactos, empleados] = await Promise.all([
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
    prisma.empleado.findMany({
      where: { estado: "ACTIVO" },
      select: { id: true, codigo: true, primerNombre: true, primerApellido: true },
      take: 5,
    }),
  ]);

  return <PortalClient posts={posts} anuncios={anuncios} contactos={contactos} empleados={empleados} />;
}
