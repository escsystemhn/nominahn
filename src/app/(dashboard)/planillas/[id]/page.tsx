import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { accesoAPlanilla } from "@/lib/payroll/alcance-planilla";
import { resumenDeRevision } from "@/lib/payroll/revision-planilla";
import { cargarRevision } from "@/lib/payroll/revision-planilla-bd";
import BarraEstadoPlanilla from "@/components/payroll/BarraEstadoPlanilla";
import RevisionPlanilla from "@/components/payroll/RevisionPlanilla";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate, formatMonto, nombreCompleto } from "@/lib/utils";
import { textoAntiguedad } from "@/lib/empleados/antiguedad";
import { COOKIE_VISTA_PLANILLA, comparadorPlanilla, describirOrden, leerVista, type FilaOrdenable } from "@/lib/payroll/vista-planilla";
import VistaPlanillaControles from "@/components/payroll/VistaPlanillaControles";
import OrdenDeducciones from "@/components/payroll/OrdenDeducciones";
import { nombresEnOrden } from "@/lib/deducciones/orden-columnas";
import PlanillaActions from "@/components/payroll/PlanillaActions";
import { BotonComprobantes } from "@/components/payroll/ComprobantesLote";
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
import { CERO, money, sumarPor, type Money } from "@/lib/payroll/money";
import { avisosDeDeducciones, columnasDeDeducciones, deduccionesPorNombre, leerDeduccionesGuardadas } from "@/lib/payroll/deducciones-de-linea";
import type { DetalleIsrPersonalizado } from "@/lib/payroll/isr-personalizado";
import { isrEsManual } from "@/lib/payroll/isr-personalizado-bd";
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
  // Con el ISR en manual, quien revisa debe saber que la planilla no lo calcula.
  const isrManual = enRevision && (await isrEsManual(prisma));
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

  // Cada deducción por su tipo, como en la planilla de la empresa: lo guardado al calcular.
  // Una línea de antes se arma con lo cobrado registrado (si la planilla se confirmó) o por categoría.
  const sinTipos = planilla.detalles.some((d) => leerDeduccionesGuardadas(d.deducciones) === null);
  const cobradas = sinTipos
    ? await prisma.amortizacionPlanilla.findMany({
      where: { planillaId: id },
      select: { montoAplicado: true, deduccion: { select: { empleadoId: true, tipoDeduccion: { select: { nombre: true } } } } },
    })
    : [];
  const cobradasDe = new Map<string, { nombre: string; monto: Money }[]>();
  for (const c of cobradas) {
    const lista = cobradasDe.get(c.deduccion.empleadoId) ?? [];
    lista.push({ nombre: c.deduccion.tipoDeduccion.nombre, monto: money(c.montoAplicado) });
    cobradasDe.set(c.deduccion.empleadoId, lista);
  }
  const porTipo = new Map(planilla.detalles.map((d) => [d.id, deduccionesPorNombre(d, cobradasDe.get(d.empleadoId))]));
  // En el orden que eligió la empresa (Orden de las deducciones): el mismo que al imprimir.
  const tipos = columnasDeDeducciones(porTipo.values(), await nombresEnOrden(prisma));
  const hayAlguno = (f: (d: Detalle) => unknown) => planilla.detalles.some((d) => !money(f(d) as number).isZero());

  // Cómo la quiere ver esta persona (cookie): el orden y si ingresos y deducciones van con
  // todas sus columnas o resumidos en su total (pedido de Edbin, 2026-11-23).
  const vista = leerVista((await cookies()).get(COOKIE_VISTA_PLANILLA)?.value);
  const detalleIngresos = vista.ingresos === "todo";
  const detalleDeducciones = vista.deducciones === "todo";

  // Las columnas de montos, en grupos con su rótulo encima: con 20 columnas, el grupo dice
  // dónde se está. Una columna que nadie tiene no se muestra (sólo ruido de ceros).
  type GrupoColumna = "ingresos" | "ley" | "empleado" | "deducciones" | "totales";
  interface ColumnaMonto { titulo: string; grupo: GrupoColumna; valor: (d: Detalle) => Money | number | string | { toString(): string }; fuerte?: boolean; total?: boolean }
  const siHay = (titulo: string, grupo: GrupoColumna, valor: (d: Detalle) => Money | number | string | { toString(): string }): ColumnaMonto[] =>
    hayAlguno(valor) ? [{ titulo, grupo, valor }] : [];
  const columnas: ColumnaMonto[] = [
    // Ingresos: con detalle, sus partes (salario + horas extra + bonificaciones + otros = bruto).
    ...(detalleIngresos
      ? [
          ...siHay("Salario", "ingresos", (d) => d.salarioBase),
          ...siHay("Monto h. extra", "ingresos", (d) => d.montoHorasExtra),
          ...siHay("Bonificaciones", "ingresos", (d) => d.bonificaciones),
          ...siHay("Otros ingresos", "ingresos", (d) => d.otrosIngresos),
        ]
      : []),
    { titulo: "Bruto", grupo: "ingresos", valor: (d) => d.totalBruto, total: detalleIngresos },
    // Deducciones: con detalle, las de ley y cada tipo; resumidas, sólo su total.
    ...(detalleDeducciones
      ? [
          ...siHay("IHSS", "ley", (d) => d.ihssEmpleado),
          ...siHay("RAP", "ley", (d) => d.rapEmpleado),
          ...siHay("ISR", "ley", (d) => d.isr),
          ...siHay("Vecinal", "ley", (d) => d.impuestoVecinal),
          ...tipos.map((nombre) => ({ titulo: nombre, grupo: "empleado" as const, valor: (d: Detalle) => porTipo.get(d.id)?.get(nombre) ?? CERO })),
          ...siHay("Ausencias", "empleado", (d) => d.ausencias),
          ...siHay("Incapacidad", "empleado", (d) => d.incapacidad),
          { titulo: "Total ded.", grupo: "totales" as const, valor: (d: Detalle) => d.totalDeducciones, total: true },
        ]
      : [{ titulo: "Total ded.", grupo: "deducciones" as const, valor: (d: Detalle) => d.totalDeducciones, total: true }]),
    { titulo: "Neto", grupo: "totales", valor: (d) => d.salarioNeto, fuerte: true },
  ];
  const conHorasExtra = detalleIngresos && planilla.detalles.some((d) => Number(d.horasExtra) !== 0);
  // Una línea divisoria donde empieza cada grupo (Días y H. extra van con los ingresos).
  const empiezaGrupo = columnas.map((c, j) => c.grupo !== (j === 0 ? "ingresos" : columnas[j - 1].grupo));
  const ROTULOS: Record<GrupoColumna, string> = { ingresos: "Ingresos", ley: "De ley", empleado: "Deducciones del empleado", deducciones: "Deducciones", totales: "Totales" };
  const gruposDeColumnas = (["ingresos", "ley", "empleado", "deducciones", "totales"] as const)
    .map((g) => ({ g, titulo: ROTULOS[g], span: columnas.filter((c) => c.grupo === g).length + (g === "ingresos" ? 1 + Number(conHorasExtra) : 0) }))
    .filter((x) => x.span > 0);
  // Hay líneas que todavía muestran las deducciones por categoría: recalcular el borrador las pone por tipo.
  const porCategoria = sinTipos && planilla.detalles.some((d) => leerDeduccionesGuardadas(d.deducciones) === null && (cobradasDe.get(d.empleadoId)?.length ?? 0) === 0
    && !money(d.cooperativa).plus(money(d.prestamos)).plus(money(d.adelantos)).plus(money(d.afpEmpleado)).plus(money(d.otrosDeducciones)).isZero());

  // En borrador: lo que pasa del tope de ley (se cobra igual) y lo que no se cobró completo
  // porque el salario quedaría en negativo. Se revisa antes de confirmar.
  const avisos = planilla.estado === "BORRADOR"
    ? planilla.detalles.map((d) => ({ d, ...avisosDeDeducciones(d.deducciones) })).filter((a) => a.sobreTope.length || a.incompletas.length)
    : [];
  const avisoDe = new Map(avisos.map((a) => [a.d.id, a]));
  const sobreTope = avisos.flatMap((a) => a.sobreTope.map((x) => ({ id: a.d.id, empleado: nombreCompleto(a.d.empleado), ...x })));
  const incompletas = avisos.flatMap((a) => a.incompletas.map((x) => ({ id: a.d.id, empleado: nombreCompleto(a.d.empleado), ...x })));
  const avisoDeCelda = (d: Detalle, columna: string): string | undefined => {
    const a = avisoDe.get(d.id);
    const t = a?.sobreTope.find((x) => x.nombre === columna);
    if (t) return `Pasa el tope de ley: el tope era ${formatCurrency(t.tope)} y se cobra completo.`;
    const i = a?.incompletas.find((x) => x.nombre === columna);
    if (i) return `Se cobró ${formatCurrency(i.monto)} de ${formatCurrency(i.asignado)}: el salario quedaría en negativo.`;
    return undefined;
  };

  // Sucursal → División → Departamento → Empleado, con subtotal en cada nivel.
  // Sin el nivel División habilitado, Sucursal → Departamento.
  // Dentro de cada departamento, por el campo que eligió esta persona (antigüedad por omisión).
  const nombres = new Map(planilla.detalles.map((d) => [d.id, nombreCompleto(d.empleado)]));
  const filas = new Map(planilla.detalles.map((d): [string, FilaOrdenable] => [d.id, {
    nombre: nombres.get(d.id)!, fechaIngreso: d.empleado.fechaIngreso, codigo: d.empleado.codigo,
    apellido: [d.empleado.primerApellido, d.empleado.segundoApellido, d.empleado.primerNombre, d.empleado.segundoNombre].filter(Boolean).join(" "),
    salario: Number(d.salarioBase), bruto: Number(d.totalBruto), deducciones: Number(d.totalDeducciones), neto: Number(d.salarioNeto),
  }]));
  const comparar = comparadorPlanilla(vista.orden, vista.dir);
  const ordenados = [...planilla.detalles].sort((a, b) => comparar(filas.get(a.id)!, filas.get(b.id)!));
  const entradas = aplanarEstructura(agruparPorEstructura(ordenados, (d) => ubicacionDeLinea(d, opciones.conDivisiones), niveles.sinDivision));
  const montos = (ds: Detalle[]) => columnas.map((c) => sumarPor(ds, (d) => money(c.valor(d) as number)));
  // Sangría corta: los empleados se alinean con el nombre de su departamento, y el nombre
  // completo cabe en una línea.
  const sangria = (nivel: number) => ({ paddingLeft: `${0.75 + nivel * 0.75}rem` });
  const sangriaLinea = (nivel: number) => sangria(Math.max(0, nivel - 1));
  // El cero no es un dato que buscar: un guion tenue, para que salte a la vista lo que sí hay.
  const celdaMonto = (m: Money) => m.isZero()
    ? <><span aria-hidden="true" className="text-gray-300">–</span><span className="sr-only">0.00</span></>
    : formatMonto(m);
  // Cálculo personalizado: de dónde salió el ISR de la línea, al pasar el ratón.
  const explicarIsr = (j: unknown): string | undefined => {
    const x = j as DetalleIsrPersonalizado | null;
    if (!x || x.metodo !== "PERSONALIZADO") return undefined;
    return `Cálculo personalizado: ingreso anual proyectado ${formatCurrency(x.ingresoAnual)} menos deducciones ${formatCurrency(x.deducciones)}` +
      ` = ${formatCurrency(x.renta)}; ISR anual ${formatCurrency(x.isrAnual)} menos lo ya retenido ${formatCurrency(x.retenidoPrevio)},` +
      ` entre ${x.periodosRestantes} período(s) que faltan.`;
  };
  // Empleado, días y horas extra; los montos; y el comprobante.
  const COLUMNAS = 2 + Number(conHorasExtra) + columnas.length + 1;

  // Imprime lo que se está viendo: la misma planilla, con el filtro de arriba si lo hay.
  const urlImprimir = (separar: boolean) => {
    const q = new URLSearchParams({ reporteId: "planilla-detallada", planillaId: planilla.id, formato: "PDF", modo: "ver" });
    if (alcance.sucursalId) q.set("sucursalId", alcance.sucursalId);
    if (alcance.divisionId) q.set("divisionId", alcance.divisionId);
    if (alcance.departamentoId) q.set("departamentoId", alcance.departamentoId);
    if (separar) q.set("porDivision", "1");
    // La impresa, en el mismo orden que la pantalla.
    q.set("orden", vista.orden);
    q.set("dir", vista.dir);
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
            {/* Todos los de la planilla, por correo (aprobada o pagada) o impresos: reemplaza a «Enviar comprobantes por correo». */}
            {planilla.estado !== "ANULADA" && <BotonComprobantes planillaId={planilla.id} puedeEnviar={puede(usuario, "planillas.boletas")} />}
            {!parcial && <PlanillaActions
              planillaId={planilla.id}
              estado={planilla.estado}
              puedeCalcular={puede(usuario, "planillas.calcular")}
              puedeAprobar={puede(usuario, "planillas.aprobar")}
              puedePagar={puede(usuario, "planillas.pagar")}
              puedeAnular={puede(usuario, "planillas.anular")}
              puedeReabrir={puede(usuario, "planillas.reabrir")}
              puedeAnularPagada={puede(usuario, "planillas.anular_pagada")}
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

      {(sobreTope.length > 0 || incompletas.length > 0) && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-aviso-deducciones>
          <p className="font-semibold">Revise estas deducciones antes de confirmar.</p>
          {sobreTope.length > 0 && (
            <>
              <p className="mt-2">
                Pasan el tope de ley (la cuarta parte de lo que el salario excede al mínimo, Arts. 371 y 372 del Código del
                Trabajo). Se cobran completas, como las asignó:
              </p>
              <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
                {sobreTope.map((x) => (
                  <li key={`t${x.id}${x.nombre}`} data-aviso-tope>
                    {x.empleado}, {x.nombre}: {formatCurrency(x.monto)} <span className="text-amber-800">(el tope era {formatCurrency(x.tope)})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {incompletas.length > 0 && (
            <>
              <p className="mt-2">
                No se cobraron completas porque el salario quedaría en negativo. Lo que falta de un préstamo con saldo queda
                pendiente; lo de un monto del período no pasa a la siguiente:
              </p>
              <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
                {incompletas.map((x) => (
                  <li key={`i${x.id}${x.nombre}`} data-aviso-incompleta>
                    {x.empleado}, {x.nombre}: se cobró {formatCurrency(x.monto)} de {formatCurrency(x.asignado)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {isrManual && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-isr-manual>
          <p className="font-semibold">El ISR está en manual.</p>
          <p className="mt-1">
            Esta planilla no calcula el ISR: retiene lo importado para el período en Deducciones → Importar → Montos del período o, si no
            hay, la retención fija de la ficha. A quien no tenga ninguna no se le retiene. Si importó el ISR después de calcularla, use
            Recalcular. Se cambia en{" "}
            <Link href="/configuracion?seccion=parametros" className="font-medium underline underline-offset-2">Parámetros de ley</Link>.
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

      {porCategoria && (
        <p className="text-xs text-gray-500" data-por-categoria>
          Algunas líneas se calcularon antes de guardar cada deducción por su tipo y la muestran por categoría
          {enRevision ? ": recalcule el borrador para verlas por tipo." : "."}
        </p>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <VistaPlanillaControles vista={vista} />
          {puede(usuario, "deducciones.configurar") && <OrdenDeducciones enPlanilla={tipos} />}
        </div>
        <p className="text-xs text-gray-500" data-orden-planilla>
          En cada departamento, {describirOrden(vista)}. Montos en lempiras.
          {(!detalleIngresos || !detalleDeducciones) && " Con el detalle apagado, el grupo muestra sólo su total."}
        </p>
      </div>

      <div className="panel overflow-hidden">
        <div className="tabla-fija relative overflow-x-auto">
          <table className="table-base tabla-planilla text-xs">
            <thead>
              <tr>
                <th rowSpan={2} className="col-fija px-3 align-bottom">Empleado</th>
                {gruposDeColumnas.map((x, k) => (
                  <th key={x.g} colSpan={x.span} scope="colgroup" data-divide={k > 0 ? "" : undefined}
                    className={cn("h-7 px-3 py-0 font-semibold text-gray-700", k > 0 && "border-l border-gray-200")}>{x.titulo}</th>
                ))}
                <th rowSpan={2} data-divide="" className="border-l border-gray-200 px-3 text-center align-bottom">Comprobante</th>
              </tr>
              <tr>
                <th className="num px-3 align-bottom">Días</th>
                {conHorasExtra && <th className="num px-3 align-bottom">H. extra</th>}
                {columnas.map((c, j) => (
                  // Un nombre largo («Préstamo BANCATLAN») se parte en dos líneas en vez de ensanchar la tabla.
                  <th key={c.titulo} data-divide={empiezaGrupo[j] ? "" : undefined} className={cn("num px-3 align-bottom", empiezaGrupo[j] && "border-l border-gray-200", (c.fuerte || c.total) && "text-gray-900",
                    !c.fuerte && c.titulo.length > 10 && "min-w-[6.5rem] whitespace-normal")}>{c.titulo}</th>
                ))}
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
                        className={cn("py-1.5 text-[13px] font-semibold text-gray-900", e.nivel === 0 ? "bg-blue-50" : e.nivel === 1 ? "bg-gray-100" : "bg-gray-50")}>
                        {/* Fijo al recorrer la tabla de lado: si no, el grupo se pierde de vista. */}
                        <span className="sticky left-3 inline-flex items-baseline gap-2">
                          {e.grupo.nombre}
                          <span className="text-xs font-normal text-gray-500">{e.grupo.items.length === 1 ? "1 empleado" : `${e.grupo.items.length} empleados`}</span>
                        </span>
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
                      <td colSpan={1 + Number(conHorasExtra)} />
                      {montos(e.grupo.items).map((m, j) => (
                        <td key={j} className={cn("num whitespace-nowrap px-3 py-2", empiezaGrupo[j] && "border-l border-gray-200")}>{celdaMonto(m)}</td>
                      ))}
                      <td className="border-l border-gray-200" />
                    </tr>
                  );
                }
                const d = e.item;
                return (
                <tr key={d.id} data-linea>
                  <td className="col-fija py-2 pr-4" style={sangriaLinea(e.nivel)}>
                    {/* El nombre en una línea; debajo, el código y desde cuándo está: es lo que ordena la lista. */}
                    <div className="text-[13px] font-medium text-gray-900 sm:whitespace-nowrap">{nombres.get(d.id)}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-gray-500 sm:flex-nowrap sm:whitespace-nowrap">
                      <span className="font-mono">{d.empleado.codigo}</span>
                      <span>Ingreso {formatDate(d.empleado.fechaIngreso)}, {textoAntiguedad(d.empleado.fechaIngreso, planilla.fechaFin)}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-2">{Number(d.diasTrabajados).toFixed(0)}</td>
                  {conHorasExtra && <td className="num px-3 py-2">{Number(d.horasExtra) === 0 ? celdaMonto(CERO) : Number(d.horasExtra).toFixed(1)}</td>}
                  {columnas.map((c, j) => {
                    const aviso = avisoDeCelda(d, c.titulo);
                    return (
                    <td key={c.titulo} className={cn("num whitespace-nowrap px-3 py-2", empiezaGrupo[j] && "border-l border-gray-200", c.total && "font-medium text-gray-900",
                      c.fuerte && "font-semibold text-gray-900", aviso && "bg-amber-50 font-medium text-amber-900")}
                      title={c.titulo === "ISR" ? explicarIsr(d.isrDetalle) : aviso} data-aviso-celda={aviso ? "" : undefined}>
                      {celdaMonto(money(c.valor(d) as number))}
                      {c.titulo === "IHSS" && d.ihssFijo && (
                        <span className="block text-xs text-gray-500" title="Monto fijo pactado en la ficha del empleado">
                          fijo
                        </span>
                      )}
                    </td>
                    );
                  })}
                  <td className="border-l border-gray-200 px-3 py-2">
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
                <td colSpan={2 + Number(conHorasExtra)} className="px-3 py-3">
                  {hayFiltro ? "Totales del filtro" : "Totales"}
                </td>
                {montos(planilla.detalles).map((m, j) => (
                  <td key={j} className={cn("num whitespace-nowrap px-3 py-3", empiezaGrupo[j] && "border-l border-gray-200", columnas[j].fuerte && "text-blue-800")}>{celdaMonto(m)}</td>
                ))}
                <td className="border-l border-gray-200" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
