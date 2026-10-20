import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import ReclutamientoClient from "@/components/employees/ReclutamientoClient";

export default async function ReclutamientoPage() {
  const usuario = await requerirPermisoPagina("talento.reclutamiento");

  const departamentos = await prisma.departamento.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });

  return (
    <ReclutamientoClient
      departamentos={departamentos}
      puedeGestionar={puede(usuario, "talento.reclutamiento_gestionar")}
    />
  );
}
