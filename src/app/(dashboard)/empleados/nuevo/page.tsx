import { prisma } from "@/lib/prisma";
import NuevoEmpleadoForm from "@/components/employees/NuevoEmpleadoForm";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

export default async function NuevoEmpleadoPage() {
  await requerirPermisoPagina("empleados.crear");
  const conDivisiones = await divisionesHabilitadas(prisma);

  const [sucursales, divisiones, departamentos, puestos] = await Promise.all([
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? prisma.division.findMany({ where: { activa: true }, select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true, sucursalId: true, divisionId: true }, orderBy: { nombre: "asc" } }),
    prisma.puesto.findMany({ where: { activo: true }, select: { id: true, nombre: true, departamentoId: true }, orderBy: { nombre: "asc" } }),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Nuevo empleado</h1>
        <p className="text-sm text-gray-500">Complete la información del nuevo empleado</p>
      </div>
      <NuevoEmpleadoForm
        sucursales={sucursales}
        divisiones={divisiones}
        departamentos={departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null }))}
        puestos={puestos}
      />
    </div>
  );
}
