import { prisma } from "@/lib/prisma";
import { filtroPlanillas } from "@/lib/payroll/alcance-planilla";
import ReportesClient from "@/components/reports/ReportesClient";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { formatDate } from "@/lib/utils";
import { estadoDePlanilla, etiquetaEstado } from "@/components/ui/EstadoBadge";
import { divisionesHabilitadas, jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ reporte?: string; planillaId?: string }> }) {
  const usuario = await requerirPermisoPagina("reportes.ver");
  const sp = await searchParams;

  // Quien sólo alcanza ciertas sucursales no las ve todas en el filtro. El
  // servidor del reporte aplica el alcance de todos modos.
  const soloSus = usuario.alcance === "SUCURSAL" ? { id: { in: usuario.sucursalesIds ?? [] } } : {};
  const conDivisiones = await divisionesHabilitadas(prisma);
  const conJerarquia = await jerarquiaNominaHabilitada(prisma);

  const [sucursales, divisiones, departamentos, planillasRaw] = await Promise.all([
    prisma.sucursal.findMany({ where: soloSus, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    conDivisiones
      ? prisma.division.findMany({ select: { id: true, nombre: true, sucursalId: true }, orderBy: { nombre: "asc" } })
      : Promise.resolve([]),
    prisma.departamento.findMany({ select: { id: true, nombre: true, sucursalId: true, divisionId: true }, orderBy: { nombre: "asc" } }),
    // Planillas vigentes: para acotar los reportes de planilla a una sola y para
    // el archivo del banco (que además exige que esté aprobada o pagada). Incluye
    // los borradores, que se revisan aquí antes de confirmarlos.
    prisma.planilla.findMany({
      where: { estado: { in: ["BORRADOR", "CALCULADA", "APROBADA", "PAGADA"] }, ...filtroPlanillas(usuario) },
      select: { id: true, tipo: true, estado: true, fechaInicio: true, fechaFin: true },
      orderBy: { fechaFin: "desc" },
      take: 24,
    }),
  ]);

  const planillas = planillasRaw.map((p) => ({
    id: p.id,
    dispersable: p.estado === "APROBADA" || p.estado === "PAGADA",
    etiqueta: `${etiquetaEstado(p.tipo)}, ${formatDate(p.fechaInicio)} al ${formatDate(p.fechaFin)} (${etiquetaEstado(estadoDePlanilla(p.estado)).toLowerCase()})`,
  }));

  return (
    <ReportesClient
      conDivisiones={conDivisiones}
      conJerarquia={conJerarquia}
      sucursales={sucursales}
      divisiones={divisiones}
      departamentos={departamentos.map((d) => ({ ...d, divisionId: conDivisiones ? d.divisionId : null }))}
      planillas={planillas}
      reporteInicial={sp.reporte}
      planillaInicial={planillas.some((p) => p.id === sp.planillaId) ? sp.planillaId : undefined}
    />
  );
}
