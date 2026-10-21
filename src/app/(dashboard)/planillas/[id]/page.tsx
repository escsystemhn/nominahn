import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import PlanillaActions from "@/components/payroll/PlanillaActions";
import ComprobanteAcciones from "@/components/payroll/ComprobanteAcciones";
import SapEstadoPlanilla from "@/components/payroll/SapEstadoPlanilla";
import ArchivoBanco from "@/components/payroll/ArchivoBanco";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { correoDeComprobantes } from "@/lib/email/destinatario";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";
import FiltroEstructura from "@/components/organizacion/FiltroEstructura";
import { aplanarEstructura, agruparPorEstructura, describirAlcance, filtroDetallesOrg, normalizarAlcance } from "@/lib/organizacion/estructura";
import { cargarOpcionesEstructura } from "@/lib/organizacion/estructura-bd";
import { ubicacionDeLinea } from "@/lib/reportes/planilla-estructura";
import { sumarPor } from "@/lib/payroll/money";
import type { DetalleIsrPersonalizado } from "@/lib/payroll/isr-personalizado";
import { cn } from "@/lib/utils";

export default async function DetallePlanillaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sucursalId?: string; divisionId?: string; departamentoId?: string }>;
}) {
  const usuario = await requerirPermisoPagina("planillas.ver");

  const { id } = await params;
  const sp = await searchParams;
  const opciones = await cargarOpcionesEstructura(prisma);
  // Filtro DENTRO de la planilla: por dónde estaba cada quien al pagarse.
  const alcance = normalizarAlcance({ ...sp, divisionId: opciones.conDivisiones ? sp.divisionId : null });
  const hayFiltro = !!(alcance.sucursalId || alcance.divisionId || alcance.departamentoId);

  const unidad = { select: { id: true, nombre: true } } as const;
  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: {
      empresa: true,
      sucursal: unidad,
      division: unidad,
      departamento: unidad,
      detalles: {
        where: filtroDetallesOrg(alcance),
        include: {
          sucursal: unidad,
          division: unidad,
          departamento: unidad,
          empleado: {
            include: {
              sucursal: unidad,
              departamento: { select: { id: true, nombre: true, division: unidad } },
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { empleado: { primerApellido: "asc" } },
      },
    },
  });

  if (!planilla) notFound();
  const totalLineas = hayFiltro ? await prisma.planillaDetalle.count({ where: { planillaId: id } }) : planilla.detalles.length;

  // Enviar sólo tiene sentido con la planilla cerrada: antes de aprobarla, el
  // documento podría dejar de corresponder a lo que finalmente se paga.
  const puedeEnviar =
    ["APROBADA", "PAGADA"].includes(planilla.estado) && puede(usuario, "planillas.boletas");

  // La contabilización en SAP la ve quien ve la partida; la dispara quien
  // tiene `planillas.sap_enviar`. El bloque no aparece si SAP no está configurado.
  const veContabilidad = puede(usuario, "planillas.contabilidad");
  const puedeEnviarSap = puede(usuario, "planillas.sap_enviar");

  // El archivo para el banco lleva cuentas: sólo quien registra el pago, y
  // sólo con la planilla aprobada (no se paga un borrador).
  const puedeArchivoBanco = ["APROBADA", "PAGADA"].includes(planilla.estado) && puede(usuario, "planillas.pagar");

  type Detalle = NonNullable<typeof planilla>["detalles"][number];
  const otrasDeducciones = (d: Detalle) => sumarPor([d.cooperativa, d.prestamos, d.adelantos, d.otrosDeducciones], (x) => x);

  // Sucursal → División → Departamento → Empleado, con subtotal en cada nivel.
  // Sin el nivel División habilitado, Sucursal → Departamento.
  const entradas = aplanarEstructura(agruparPorEstructura(planilla.detalles, (d) => ubicacionDeLinea(d, opciones.conDivisiones)));
  const montos = (ds: Detalle[]) => [
    sumarPor(ds, (d) => d.totalBruto),
    sumarPor(ds, (d) => d.ihssEmpleado),
    sumarPor(ds, (d) => d.rapEmpleado),
    sumarPor(ds, (d) => d.isr),
    sumarPor(ds, otrasDeducciones),
    sumarPor(ds, (d) => d.ausencias),
    sumarPor(ds, (d) => d.salarioNeto),
  ];
  const sangria = (nivel: number) => ({ paddingLeft: `${0.75 + nivel * 1.25}rem` });
  // Cálculo personalizado: de dónde salió el ISR de la línea, al pasar el ratón.
  const explicarIsr = (j: unknown): string | undefined => {
    const x = j as DetalleIsrPersonalizado | null;
    if (!x || x.metodo !== "PERSONALIZADO") return undefined;
    return `Cálculo personalizado: ingreso anual proyectado ${formatCurrency(x.ingresoAnual)} menos deducciones ${formatCurrency(x.deducciones)}` +
      ` = ${formatCurrency(x.renta)}; ISR anual ${formatCurrency(x.isrAnual)} menos lo ya retenido ${formatCurrency(x.retenidoPrevio)},` +
      ` entre ${x.periodosRestantes} período(s) que faltan.`;
  };
  const COLUMNAS = 11;

  const resumen = [
    { label: "Total bruto", valor: formatCurrency(planilla.totalBruto) },
    { label: "Deducciones del empleado", valor: formatCurrency(planilla.totalDeducciones) },
    { label: "Total neto a pagar", valor: formatCurrency(planilla.totalNeto), destacado: true },
    { label: "Aportes patronales", valor: formatCurrency(planilla.totalEmpleador) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Planilla ${etiquetaEstado(planilla.tipo).toLowerCase()}`}
        description={
          <>
            Del {formatDate(planilla.fechaInicio)} al {formatDate(planilla.fechaFin)}. {planilla.empresa.nombre},{" "}
            {planilla.sucursal ? describirAlcance(planilla) : "toda la empresa"},{" "}
            {totalLineas === 1 ? "1 empleado" : `${totalLineas} empleados`}.
            {planilla.detalles.some((d) => d.isrDetalle) && " ISR por cálculo personalizado."}
          </>
        }
        actions={
          <>
            <EstadoBadge valor={planilla.estado} className="mr-2 text-sm" />
            <PlanillaActions planillaId={planilla.id} estado={planilla.estado} />
          </>
        }
      />

      <section aria-label="Totales de la planilla">
        <div className="grid grid-cols-2 divide-y divide-gray-200 border-b border-gray-200 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          {resumen.map((s) => (
            <div key={s.label} className="px-5 py-4 first:pl-0 lg:px-6 lg:first:pl-0">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`tnum mt-1 text-xl font-semibold leading-none ${s.destacado ? "text-blue-800" : "text-gray-900"}`}>
                {s.valor}
              </p>
            </div>
          ))}
        </div>
      </section>

      {puedeArchivoBanco && (
        <div className="flex flex-wrap items-start gap-3">
          <ArchivoBanco base={`/api/planillas/${planilla.id}/archivo-banco`} />
        </div>
      )}

      {veContabilidad && (
        <SapEstadoPlanilla planillaId={planilla.id} estadoPlanilla={planilla.estado} puedeEnviar={puedeEnviarSap} />
      )}

      <form className="flex flex-wrap items-center gap-2" aria-label="Filtrar las líneas de la planilla">
        <FiltroEstructura {...opciones} inicial={sp} />
        <button type="submit" className="btn btn-secondary">Filtrar</button>
        {hayFiltro && <a href={`/planillas/${planilla.id}`} className="btn btn-ghost">Quitar filtros</a>}
        {hayFiltro && (
          <span className="text-sm text-gray-500">
            {planilla.detalles.length} de {totalLineas} empleados
          </span>
        )}
      </form>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead>
              <tr>
                <th className="px-3">Empleado</th>
                <th className="num px-3">Días</th>
                <th className="num px-3">H. extra</th>
                <th className="num px-3">Bruto</th>
                <th className="num px-3">IHSS</th>
                <th className="num px-3">RAP</th>
                <th className="num px-3">ISR</th>
                <th className="num px-3">Otras ded.</th>
                <th className="num px-3">Ausencias</th>
                <th className="num px-3 text-gray-900">Neto</th>
                <th className="px-3 text-center">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {planilla.detalles.length === 0 && (
                <tr><td colSpan={COLUMNAS} className="py-8 text-center text-sm text-gray-500">Nadie de esa unidad está en esta planilla.</td></tr>
              )}
              {entradas.map((e, i) => {
                if (e.tipo === "grupo") {
                  return (
                    <tr key={`g${i}`}>
                      <td colSpan={COLUMNAS} style={sangria(e.nivel)}
                        className={cn("py-2 text-sm font-semibold text-gray-900", e.nivel === 0 ? "bg-blue-50" : e.nivel === 1 ? "bg-gray-100" : "bg-gray-50")}>
                        {e.grupo.nombre}
                      </td>
                    </tr>
                  );
                }
                if (e.tipo === "subtotal") {
                  const personas = e.grupo.items.length;
                  return (
                    <tr key={`s${i}`} className="font-semibold text-gray-900 [&>td]:border-t [&>td]:border-gray-300">
                      <td colSpan={3} style={sangria(e.nivel)} className="py-2">
                        Subtotal {e.grupo.nombre} <span className="font-normal text-gray-500">({personas === 1 ? "1 empleado" : `${personas} empleados`})</span>
                      </td>
                      {montos(e.grupo.items).map((m, j) => (
                        <td key={j} className="num whitespace-nowrap px-3 py-2">{formatCurrency(m)}</td>
                      ))}
                      <td />
                    </tr>
                  );
                }
                const d = e.item;
                return (
                <tr key={d.id}>
                  <td className="py-2 pr-3" style={sangria(e.nivel)}>
                    <div className="font-medium text-gray-900">{nombreCompleto(d.empleado)}</div>
                  </td>
                  <td className="num px-3 py-2">{Number(d.diasTrabajados).toFixed(0)}</td>
                  <td className="num px-3 py-2">{Number(d.horasExtra).toFixed(1)}</td>
                  <td className="num whitespace-nowrap px-3 py-2">{formatCurrency(d.totalBruto)}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500">
                    {formatCurrency(d.ihssEmpleado)}
                    {d.ihssFijo && (
                      <span className="block text-[10px] text-gray-400" title="Monto fijo pactado en la ficha del empleado">
                        fijo
                      </span>
                    )}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500">{formatCurrency(d.rapEmpleado)}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500" title={explicarIsr(d.isrDetalle)}>{formatCurrency(d.isr)}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500">{formatCurrency(otrasDeducciones(d))}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500">{formatCurrency(d.ausencias)}</td>
                  <td className="num whitespace-nowrap px-3 py-2 font-semibold text-gray-900">
                    {formatCurrency(d.salarioNeto)}
                  </td>
                  <td className="px-3 py-2">
                    <ComprobanteAcciones
                      planillaId={planilla.id}
                      detalleId={d.id}
                      empleadoId={d.empleadoId}
                      correo={correoDeComprobantes(d.empleado)}
                      enviado={d.emailEnviado}
                      puedeEnviar={puedeEnviar}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 text-sm font-semibold text-gray-900">
                <td colSpan={3} className="px-3 py-3">
                  {hayFiltro ? "Totales del filtro" : "Totales"}
                </td>
                {montos(planilla.detalles).map((m, j) => (
                  <td key={j} className={cn("num whitespace-nowrap px-3 py-3", j === 6 && "text-blue-800")}>{formatCurrency(m)}</td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
