import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { puede, puedeAlguno } from "@/lib/auth/guard";
import { formatCurrency, formatDate, hoyHN, TZ_HN, LOCALE } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { etiquetaEstado } from "@/components/ui/EstadoBadge";

export const metadata = { title: "Inicio" };

/**
 * El inicio responde «¿qué hay que hacer hoy?», no «¿qué hace el sistema?».
 *
 * Antes mostraba la lista de módulos y porcentajes de ley quemados en el
 * código (IHSS 2.5 %, RAP 1.5 %…), que ya no son ciertos para toda empresa
 * desde que los parámetros se configuran. Ahora enseña conteos del día,
 * lo pendiente de aprobar y las últimas planillas, cada cosa sólo si el
 * perfil tiene permiso de verla.
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
  <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

  const [empleados, activos, marcajesHoy, permisosPendientes, planillasSinAprobar, ultimas, prestamosPendientes] =
    await Promise.all([
      veEmpleados ? prisma.empleado.count() : null,
      veEmpleados ? prisma.empleado.count({ where: { estado: "ACTIVO" } }) : null,
      // `hoyHN()` da la medianoche UTC del día de hoy en Honduras, que es lo
      // que compara bien contra una columna @db.Date.
      veAsistencia ? prisma.marcaje.count({ where: { fecha: hoyHN() } }) : null,
      apruebaPermisos ? prisma.permiso.count({ where: { estado: "PENDIENTE" } }) : null,
      vePlanillas
        ? prisma.planilla.count({ where: { estado: { in: ["BORRADOR", "CALCULADA"] } } })
        : null,
      vePlanillas
        ? prisma.planilla.findMany({
            orderBy: { createdAt: "desc" },
            take: 6,
            select: { id: true, tipo: true, fechaInicio: true, fechaFin: true, estado: true, totalNeto: true },
          })
        : [],
      apruebaPrestamos ? prisma.solicitudPrestamo.count({ where: { estado: "PENDIENTE" } }) : null,
    ]);

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
    apruebaPermisos && {
      href: "/mi-espacio",
      label: "Solicitudes por aprobar",
      valor: permisosPendientes ?? 0,
      detalle: "permisos y vacaciones",
    },
    apruebaPrestamos && (prestamosPendientes ?? 0) > 0 && {
      href: "/deducciones",
      label: "Préstamos por aprobar",
      valor: prestamosPendientes ?? 0,
      detalle: "solicitudes desde Mi espacio",
    },
    vePlanillas && {
      href: "/planillas",
      label: "Planillas sin aprobar",
      valor: planillasSinAprobar ?? 0,
      detalle: "en borrador o calculadas",
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
      titulo: "Calcular una planilla",
      detalle: "Semanal, quincenal o mensual, con IHSS, RAP e ISR.",
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
    {
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

      {metricas.length > 0 && (
        <section aria-label="Resumen de hoy">
          <div className="grid grid-cols-1 divide-y divide-gray-200 border-b border-gray-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            {metricas.map((m) => (
              <Link
                key={m.href + m.label}
                href={m.href}
                className="block px-5 py-4 transition-colors hover:bg-white sm:first:pl-0 lg:px-6 lg:first:pl-0"
              >
                <p className="text-sm text-gray-500">{m.label}</p>
                <p className="tnum mt-1 text-2xl font-semibold leading-none text-gray-900">{m.valor}</p>
                <p className="mt-1.5 text-xs text-gray-500">{m.detalle}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
                <div className="px-6 py-10 text-center">
                  <p className="text-sm font-medium text-gray-900">Todavía no hay planillas calculadas.</p>
                  <p className="mt-1 text-sm text-gray-500">
                    La primera se calcula desde Nómina, en Planillas, a partir de los empleados activos.
                  </p>
                  {calculaPlanillas && (
                    <Link href="/planillas/nueva" className="btn btn-primary mt-5">
                      Calcular planilla
                    </Link>
                  )}
                </div>
              ) : (
                <table className="table-base">
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
                      <tr key={p.id}>
                        <td>
                          <Link href={`/planillas/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                            {etiquetaEstado(p.tipo)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap">
                          {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}
                        </td>
                        <td className="num whitespace-nowrap font-medium text-gray-900">
                          {formatCurrency(p.totalNeto)}
                        </td>
                        <td>
                          <EstadoBadge valor={p.estado} />
                        </td>
                      </tr>
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
