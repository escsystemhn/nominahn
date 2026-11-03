import Link from "next/link";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FilaEnlace from "@/components/ui/FilaEnlace";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { puede, puedeAlguno } from "@/lib/auth/guard";
import { formatCurrency, formatDate, hoyHN, nombreCompleto, TZ_HN, LOCALE } from "@/lib/utils";
import { conAlcance, filtroEmpleados, filtroPorEmpleado, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { permisosPorResolver } from "@/lib/asistencia/solicitudes";
import { sumarPor } from "@/lib/payroll/money";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";

export const metadata = { title: "Inicio" };

/** Con cuánta anticipación se avisa que un contrato está por vencer. */
const DIAS_AVISO_CONTRATO = 30;

/**
 * El inicio responde «¿qué está esperando por mí?», no «¿qué hace el sistema?».
 *
 * Primero lo pendiente, en el orden en que urge: cada fila dice qué hay y lleva a
 * resolverlo. Sólo aparece lo que esta cuenta puede resolver, contado dentro de su
 * alcance: una lista de cosas ajenas se deja de leer en dos días.
 */
function saludoSegunHora(): string {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TZ_HN }).format(new Date())
  );
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

const IconChevron = () => (
  <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
  </svg>
);

export default async function DashboardPage() {
  const session = await auth();
  const usuario = session?.user;

  const veEmpleados = puede(usuario, "empleados.ver");
  const veAsistencia = puedeAlguno(usuario, ["asistencia.ver", "asistencia.gestionar"]);
  const apruebaPermisos = puede(usuario, "asistencia.aprobar_permisos");
  const vePlanillas = puede(usuario, "planillas.ver");
  const veReportes = puede(usuario, "reportes.ver");
  const creaEmpleados = puede(usuario, "empleados.crear");
  const calculaPlanillas = puede(usuario, "planillas.calcular");
  const apruebaPrestamos = puede(usuario, "deducciones.asignar");

  const apruebaPlanillas = puede(usuario, "planillas.aprobar");
  const pagaPlanillas = puede(usuario, "planillas.pagar");
  const veContratos = puede(usuario, "empleados.pii");
  const enviaSap = puede(usuario, "planillas.sap_enviar");
  // Sin sesión legible no se cuenta nada: es el mismo fallo seguro de `filtroEmpleados`.
  const alcance: UsuarioConAlcance & { role?: string | null } = usuario ?? { alcance: "PROPIO" };

  const hoy = hoyHN();
  const limiteContratos = new Date(hoy.getTime() + DIAS_AVISO_CONTRATO * 86_400_000);
  const contratosPorVencer = {
    activo: true,
    fechaFin: { not: null, lte: limiteContratos },
    empleado: { AND: [{ estado: { not: "INACTIVO" as const } }, filtroEmpleados(alcance)] },
  };

  const [empleados, activos, marcajesHoy, permisosPendientes, abiertas, ultimas, prestamosPendientes, contratos, totalContratos, erroresSap] =
    await Promise.all([
      veEmpleados ? prisma.empleado.count({ where: conAlcance({}, alcance) }) : null,
      veEmpleados ? prisma.empleado.count({ where: conAlcance({ estado: "ACTIVO" }, alcance) }) : null,
      // `hoyHN()` da la medianoche UTC del día de hoy en Honduras, que es lo
      // que compara bien contra una columna @db.Date.
      veAsistencia ? prisma.marcaje.count({ where: { fecha: hoy, ...filtroPorEmpleado(alcance) } }) : null,
      apruebaPermisos ? prisma.permiso.count({ where: permisosPorResolver(alcance) }) : 0,
      calculaPlanillas || apruebaPlanillas || pagaPlanillas
        ? prisma.planilla.findMany({
            where: { estado: { in: ["BORRADOR", "CALCULADA", "APROBADA"] } },
            orderBy: { fechaFin: "desc" },
            select: { id: true, estado: true, totalNeto: true },
          })
        : [],
      vePlanillas
        ? prisma.planilla.findMany({
            orderBy: { createdAt: "desc" },
            take: 6,
            select: { id: true, tipo: true, fechaInicio: true, fechaFin: true, estado: true, totalNeto: true },
          })
        : [],
      apruebaPrestamos ? prisma.solicitudPrestamo.count({ where: { estado: "PENDIENTE", ...filtroPorEmpleado(alcance) } }) : 0,
      veContratos
        ? prisma.contrato.findMany({
            where: contratosPorVencer,
            orderBy: { fechaFin: "asc" },
            take: 3,
            select: {
              fechaFin: true,
              empleadoId: true,
              empleado: { select: { primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true } },
            },
          })
        : [],
      veContratos ? prisma.contrato.count({ where: contratosPorVencer }) : 0,
      enviaSap
        ? prisma.sapEnvioAsiento.findMany({ where: { estado: "ERROR" }, select: { planillaId: true }, orderBy: { updatedAt: "desc" } })
        : [],
    ]);

  // Una sola: directo a ella. Varias: a la lista, ya filtrada.
  const destinoPlanillas = (estado: string, lista: Array<{ id: string }>) =>
    lista.length === 1 ? `/planillas/${lista[0].id}` : `/planillas?estado=${estado}`;
  const planillasEn = (estado: string) => abiertas.filter((p) => p.estado === estado);
  const netoDe = (lista: typeof abiertas) => `Neto de ${formatCurrency(sumarPor(lista, (p) => p.totalNeto))}.`;
  const porPagar = pagaPlanillas ? planillasEn("APROBADA") : [];
  const porAprobar = apruebaPlanillas ? planillasEn("CALCULADA") : [];
  const borradores = calculaPlanillas ? planillasEn("BORRADOR") : [];

  const pendientes = [
    enviaSap && erroresSap.length > 0 && {
      n: erroresSap.length,
      titulo: erroresSap.length === 1 ? "Envío a SAP con error" : "Envíos a SAP con error",
      detalle: "SAP no los aceptó o se agotaron los reintentos: hace falta revisarlos.",
      href: `/planillas/${erroresSap[0].planillaId}`,
    },
    porPagar.length > 0 && {
      n: porPagar.length,
      titulo: porPagar.length === 1 ? "Planilla aprobada por pagar" : "Planillas aprobadas por pagar",
      detalle: netoDe(porPagar),
      href: destinoPlanillas("APROBADA", porPagar),
    },
    porAprobar.length > 0 && {
      n: porAprobar.length,
      titulo: porAprobar.length === 1 ? "Planilla por aprobar" : "Planillas por aprobar",
      detalle: `${netoDe(porAprobar)} ${porAprobar.length === 1 ? "Ya cobró" : "Ya cobraron"} cuotas y bonos.`,
      href: destinoPlanillas("CALCULADA", porAprobar),
    },
    borradores.length > 0 && {
      n: borradores.length,
      titulo: borradores.length === 1 ? "Borrador por confirmar" : "Borradores por confirmar",
      detalle: `${netoDe(borradores)} Todavía no ${borradores.length === 1 ? "cobra" : "cobran"} nada.`,
      href: destinoPlanillas("BORRADOR", borradores),
    },
    permisosPendientes > 0 && {
      n: permisosPendientes,
      titulo: permisosPendientes === 1 ? "Solicitud de permiso por aprobar" : "Solicitudes de permiso por aprobar",
      detalle: "Permisos y vacaciones que esperan respuesta.",
      href: "/mi-espacio",
    },
    prestamosPendientes > 0 && {
      n: prestamosPendientes,
      titulo: prestamosPendientes === 1 ? "Solicitud de préstamo por atender" : "Solicitudes de préstamo por atender",
      detalle: "Enviadas por los empleados desde Mi espacio.",
      href: "/deducciones",
    },
    totalContratos > 0 && {
      n: totalContratos,
      titulo: totalContratos === 1 ? "Contrato por vencer" : "Contratos por vencer",
      detalle: `${contratos.map((c) => `${nombreCompleto(c.empleado)}, ${formatDate(c.fechaFin as Date)}`).join("; ")}${totalContratos > contratos.length ? `; y ${totalContratos - contratos.length} más` : ""}.`,
      href: totalContratos === 1 ? `/empleados/${contratos[0].empleadoId}?tab=contrato` : "/empleados",
    },
  ].filter((x): x is Exclude<typeof x, false> => Boolean(x));

  const nombrePila = usuario?.name?.split(" ")[0] ?? "";
  const fechaLarga = new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ_HN,
  }).format(new Date());
  const fechaTitulo = fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1);

  const metricas = [
    veEmpleados && {
      href: "/empleados",
      label: "Empleados activos",
      valor: activos ?? 0,
      detalle: `${empleados ?? 0} en total`,
    },
    veAsistencia && {
      href: "/asistencia",
      label: "Marcajes de hoy",
      valor: marcajesHoy ?? 0,
      detalle: "entradas y salidas registradas",
    },
  ].filter((m): m is Exclude<typeof m, false> => Boolean(m));

  const acciones = [
    creaEmpleados && {
      href: "/empleados/nuevo",
      titulo: "Registrar un empleado",
      detalle: "Datos personales, contrato, salario y cuenta de banco.",
    },
    calculaPlanillas && {
      href: "/planillas/nueva",
      titulo: "Generar una planilla",
      detalle: "Queda en borrador para revisarla antes de confirmarla.",
    },
    veAsistencia && {
      href: "/asistencia",
      titulo: "Revisar la asistencia",
      detalle: "Marcajes, horas extra y ausencias del período.",
    },
    veReportes && {
      href: "/reportes",
      titulo: "Generar reportes",
      detalle: "Planilla detallada, IHSS, RAP, ISR y provisiones.",
    },
    !!usuario?.empleadoId && {
      href: "/mi-espacio",
      titulo: "Mi espacio",
      detalle: "Boletas de pago, solicitudes de permiso y mis datos.",
    },
    {
      href: "/portal",
      titulo: "Portal del empleado",
      detalle: "Anuncios, políticas y documentos de la empresa.",
    },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a));

  return (
    <div className="space-y-6">
      <PageHeader
        title={nombrePila ? `${saludoSegunHora()}, ${nombrePila}` : saludoSegunHora()}
        description={fechaTitulo}
      />

      <section aria-labelledby="pendientes-titulo">
        <h2 id="pendientes-titulo" className="text-base font-semibold text-gray-900">Pendientes</h2>
        <div className="panel mt-3 overflow-hidden">
          {pendientes.length === 0 ? (
            <EstadoVacio titulo="No hay nada esperando por usted." detalle="Lo que le toque resolver aparecerá aquí." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {pendientes.map((x) => (
                <li key={x.titulo}>
                  <Link href={x.href} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50">
                    <span className="tnum w-9 shrink-0 text-right text-2xl font-semibold leading-none text-gray-900">{x.n}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900">{x.titulo}</span>
                      <span className="block text-sm text-gray-500">{x.detalle}</span>
                    </span>
                    <IconChevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {metricas.length > 0 && (
        <section aria-label="Resumen de hoy">
          <div className="grid grid-cols-1 divide-y divide-gray-200 border-b border-gray-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            {metricas.map((m) => (
              <Link
                key={m.href + m.label}
                href={m.href}
                className="block py-4 transition-colors hover:bg-white sm:px-5 sm:first:pl-0 lg:px-6"
              >
                <p className="text-sm text-gray-500">{m.label}</p>
                <p className="tnum mt-1 text-2xl font-semibold leading-none text-gray-900">{m.valor}</p>
                <p className="mt-1.5 text-xs text-gray-500">{m.detalle}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {vePlanillas && (
          <section>
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-gray-900">Últimas planillas</h2>
              <Link href="/planillas" className="text-sm text-blue-600 hover:underline">
                Ver todas
              </Link>
            </div>
            <div className="panel mt-3 overflow-hidden">
              {ultimas.length === 0 ? (
                <EstadoVacio
                  titulo="Todavía no hay planillas."
                  detalle="Se generan desde Nómina, en Planillas, a partir de los empleados activos."
                  accion={
                    calculaPlanillas && (
                      <Link href="/planillas/nueva" className="btn btn-primary">
                        Nueva planilla
                      </Link>
                    )
                  }
                />
              ) : (
                <table className="table-base tabla-tarjetas">
                  <thead>
                    <tr>
                      <th>Planilla</th>
                      <th>Período</th>
                      <th className="num">Neto</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ultimas.map((p) => (
                      <FilaEnlace key={p.id} href={`/planillas/${p.id}`}>
                        <td data-titulo>
                          <Link href={`/planillas/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                            {etiquetaEstado(p.tipo)}
                          </Link>
                        </td>
                        <td data-etiqueta="Período" className="whitespace-nowrap">
                          {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}
                        </td>
                        <td data-etiqueta="Neto" className="num whitespace-nowrap font-medium text-gray-900">
                          {formatCurrency(p.totalNeto)}
                        </td>
                        <td data-etiqueta="Estado">
                          <EstadoBadge valor={p.estado} />
                        </td>
                      </FilaEnlace>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-gray-900">Acciones</h2>
          <ul className="panel mt-3 divide-y divide-gray-100">
            {acciones.map((a) => (
              <li key={a.href + a.titulo}>
                <Link
                  href={a.href}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{a.titulo}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{a.detalle}</p>
                  </div>
                  <IconChevron />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
