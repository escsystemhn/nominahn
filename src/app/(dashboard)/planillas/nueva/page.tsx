import { prisma } from "@/lib/prisma";
import NuevaPlanillaForm from "@/components/payroll/NuevaPlanillaForm";
import { requerirPermisoPagina } from "@/lib/auth/guard";

export default async function NuevaPlanillaPage() {
  await requerirPermisoPagina("planillas.calcular");

  const [empresas, sucursales] = await Promise.all([
    prisma.empresa.findMany({ where: { activa: true }, select: { id: true, nombre: true } }),
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true } }),
  ]);

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Nueva planilla</h1>
        <p className="text-sm text-gray-500">Configure y calcule una nueva planilla de pago</p>
      </div>
      <NuevaPlanillaForm empresas={empresas} sucursales={sucursales} />
    </div>
  );
}
