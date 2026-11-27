import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import DotacionesClient from "@/components/employees/DotacionesClient";

export default async function DotacionesPage() {
  const usuario = await requerirPermisoPagina("talento.dotaciones");

  // Los empleados ya no se cargan aquí (2026-11-27): «Asignar artículo» los busca en el servidor
  // (`/api/empleados/buscar?para=dotaciones`), activos y del mismo alcance.
  const articulos = await prisma.articuloDotacion.findMany({ orderBy: [{ activo: "desc" }, { nombre: "asc" }] });

  return (
    <DotacionesClient
      articulos={articulos}
      puedeGestionar={puede(usuario, "talento.dotaciones_gestionar")}
    />
  );
}
