import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import CapacitacionesClient from "@/components/employees/CapacitacionesClient";

export default async function CapacitacionesPage() {
  const usuario = await requerirPermisoPagina("talento.capacitaciones");

  const empleados = await prisma.empleado.findMany({
    where: { estado: "ACTIVO" },
    select: { id: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, codigo: true },
    orderBy: { primerApellido: "asc" },
  });
  const empleadosOpts = empleados.map((e) => ({ id: e.id, nombre: `${e.codigo} · ${nombreCompleto(e)}` }));

  return (
    <CapacitacionesClient
      empleados={empleadosOpts}
      puedeGestionar={puede(usuario, "talento.capacitaciones_gestionar")}
    />
  );
}
