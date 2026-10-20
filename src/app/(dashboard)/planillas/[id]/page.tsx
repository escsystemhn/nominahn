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

export default async function DetallePlanillaPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requerirPermisoPagina("planillas.ver");

  const { id } = await params;
  const planilla = await prisma.planilla.findUnique({
    where: { id },
    include: {
      empresa: true,
      detalles: {
        include: {
          empleado: {
            include: {
              sucursal: { select: { nombre: true } },
              departamento: { select: { nombre: true } },
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { empleado: { primerApellido: "asc" } },
      },
    },
  });

  if (!planilla) notFound();

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
  const suma = (f: (d: Detalle) => number) => planilla.detalles.reduce((s, d) => s + f(d), 0);

  const otrasDeducciones = (d: Detalle) =>
    Number(d.cooperativa) + Number(d.prestamos) + Number(d.adelantos) + Number(d.otrosDeducciones);

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
            {planilla.detalles.length === 1 ? "1 empleado" : `${planilla.detalles.length} empleados`}.
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

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead>
              <tr>
                <th className="px-3">Empleado</th>
                <th className="px-3">Sucursal</th>
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
              {planilla.detalles.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{nombreCompleto(d.empleado)}</div>
                    <div className="text-gray-500">{d.empleado.departamento.nombre}</div>
                  </td>
                  <td className="px-3 py-2">{d.empleado.sucursal.nombre}</td>
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
                  <td className="num whitespace-nowrap px-3 py-2 text-gray-500">{formatCurrency(d.isr)}</td>
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
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 text-sm font-semibold text-gray-900">
                <td colSpan={4} className="px-3 py-3">
                  Totales
                </td>
                <td className="num whitespace-nowrap px-3 py-3">{formatCurrency(planilla.totalBruto)}</td>
                <td className="num whitespace-nowrap px-3 py-3">{formatCurrency(suma((d) => Number(d.ihssEmpleado)))}</td>
                <td className="num whitespace-nowrap px-3 py-3">{formatCurrency(suma((d) => Number(d.rapEmpleado)))}</td>
                <td className="num whitespace-nowrap px-3 py-3">{formatCurrency(suma((d) => Number(d.isr)))}</td>
                <td className="num whitespace-nowrap px-3 py-3">{formatCurrency(suma(otrasDeducciones))}</td>
                <td className="num whitespace-nowrap px-3 py-3">{formatCurrency(suma((d) => Number(d.ausencias)))}</td>
                <td className="num whitespace-nowrap px-3 py-3 text-blue-800">{formatCurrency(planilla.totalNeto)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
