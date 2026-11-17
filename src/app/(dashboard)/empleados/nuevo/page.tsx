import { prisma } from "@/lib/prisma";
import { filtroSucursales } from "@/lib/auth/alcance";
import NuevoEmpleadoForm from "@/components/employees/NuevoEmpleadoForm";
import PageHeader from "@/components/ui/PageHeader";
import { puede, requerirPermisoPagina } from "@/lib/auth/guard";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";

export default async function NuevoEmpleadoPage() {
  const usuario = await requerirPermisoPagina("empleados.crear");
  const [conDivisiones, conJerarquia] = await Promise.all([divisionesHabilitadas(prisma), jerarquiaNominaHabilitada(prisma)]);

  const [sucursales, divisiones, departamentos, puestos] = await Promise.all([
    prisma.sucursal.findMany({ where: { activa: true, ...filtroSucursales(usuario) }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? prisma.division.findMany({ where: { activa: true }, select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true, sucursalId: true, divisionId: true }, orderBy: { nombre: "asc" } }),
    prisma.puesto.findMany({ where: { activo: true }, select: { id: true, nombre: true, departamentoId: true }, orderBy: { nombre: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Nuevo empleado" description="Complete la información del nuevo empleado." />
      <div className="max-w-4xl">
      <NuevoEmpleadoForm
        sucursales={sucursales}
        divisiones={divisiones}
        departamentos={departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null }))}
        puestos={puestos}
        puedeCambiarAportes={puede(usuario, "configuracion.parametros")}
        niveles={etiquetasNiveles(conJerarquia)}
      />
      </div>
    </div>
  );
}
