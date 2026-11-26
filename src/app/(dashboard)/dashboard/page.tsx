import Link from "next/link";
import { filtroPlanillas, filtroPlanillasCompletas, totalesVisibles } from "@/lib/payroll/alcance-planilla";
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
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";
import { periodosSinGenerar } from "@/lib/payroll/pendientes-generar-bd";
import { pendientesDeRespaldos } from "@/lib/respaldos/alertas";
import { ubicarPostgres } from "@/lib/respaldos/respaldos-bd";
import { claveDePeriodo, nombreDePeriodo } from "@/lib/payroll/planillas-por-periodo";
import { ETIQUETA_TIPO_PLANILLA, frasePeriodo, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";

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

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const dia = (d: Date) => d.toISOString().slice(0, 10);

/** «Centro, Norte y Sur»; con más de tres, «Centro, Norte, Sur y 6 más». */
function algunosNombres(nombres: readonly string[]): string {
  if (nombres.length <= 3) return nombres.length <= 1 ? nombres[0] ?? "" : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `${nombres.slice(0, 3).join(", ")} y ${nombres.length - 3} más`;
}

const PALABRAS_ESTADO: Array<[string, string, string]> = [
  ["BORRADOR", "en borrador", "en borrador"],
  ["CALCULADA", "confirmada", "confirmadas"],
  ["APROBADA", "aprobada", "aprobadas"],
  ["PAGADA", "pagada", "pagadas"],
];

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
  const administraRespaldos = puede(usuario, "configuracion.respaldos");
  // Sin sesión legible no se cuenta nada: es el mismo fallo seguro de `filtroEmpleados`.
  const alcance: UsuarioConAlcance & { role?: string | null } = usuario ?? { alcance: "PROPIO" };

  const hoy = hoyHN();
  const limiteContratos = new Date(hoy.getTime() + DIAS_AVISO_CONTRATO * 86_400_000);
  const contratosPorVencer = {
    activo: true,
    fechaFin: { not: null, lte: limiteContratos },
    empleado: { AND: [{ estado: { not: "INACTIVO" as const } }, filtroEmpleados(alcance)] },
  };

  const [empleados, activos, marcajesHoy, permisosPendientes, abiertas, periodosRecientes, prestamosPendientes, contratos, totalContratos, erroresSap, sinGenerar] =
    await Promise.all([
      veEmpleados ? prisma.empleado.count({ where: conAlcance({}, alcance) }) : null,
      veEmpleados ? prisma.empleado.count({ where: conAlcance({ estado: "ACTIVO" }, alcance) }) : null,
      // `hoyHN()` da la medianoche UTC del día de hoy en Honduras, que es lo
      // que compara bien contra una columna @db.Date.
      veAsistencia ? prisma.marcaje.count({ where: { fecha: hoy, ...filtroPorEmpleado(alcance) } }) : null,
      apruebaPermisos ? prisma.permiso.count({ where: permisosPorResolver(alcance) }) : 0,
      calculaPlanillas || apruebaPlanillas || pagaPlanillas
        ? prisma.planilla.findMany({
            // Sólo las que puede resolver: las que incluyen gente fuera de su alcance no le tocan.
            where: { estado: { in: ["BORRADOR", "CALCULADA", "APROBADA"] }, ...filtroPlanillasCompletas(alcance) },
            orderBy: { fechaFin: "desc" },
            select: { id: true, estado: true, totalNeto: true, tipo: true, fechaInicio: true, fechaFin: true },
          })
        : [],
      // Los últimos períodos de pago (fase 3): cada uno reúne las planillas de sus sucursales.
      vePlanillas
        ? prisma.planilla.groupBy({
            by: ["tipo", "fechaInicio", "fechaFin"],
            where: { AND: [filtroPlanillas(alcance), { estado: { not: "ANULADA" } }] },
            orderBy: [{ fechaInicio: "desc" }, { fechaFin: "desc" }],
            take: 5,
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
        ? prisma.sapEnvioAsiento.findMany({ where: { estado: "ERROR", planilla: filtroPlanillasCompletas(alcance) }, select: { planillaId: true }, orderBy: { updatedAt: "desc" } })
        : [],
      // Sucursales a las que ya les toca su planilla y no la tienen (fase 3).
      calculaPlanillas ? periodosSinGenerar(prisma, alcance, dia(hoy), await divisionesHabilitadas(prisma)) : [],
    ]);
  // Respaldos con error, atrasados, prueba de restauración fallida o automático apagado (2026-11-25).
  const deRespaldos = administraRespaldos ? await pendientesDeRespaldos(new Date(), !("error" in ubicarPostgres())).catch(() => []) : [];
  const respaldosApagados = deRespaldos.filter((x) => x.titulo === "Respaldos automáticos apagados");
  const respaldosGraves = deRespaldos.filter((x) => x.titulo !== "Respaldos automáticos apagados");

  // Las planillas de esos períodos, con sus montos (con alcance limitado, la suma de las personas que alcanza).
  const delosPeriodos = periodosRecientes.length === 0 ? [] : await prisma.planilla.findMany({
    where: { AND: [filtroPlanillas(alcance), { estado: { not: "ANULADA" } }, { OR: periodosRecientes.map((p) => ({ tipo: p.tipo, fechaInicio: p.fechaInicio, fechaFin: p.fechaFin })) }] },
    select: { id: true, tipo: true, fechaInicio: true, fechaFin: true, estado: true, totalBruto: true, totalDeducciones: true, totalNeto: true },
  });
  const visibles = await totalesVisibles(prisma, alcance, delosPeriodos.map((p) => p.id));
  const variasFrecuencias = new Set(periodosRecientes.map((p) => p.tipo)).size > 1;
  const ultimosPeriodos = periodosRecientes.map((g) => {
    const p = { tipo: g.tipo as TipoPlanillaPeriodo, desde: dia(g.fechaInicio), hasta: dia(g.fechaFin) };
    const suyas = delosPeriodos.filter((x) => claveDePeriodo({ tipo: x.tipo, desde: dia(x.fechaInicio), hasta: dia(x.fechaFin) }) === claveDePeriodo(p));
    const cuenta = (e: string) => suyas.filter((x) => x.estado === e).length;
    const pagadas = cuenta("PAGADA");
    return {
      ...p,
      clave: claveDePeriodo(p),
      nombre: nombreDePeriodo(p),
      planillas: suyas.length,
      neto: sumarPor(suyas, (x) => visibles?.get(x.id)?.totalNeto ?? x.totalNeto),
      estados: pagadas === suyas.length
        ? (suyas.length === 1 ? "Pagada" : "Todas pagadas")
        : PALABRAS_ESTADO.filter(([e]) => cuenta(e) > 0).map(([e, uno, varios]) => `${cuenta(e)} ${cuenta(e) === 1 ? uno : varios}`).join(", "),
      pendiente: pagadas < suyas.length,
    };
  });

  // Una sola: directo a ella. Varias: al período (o a la frecuencia), con ese estado.
  const destinoPlanillas = (estado: string, lista: Array<{ id: string; tipo: string }>) => {
    if (lista.length === 1) return `/planillas/${lista[0].id}`;
    const tipos = new Set(lista.map((p) => p.tipo));
    return `/planillas?estado=${estado}${tipos.size === 1 ? `&tipo=${lista[0].tipo}` : ""}`;
  };
  // «De la 2.ª quincena de noviembre de 2026.» si son todas del mismo período.
  const periodoDe = (lista: typeof abiertas) => {
    const claves = new Set(lista.map((p) => claveDePeriodo({ tipo: p.tipo, desde: dia(p.fechaInicio), hasta: dia(p.fechaFin) })));
    if (claves.size !== 1) return `De ${plural(claves.size, "período", "períodos")}. `;
    const p = { tipo: lista[0].tipo as TipoPlanillaPeriodo, desde: dia(lista[0].fechaInicio), hasta: dia(lista[0].fechaFin) };
    const frase = frasePeriodo(p, "de");
    return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}. `;
  };
  const planillasEn = (estado: string) => abiertas.filter((p) => p.estado === estado);
  const netoDe = (lista: typeof abiertas) => `Neto de ${formatCurrency(sumarPor(lista, (p) => p.totalNeto))}.`;
  const porPagar = pagaPlanillas ? planillasEn("APROBADA") : [];
  const porAprobar = apruebaPlanillas ? planillasEn("CALCULADA") : [];
  const borradores = calculaPlanillas ? planillasEn("BORRADOR") : [];

  const sinPlanilla = (x: (typeof sinGenerar)[number]) => ({
    n: x.sucursales.length,
    titulo: x.sucursales.length === 1 ? "Sucursal sin planilla" : "Sucursales sin planilla",
    detalle: `${nombreDePeriodo(x)}${x.vencido ? ", ya terminó" : ""}: ${algunosNombres(x.sucursales)}, con ${plural(x.empleados, "empleado", "empleados")}.`,
    href: `/planillas?tipo=${x.tipo}&vista=tablero`,
  });
  const pendientes = [
    // Un respaldo que falla pone en riesgo todo lo demás: arriba.
    ...respaldosGraves,
    // Un período que ya terminó sin la planilla de alguna sucursal va primero: hay gente sin pagar.
    ...sinGenerar.filter((x) => x.vencido).map(sinPlanilla),
    enviaSap && erroresSap.length > 0 && {
      n: erroresSap.length,
      titulo: erroresSap.length === 1 ? "Envío a SAP con error" : "Envíos a SAP con error",
      detalle: "SAP no los aceptó o se agotaron los reintentos: hace falta revisarlos.",
      href: `/planillas/${erroresSap[0].planillaId}`,
    },
    porPagar.length > 0 && {
      n: porPagar.length,
      titulo: porPagar.length === 1 ? "Planilla aprobada por pagar" : "Planillas aprobadas por pagar",
      detalle: `${periodoDe(porPagar)}${netoDe(porPagar)}`,
      href: destinoPlanillas("APROBADA", porPagar),
    },
    porAprobar.length > 0 && {
      n: porAprobar.length,
      titulo: porAprobar.length === 1 ? "Planilla por aprobar" : "Planillas por aprobar",
      detalle: `${periodoDe(porAprobar)}${netoDe(porAprobar)} ${porAprobar.length === 1 ? "Ya cobró" : "Ya cobraron"} cuotas y bonos.`,
      href: destinoPlanillas("CALCULADA", porAprobar),
    },
    borradores.length > 0 && {
      n: borradores.length,
      titulo: borradores.length === 1 ? "Borrador por confirmar" : "Borradores por confirmar",
      detalle: `${periodoDe(borradores)}${netoDe(borradores)} Todavía no ${borradores.length === 1 ? "cobra" : "cobran"} nada.`,
      href: destinoPlanillas("BORRADOR", borradores),
    },
    // El período en curso, ya cerca de su fin: el paso siguiente después de los borradores.
    ...sinGenerar.filter((x) => !x.vencido).map(sinPlanilla),
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
    ...respaldosApagados,
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
      href: "/planillas?generar=1",
      titulo: "Generar el período",
      detalle: "Un borrador por sucursal, para revisarlo antes de confirmarlo.",
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
              <h2 className="text-base font-semibold text-gray-900">Últimos períodos</h2>
              <Link href="/planillas" data-toque className="text-sm text-blue-600 hover:underline">
                Ver planillas
              </Link>
            </div>
            <div className="panel mt-3 overflow-hidden">
              {ultimosPeriodos.length === 0 ? (
                <EstadoVacio
                  titulo="Todavía no hay planillas."
                  detalle="Se generan desde Nómina, en Planillas: un borrador por sucursal para cada período."
                  accion={
                    calculaPlanillas && (
                      <Link href="/planillas?generar=1" className="btn btn-primary">
                        Generar el período
                      </Link>
                    )
                  }
                />
              ) : (
                <table className="table-base tabla-tarjetas" data-ultimos-periodos>
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th className="num">Planillas</th>
                      <th className="num">Neto</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ultimosPeriodos.map((p) => (
                      <FilaEnlace key={p.clave} href={`/planillas?tipo=${p.tipo}`}>
                        <td data-titulo>
                          <Link href={`/planillas?tipo=${p.tipo}`} className="font-medium text-gray-900 hover:text-blue-700">
                            {p.nombre}
                          </Link>
                          {variasFrecuencias && <span className="block text-xs text-gray-500">{ETIQUETA_TIPO_PLANILLA[p.tipo]}</span>}
                        </td>
                        <td data-etiqueta="Planillas" className="num">{p.planillas}</td>
                        <td data-etiqueta="Neto" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(p.neto)}</td>
                        <td data-etiqueta="Estado" className={p.pendiente ? "text-sm text-amber-900" : "text-sm text-gray-500"}>{p.estados}</td>
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
