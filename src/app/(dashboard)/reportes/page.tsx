import { prisma } from "@/lib/prisma";
import ReportesClient from "@/components/reports/ReportesClient";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { formatDate } from "@/lib/utils";
import { etiquetaEstado } from "@/components/ui/EstadoBadge";

export default async function ReportesPage() {
  await requerirPermisoPagina("reportes.ver");

  const [sucursales, departamentos, empresas, planillasRaw] = await Promise.all([
    prisma.sucursal.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    prisma.departamento.findMany({ select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    prisma.empresa.findMany({ select: { id: true, nombre: true } }),
    // Sólo las planillas dispersables: no se genera archivo de banco de un
    // borrador ni de una planilla anulada.
    prisma.planilla.findMany({
      where: { estado: { in: ["APROBADA", "PAGADA"] } },
      select: { id: true, tipo: true, estado: true, fechaInicio: true, fechaFin: true },
      orderBy: { fechaFin: "desc" },
      take: 24,
    }),
  ]);

  const planillas = planillasRaw.map((p) => ({
    id: p.id,
    etiqueta: `${etiquetaEstado(p.tipo)}, ${formatDate(p.fechaInicio)} al ${formatDate(p.fechaFin)} (${etiquetaEstado(p.estado).toLowerCase()})`,
  }));

  return (
    <ReportesClient
      sucursales={sucursales}
      departamentos={departamentos}
      empresas={empresas}
      planillas={planillas}
    />
  );
}
