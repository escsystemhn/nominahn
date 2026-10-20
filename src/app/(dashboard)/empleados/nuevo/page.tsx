import { prisma } from "@/lib/prisma";
import NuevoEmpleadoForm from "@/components/employees/NuevoEmpleadoForm";
import { requerirPermisoPagina } from "@/lib/auth/guard";

export default async function NuevoEmpleadoPage() {
  await requerirPermisoPagina("empleados.crear");

  const [sucursales, departamentos, puestos] = await Promise.all([
    prisma.sucursal.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } }),
    prisma.departamento.findMany({ where: { activo: true }, include: { sucursal: true }, orderBy: { nombre: "asc" } }),
    prisma.puesto.findMany({ where: { activo: true }, select: { id: true, nombre: true, departamentoId: true }, orderBy: { nombre: "asc" } }),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Nuevo empleado</h1>
        <p className="text-sm text-gray-500">Complete la información del nuevo empleado</p>
      </div>
      <NuevoEmpleadoForm sucursales={sucursales} departamentos={departamentos} puestos={puestos} />
    </div>
  );
}
