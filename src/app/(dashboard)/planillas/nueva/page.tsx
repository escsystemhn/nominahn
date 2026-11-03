import { prisma } from "@/lib/prisma";
import NuevaPlanillaForm from "@/components/payroll/NuevaPlanillaForm";
import PageHeader from "@/components/ui/PageHeader";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

export default async function NuevaPlanillaPage() {
  await requerirPermisoPagina("planillas.calcular");
  const conDivisiones = await divisionesHabilitadas(prisma);

  const [empresas, sucursales, divisiones, departamentos] = await Promise.all([
    prisma.empresa.findMany({ where: { activa: true }, select: { id: true, nombre: true } }),
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true, empresaId: true }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? prisma.division.findMany({ where: { activa: true }, select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true, sucursalId: true, divisionId: true }, orderBy: { nombre: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Nueva planilla" description="Configure y calcule una nueva planilla de pago." />
      <div className="max-w-2xl">
      <NuevaPlanillaForm
        empresas={empresas}
        sucursales={sucursales}
        divisiones={divisiones}
        departamentos={departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null }))}
        conDivisiones={conDivisiones}
      />
      </div>
    </div>
  );
}
