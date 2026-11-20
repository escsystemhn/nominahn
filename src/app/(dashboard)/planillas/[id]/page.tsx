import { prisma } from "@/lib/prisma";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { accesoAPlanilla } from "@/lib/payroll/alcance-planilla";
import { resumenDeRevision } from "@/lib/payroll/revision-planilla";
import { cargarRevision } from "@/lib/payroll/revision-planilla-bd";
import BarraEstadoPlanilla from "@/components/payroll/BarraEstadoPlanilla";
import RevisionPlanilla from "@/components/payroll/RevisionPlanilla";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import PlanillaActions from "@/components/payroll/PlanillaActions";
import ComprobanteAcciones from "@/components/payroll/ComprobanteAcciones";
import SapEstadoPlanilla from "@/components/payroll/SapEstadoPlanilla";
import ArchivoBanco from "@/components/payroll/ArchivoBanco";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { correoDeComprobantes } from "@/lib/email/destinatario";
import PageHeader from "@/components/ui/PageHeader";
import FranjaCifras from "@/components/ui/FranjaCifras";
import FormFiltros from "@/components/ui/FormFiltros";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";
import FiltroEstructura from "@/components/organizacion/FiltroEstructura";
import { aplanarEstructura, agruparPorEstructura, describirAlcance, etiquetasNiveles, filtroDetallesOrg, normalizarAlcance } from "@/lib/organizacion/estructura";
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
  // Sin nadie de su alcance responde que no existe. Con parte de la gente sólo consulta a esas personas.
  const acceso = await accesoAPlanilla(prisma, usuario, id);
  if (acceso === "ninguno") notFound();
  const parcial = acceso === "parcial";
  const enAlcance = filtroPorEmpleado(usuario);
  const opciones = await cargarOpcionesEstructura(prisma);
  const niveles = etiquetasNiveles(opciones.jerarquia);
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
        where: { AND: [filtroDetallesOrg(alcance), enAlcance] },
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
  // Quién dio cada paso: las columnas guardan el id de la cuenta.
  const firmantes = await prisma.user.findMany({
    where: { id: { in: [planilla.aprobadoPor, planilla.pagadoPor, planilla.anuladaPor].filter((x): x is string => !!x) } },
    select: { id: true, name: true, email: true },
  });
  const firmante = (id: string | null) => {
    const u = firmantes.find((x) => x.id === id);
    return u ? (u.name ?? u.email) : null;
  };
  // Se revisa mientras todavía se puede hacer algo al respecto: antes de confirmar y antes de aprobar.
  const enRevision = !parcial && (planilla.estado === "BORRADOR" || planilla.estado === "CALCULADA");
  const { revision, anterior } = enRevision ? await cargarRevision(prisma, planilla) : { revision: null, anterior: null };
  const totalLineas = hayFiltro ? await prisma.planillaDetalle.count({ where: { planillaId: id, ...enAlcance } }) : planilla.detalles.length;

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
  const puedeArchivoBanco = !parcial && ["APROBADA", "PAGADA"].includes(planilla.estado) && puede(usuario, "planillas.pagar");

  type Detalle = NonNullable<typeof planilla>["detalles"][number];
  const otrasDeducciones = (d: Detalle) => sumarPor([d.cooperativa, d.prestamos, d.adelantos, d.otrosDeducciones], (x) => x);

  // Sucursal → División → Departamento → Empleado, con subtotal en cada nivel.
  // Sin el nivel División habilitado, Sucursal → Departamento.
  const entradas = aplanarEstructura(agruparPorEstructura(planilla.detalles, (d) => ubicacionDeLinea(d, opciones.conDivisiones), niveles.sinDivision));
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

  // Imprime lo que se está viendo: la misma planilla, con el filtro de arriba si lo hay.
  const urlImprimir = (separar: boolean) => {
    const q = new URLSearchParams({ reporteId: "planilla-detallada", planillaId: planilla.id, formato: "PDF", modo: "ver" });
    if (alcance.sucursalId) q.set("sucursalId", alcance.sucursalId);
    if (alcance.divisionId) q.set("divisionId", alcance.divisionId);
    if (alcance.departamentoId) q.set("departamentoId", alcance.departamentoId);
    if (separar) q.set("porDivision", "1");
    return `/api/reportes?${q.toString()}`;
  };
  const puedeImprimir = planilla.estado !== "ANULADA" && puede(usuario, "reportes.ver");
  const divisionesEnPlanilla = new Set(planilla.detalles.map((d) => ubicacionDeLinea(d, opciones.conDivisiones).division?.id ?? null));
  const variasDivisiones = divisionesEnPlanilla.size > 1;
  // Con la jerarquía de nómina se imprime por unidad de entrada; el consolidado queda como la otra opción.
  const separarDeEntrada = opciones.jerarquia && variasDivisiones;

  // Con acceso parcial, la suma de las personas que ve: el total de la planilla no le corresponde.
  const resumen = parcial
    ? [
        { label: "Bruto de su alcance", valor: formatCurrency(sumarPor(planilla.detalles, (d) => d.totalBruto)) },
        { label: "Deducciones de su alcance", valor: formatCurrency(sumarPor(planilla.detalles, (d) => d.totalDeducciones)) },
        { label: "Neto de su alcance", valor: formatCurrency(sumarPor(planilla.detalles, (d) => d.salarioNeto)), destacada: true },
      ]
    : [
        { label: "Total bruto", valor: formatCurrency(planilla.totalBruto) },
        { label: "Deducciones del empleado", valor: formatCurrency(planilla.totalDeducciones) },
        { label: "Total neto a pagar", valor: formatCurrency(planilla.totalNeto), destacada: true },
        { label: "Aportes patronales", valor: formatCurrency(planilla.totalEmpleador) },
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Planilla ${etiquetaEstado(planilla.tipo).toLowerCase()}`}
        description={
          <>
            Del {formatDate(planilla.fechaInicio)} al {formatDate(planilla.fechaFin)}. {planilla.empresa.nombre},{" "}
            {planilla.sucursal ? describirAlcance(planilla) : niveles.todaLaEmpresa.toLowerCase()},{" "}
            {totalLineas === 1 ? "1 empleado" : `${totalLineas} empleados`}.
            {planilla.detalles.some((d) => d.isrDetalle) && " ISR por cálculo personalizado."}
          </>
        }
        actions={
          <>
            {planilla.estado === "ANULADA" && <EstadoBadge valor={planilla.estado} className="mr-2 text-sm" />}
            {!parcial && <PlanillaActions
              planillaId={planilla.id}
              estado={planilla.estado}
              puedeCalcular={puede(usuario, "planillas.calcular")}
              puedeAprobar={puede(usuario, "planillas.aprobar")}
              puedePagar={puede(usuario, "planillas.pagar")}
              puedeAnular={puede(usuario, "planillas.anular")}
              puedeReabrir={puede(usuario, "planillas.reabrir")}
              puedeAnularPagada={puede(usuario, "planillas.anular_pagada")}
              puedeEnviar={puedeEnviar}
              empleados={totalLineas}
              neto={formatCurrency(planilla.totalNeto)}
              revision={revision ? resumenDeRevision(revision) : undefined}
            />}
          </>
        }
      />

      {planilla.estado !== "ANULADA" && (
        <BarraEstadoPlanilla
          estado={planilla.estado}
          creada={planilla.createdAt}
          aprobada={{ por: firmante(planilla.aprobadoPor), el: planilla.cerradaAt }}
          pagada={{ por: firmante(planilla.pagadoPor), el: planilla.fechaPago }}
        />
      )}

      {parcial && (
        <div role="status" className="rounded-lg border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
          Esta planilla incluye personal fuera del alcance de su cuenta. Aquí ve sólo a las personas de su alcance, con
          sus totales, y no puede aprobarla, pagarla ni anularla.
        </div>
      )}

      {planilla.estado === "BORRADOR" && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Esta planilla está en borrador.</p>
          <p className="mt-1">
            Todavía no se ha cobrado ninguna cuota ni se ha marcado ningún bono, y los empleados no ven su comprobante.
            Revise la conciliación, las líneas y los{" "}
            <Link href={`/reportes?reporte=planilla-detallada&planillaId=${planilla.id}`} className="font-medium underline underline-offset-2">reportes</Link>.
            Si corrige horas, deducciones o salarios, use Recalcular. Cuando esté correcta, Confirmar planilla.
          </p>
        </div>
      )}

      {planilla.estado === "ANULADA" && (
        <div role="status" className="rounded-lg border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
          <p className="font-semibold">Esta planilla está anulada.</p>
          <p className="mt-1">
            {planilla.motivoAnulacion ? `Motivo: ${planilla.motivoAnulacion}.` : "Se anuló sin registrar un motivo."}
            {firmante(planilla.anuladaPor) && ` La anuló ${firmante(planilla.anuladaPor)}.`}
          </p>
        </div>
      )}

      <FranjaCifras cifras={resumen} etiqueta="Totales de la planilla" />

      {revision && <RevisionPlanilla revision={revision} anterior={anterior} accion={planilla.estado === "BORRADOR" ? "confirmar" : "aprobar"} />}

      {puedeArchivoBanco && (
        <div className="flex flex-wrap items-start gap-3">
          <ArchivoBanco base={`/api/planillas/${planilla.id}/archivo-banco`} />
        </div>
      )}

      {veContabilidad && !parcial && (
        <SapEstadoPlanilla planillaId={planilla.id} estadoPlanilla={planilla.estado} puedeEnviar={puedeEnviarSap} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <FormFiltros
          campos={["sucursalId", "divisionId", "departamentoId"]}
          etiqueta="Filtrar las líneas de la planilla"
          className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
        >
          <FiltroEstructura {...opciones} inicial={sp} />
        </FormFiltros>
        {hayFiltro && (
          <span className="text-sm text-gray-500">
            {planilla.detalles.length} de {totalLineas} empleados
          </span>
        )}
        {puedeImprimir && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <a href={urlImprimir(separarDeEntrada)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">{separarDeEntrada ? `Imprimir por ${niveles.division.toLowerCase()}` : "Imprimir planilla"}</a>
            {variasDivisiones && (
              <a href={urlImprimir(!separarDeEntrada)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">{separarDeEntrada ? "Imprimir todo junto" : `Imprimir cada ${niveles.division.toLowerCase()} en hoja aparte`}</a>
            )}
          </span>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="tabla-fija overflow-x-auto">
          <table className="table-base text-xs">
            <thead>
              <tr>
                <th className="col-fija px-3">Empleado</th>
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
                        {/* Fijo al recorrer la tabla de lado: si no, el grupo se pierde de vista. */}
                        <span className="sticky left-3 inline-block">{e.grupo.nombre}</span>
                      </td>
                    </tr>
                  );
                }
                if (e.tipo === "subtotal") {
                  const personas = e.grupo.items.length;
                  return (
                    <tr key={`s${i}`} className="font-semibold text-gray-900 [&>td]:border-t [&>td]:border-gray-300">
                      {/* En la columna del nombre, que queda fija: así el rótulo no se pierde al recorrer de lado. */}
                      <td style={sangria(e.nivel)} className="col-fija py-2">
                        Subtotal {e.grupo.nombre} <span className="font-normal text-gray-500">({personas === 1 ? "1 empleado" : `${personas} empleados`})</span>
                      </td>
                      <td colSpan={2} />
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
                  <td className="col-fija py-2 pr-3" style={sangria(e.nivel)}>
                    <div className="font-medium text-gray-900">{nombreCompleto(d.empleado)}</div>
                  </td>
                  <td className="num px-3 py-2">{Number(d.diasTrabajados).toFixed(0)}</td>
                  <td className="num px-3 py-2">{Number(d.horasExtra).toFixed(1)}</td>
                  <td className="num whitespace-nowrap px-3 py-2">{formatCurrency(d.totalBruto)}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500">
                    {formatCurrency(d.ihssEmpleado)}
                    {d.ihssFijo && (
                      <span className="block text-xs text-gray-500" title="Monto fijo pactado en la ficha del empleado">
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
