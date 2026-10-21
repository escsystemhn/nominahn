import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";
import FiltroEstructura from "@/components/organizacion/FiltroEstructura";
import { describirAlcance, filtroDetallesOrg, normalizarAlcance } from "@/lib/organizacion/estructura";
import { cargarOpcionesEstructura } from "@/lib/organizacion/estructura-bd";

export const metadata = { title: "Planillas" };

const TIPOS = ["MENSUAL", "QUINCENAL", "SEMANAL"] as const;

export default async function PlanillasPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursalId?: string; divisionId?: string; departamentoId?: string }>;
}) {
  // Antes esta página no llamaba a auth() en absoluto: el menú lateral ocultaba
  // el enlace, pero escribir la URL mostraba la nómina completa a cualquiera.
  const usuario = await requerirPermisoPagina("planillas.ver");
  const puedeCrear = puede(usuario, "planillas.calcular");

  const sp = await searchParams;
  const opciones = await cargarOpcionesEstructura(prisma);
  const alcance = normalizarAlcance({ ...sp, divisionId: opciones.conDivisiones ? sp.divisionId : null });
  const hayFiltro = !!(alcance.sucursalId || alcance.divisionId || alcance.departamentoId);

  // Filtrar = planillas que INCLUYEN personal de esa unidad (según dónde estaba
  // cada quien al pagarse): una planilla de toda la empresa también paga a la
  // gente de cada sucursal, y por eso aparece.
  const unidad = { select: { nombre: true } } as const;
  const planillas = await prisma.planilla.findMany({
    where: hayFiltro ? { detalles: { some: filtroDetallesOrg(alcance) } } : {},
    include: { empresa: unidad, sucursal: unidad, division: unidad, departamento: unidad },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planillas"
        description="Nóminas semanales, quincenales y mensuales: cálculo, aprobación, pago y comprobantes."
        actions={
          puedeCrear && (
            <Link href="/planillas/nueva" className="btn btn-primary">
              Nueva planilla
            </Link>
          )
        }
      >
        <form className="flex flex-wrap gap-2">
          <FiltroEstructura {...opciones} inicial={sp} />
          <button type="submit" className="btn btn-secondary">Filtrar</button>
          {hayFiltro && <Link href="/planillas" className="btn btn-ghost">Quitar filtros</Link>}
        </form>
      </PageHeader>

      {/* Última planilla de cada tipo, en una franja con divisores. */}
      <section aria-label="Última planilla por tipo">
        <div className="grid grid-cols-1 divide-y divide-gray-200 border-b border-gray-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {TIPOS.map((tipo) => {
            const ultima = planillas.find((p) => p.tipo === tipo);
            return (
              <div key={tipo} className="px-5 py-4 sm:first:pl-0 lg:px-6 lg:first:pl-0">
                <p className="text-sm text-gray-500">Última {etiquetaEstado(tipo).toLowerCase()}</p>
                {ultima ? (
                  <>
                    <p className="tnum mt-1 text-xl font-semibold leading-none text-gray-900">
                      {formatCurrency(ultima.totalNeto)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>
                        {formatDate(ultima.fechaInicio)} al {formatDate(ultima.fechaFin)}
                      </span>
                      <EstadoBadge valor={ultima.estado} />
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">Sin planillas de este tipo</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Planilla</th>
                <th>Período</th>
                <th>Empresa</th>
                <th>Alcance</th>
                <th className="num">Bruto</th>
                <th className="num">Deducciones</th>
                <th className="num">Neto</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {planillas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <p className="text-sm font-medium text-gray-900">
                      {hayFiltro ? "Ninguna planilla incluye personal de esa unidad." : "Todavía no hay planillas."}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {hayFiltro
                        ? "Quite o cambie el filtro para ver las demás."
                        : puedeCrear
                          ? "Calcule la primera con los empleados activos y el período que corresponda."
                          : "Cuando Nómina calcule una, aparecerá aquí."}
                    </p>
                    {puedeCrear && !hayFiltro && (
                      <Link href="/planillas/nueva" className="btn btn-primary mt-5">
                        Nueva planilla
                      </Link>
                    )}
                  </td>
                </tr>
              ) : (
                planillas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/planillas/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                        {etiquetaEstado(p.tipo)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}
                    </td>
                    <td>{p.empresa.nombre}</td>
                    <td className="text-gray-600">{describirAlcance(p)}</td>
                    <td className="num whitespace-nowrap">{formatCurrency(p.totalBruto)}</td>
                    <td className="num whitespace-nowrap text-gray-500">{formatCurrency(p.totalDeducciones)}</td>
                    <td className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(p.totalNeto)}</td>
                    <td>
                      <EstadoBadge valor={p.estado} />
                    </td>
                    <td className="text-right">
                      <Link href={`/planillas/${p.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
