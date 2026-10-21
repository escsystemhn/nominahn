import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import ReclutamientoClient from "@/components/employees/ReclutamientoClient";
import { etiquetaDepartamento } from "@/lib/organizacion/estructura";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

export default async function ReclutamientoPage() {
  const usuario = await requerirPermisoPagina("talento.reclutamiento");

  const conDivisiones = await divisionesHabilitadas(prisma);
  // Con el nombre solo no se distinguen dos «Administración» de sucursales o divisiones distintas.
  const departamentos = await prisma.departamento.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, sucursal: { select: { nombre: true } }, division: { select: { nombre: true } } },
    orderBy: { nombre: "asc" },
  });

  return (
    <ReclutamientoClient
      departamentos={departamentos.map((d) => ({ id: d.id, nombre: etiquetaDepartamento({ ...d, division: conDivisiones ? d.division : null }) }))}
      puedeGestionar={puede(usuario, "talento.reclutamiento_gestionar")}
    />
  );
}
