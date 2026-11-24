import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { alcanceEsTotal, filtroPorEmpleado } from "@/lib/auth/alcance";
import { filtroPlanillas, totalesVisibles } from "@/lib/payroll/alcance-planilla";
import Link from "next/link";
import { cn, formatCurrency, formatDate, hoyHN } from "@/lib/utils";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { Prisma } from "@prisma/client";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FilaEnlace from "@/components/ui/FilaEnlace";
import FormFiltros from "@/components/ui/FormFiltros";
import FranjaCifras from "@/components/ui/FranjaCifras";
import Paginacion from "@/components/ui/Paginacion";
import ThOrden from "@/components/ui/ThOrden";
import OrdenMovil from "@/components/ui/OrdenMovil";
import { leerOrden, type Orden } from "@/lib/http/orden";
import EstadoBadge, { estadoDePlanilla, etiquetaEstado } from "@/components/ui/EstadoBadge";
import FiltroEstructura from "@/components/organizacion/FiltroEstructura";
import { describirAlcance, etiquetasNiveles, filtroDetallesOrg, filtroEmpleadosOrg, normalizarAlcance } from "@/lib/organizacion/estructura";
import { cargarOpcionesEstructura } from "@/lib/organizacion/estructura-bd";
import PlanillasPorPeriodo, { type FaltaEnPeriodo, type PeriodoSinGenerar } from "@/components/payroll/PlanillasPorPeriodo";
import SeleccionPlanillas from "@/components/payroll/SeleccionPlanillas";
import GenerarPeriodo from "@/components/payroll/GenerarPeriodo";
import TableroPlanillas from "@/components/payroll/TableroPlanillas";
import { armarTablero, columnasDelTablero, type FaltaDelTablero, type PeriodoClave } from "@/lib/payroll/tablero-planillas";
import { agruparPorPeriodo, claveDePeriodo, nombreDePeriodo, nombreMes, type EstadoLista } from "@/lib/payroll/planillas-por-periodo";
import { faltantesDelPeriodo } from "@/lib/payroll/faltantes-periodo-bd";
import { nombresDeUnidades } from "@/lib/payroll/lote-planillas";
import { COOKIE_VISTA_PLANILLA, leerVista } from "@/lib/payroll/vista-planilla";
import { ETIQUETA_TIPO_PLANILLA, TIPOS_PLANILLA, periodoQueContiene, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";

export const metadata = { title: "Planillas" };

const ESTADOS = ["BORRADOR", "CALCULADA", "APROBADA", "PAGADA", "ANULADA"] as const;
const POR_PAGINA = 25;

const COLUMNAS = ["creada", "tipo", "periodo", "bruto", "deducciones", "neto", "estado"] as const;
type Columna = (typeof COLUMNAS)[number];

function ordenDeConsulta({ campo, dir }: Orden<Columna>): Prisma.PlanillaOrderByWithRelationInput[] {
  const principal: Record<Columna, Prisma.PlanillaOrderByWithRelationInput> = {
    creada: { createdAt: dir },
    tipo: { tipo: dir },
    periodo: { fechaInicio: dir },
    bruto: { totalBruto: dir },
    deducciones: { totalDeducciones: dir },
    neto: { totalNeto: dir },
    estado: { estado: dir },
  };
  // El `id` desempata: sin él, dos filas iguales pueden saltar de una página a otra.
  return [principal[campo], { id: "desc" }];
}

export default async function PlanillasPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursalId?: string; divisionId?: string; departamentoId?: string; estado?: string; orden?: string; dir?: string; page?: string; tipo?: string; vista?: string; generar?: string }>;
}) {
  // Antes esta página no llamaba a auth() en absoluto: el menú lateral ocultaba
  // el enlace, pero escribir la URL mostraba la nómina completa a cualquiera.
  const usuario = await requerirPermisoPagina("planillas.ver");
  const puedeCrear = puede(usuario, "planillas.calcular");

  const sp = await searchParams;
  const opciones = await cargarOpcionesEstructura(prisma);
  const niveles = etiquetasNiveles(opciones.jerarquia);
  const alcance = normalizarAlcance({ ...sp, divisionId: opciones.conDivisiones ? sp.divisionId : null });
  const hayFiltro = !!(alcance.sucursalId || alcance.divisionId || alcance.departamentoId);

  // Filtrar = planillas que INCLUYEN personal de esa unidad (según dónde estaba
  // cada quien al pagarse): una planilla de toda la empresa también paga a la
  // gente de cada sucursal, y por eso aparece.
  const unidad = { select: { nombre: true } } as const;
  // Con AND: el filtro de unidad y el de alcance miran la misma relación, y uno no debe pisar al otro.
  const whereUnidad: Prisma.PlanillaWhereInput = { AND: [hayFiltro ? { detalles: { some: filtroDetallesOrg(alcance) } } : {}, filtroPlanillas(usuario)] };
  const estado = ESTADOS.find((e) => e === sp.estado);
  const where: Prisma.PlanillaWhereInput = { ...whereUnidad, ...(estado ? { estado } : {}) };
  // Con alcance limitado, ordenar por monto revelaría el tamaño de cada planilla entera.
  const ordenaMontos = alcanceEsTotal(usuario);
  const orden = leerOrden(sp, ordenaMontos ? COLUMNAS : COLUMNAS.filter((c) => !["bruto", "deducciones", "neto"].includes(c)), { campo: "creada", dir: "desc" });
  const pagina = Math.max(1, parseInt(sp.page ?? "1") || 1);

  // «Por período» (por omisión, pedido de Edbin del 2026-11-24), el tablero sucursal × período o la lista de siempre.
  const enLista = sp.vista === "lista";
  const enTablero = sp.vista === "tablero";

  // Cuántas hay de cada frecuencia y estado, con los filtros de arriba: las pestañas y los pendientes.
  const conteos = await prisma.planilla.groupBy({ by: ["tipo", "estado"], where: whereUnidad, _count: { _all: true } });
  const cuantas = (f: (c: (typeof conteos)[number]) => boolean) => conteos.filter(f).reduce((n, c) => n + c._count._all, 0);
  const PENDIENTES = ["BORRADOR", "CALCULADA", "APROBADA"] as const;
  const tiposConPlanillas = TIPOS_PLANILLA.filter((t) => cuantas((c) => c.tipo === t) > 0);
  // Con un estado elegido (p. ej. desde Inicio), la primera frecuencia que tiene planillas en ese estado.
  const tiposDelEstado = estado ? TIPOS_PLANILLA.filter((t) => cuantas((c) => c.tipo === t && c.estado === estado) > 0) : [];
  const tipo: TipoPlanillaPeriodo = (TIPOS_PLANILLA as readonly string[]).includes(sp.tipo ?? "")
    ? (sp.tipo as TipoPlanillaPeriodo)
    : tiposDelEstado[0] ?? tiposConPlanillas[0] ?? "QUINCENAL";

  const [total, planillas, delTipo] = await Promise.all([
    enLista ? prisma.planilla.count({ where }) : Promise.resolve(0),
    enLista
      ? prisma.planilla.findMany({
        where,
        include: { empresa: unidad, sucursal: unidad, division: unidad, departamento: unidad },
        orderBy: ordenDeConsulta(orden),
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      })
      : Promise.resolve([]),
    // Todas las de la frecuencia: se agrupan por período, mes y año.
    enLista
      ? Promise.resolve([])
      : prisma.planilla.findMany({
        where: { AND: [where, { tipo }] },
        select: {
          id: true, tipo: true, fechaInicio: true, fechaFin: true, estado: true, totalBruto: true, totalDeducciones: true, totalNeto: true,
          empresaId: true, sucursalId: true, divisionId: true, departamentoId: true,
          sucursal: unidad, division: unidad, departamento: unidad,
          // Con alcance limitado, sólo las personas que alcanza.
          _count: { select: { detalles: { where: filtroPorEmpleado(usuario) } } },
        },
        orderBy: { fechaInicio: "desc" },
        take: 5000,
      }),
  ]);

  // Con alcance limitado, los montos son la suma de las personas que alcanza.
  const visibles = await totalesVisibles(prisma, usuario, [...planillas, ...delTipo].map((p) => p.id));
  const cifras = (p: { id: string; totalBruto: Prisma.Decimal; totalDeducciones: Prisma.Decimal; totalNeto: Prisma.Decimal }) => visibles?.get(p.id) ?? p;
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const grupos = agruparPorPeriodo(delTipo.map((p) => ({
    id: p.id, tipo: p.tipo as TipoPlanillaPeriodo, desde: dia(p.fechaInicio), hasta: dia(p.fechaFin), estado: p.estado as EstadoLista,
    bruto: cifras(p).totalBruto, deducciones: cifras(p).totalDeducciones, neto: cifras(p).totalNeto,
    empleados: p._count.detalles, alcance: describirAlcance(p, niveles.todaLaEmpresa),
  })));
  // La impresa sale en el orden en que esta persona ve la planilla.
  const vistaPlanilla = leerVista((await cookies()).get(COOKIE_VISTA_PLANILLA)?.value);

  // ─── Lo que falta generar (fase 2) ──────────────────────────────────────────
  // En los períodos del mes más reciente y en el período en curso, para quien puede
  // generar: qué sucursales no tienen su planilla y quién quedó fuera de la suya.
  const hoy = dia(hoyHN());
  const actual = periodoQueContiene(tipo, hoy);
  const opcionesFaltan = {
    conDivisiones: opciones.conDivisiones,
    filtroOrg: filtroEmpleadosOrg(alcance),
    filtroPlanillasOrg: hayFiltro ? { detalles: { some: filtroDetallesOrg(alcance) } } : undefined,
  };
  const faltasDe = (periodos: readonly PeriodoClave[]) => Promise.all(periodos.map((p) => faltantesDelPeriodo(
    prisma,
    { tipo: p.tipo, desde: new Date(`${p.desde}T00:00:00.000Z`), hasta: new Date(`${p.hasta}T00:00:00.000Z`) },
    usuario,
    opcionesFaltan,
  )));
  const faltantes: Record<string, FaltaEnPeriodo> = {};
  let sinGenerar: PeriodoSinGenerar | null = null;
  if (!enLista && !enTablero && puedeCrear) {
    const revisar = [...(grupos.reciente?.periodos ?? []).map((p) => ({ tipo: p.tipo, desde: p.desde, hasta: p.hasta }))];
    if (!revisar.some((p) => claveDePeriodo(p) === claveDePeriodo(actual))) revisar.unshift(actual);
    const resultados = await faltasDe(revisar);
    for (const [i, p] of revisar.entries()) {
      const r = resultados[i];
      const clave = claveDePeriodo(p);
      if (r.planillas.length === 0) {
        // Ninguna planilla todavía: si es el período en curso y hay a quién pagar, se dibuja su hueco.
        if (clave === claveDePeriodo(actual) && r.faltan.length > 0) {
          sinGenerar = {
            ...p, nombre: nombreDePeriodo(p), mes: p.desde.slice(0, 7), nombreMes: nombreMes(Number(p.desde.slice(0, 4)), Number(p.desde.slice(5, 7)) - 1),
            sucursales: r.faltan.length, empleados: r.faltan.reduce((n, u) => n + u.empleados, 0),
          };
        }
        continue;
      }
      if (r.faltan.length === 0 && r.fuera.length === 0) continue;
      const nombresFaltan = nombresDeUnidades(r.faltan);
      const nombresFuera = nombresDeUnidades(r.fuera);
      faltantes[clave] = {
        faltan: r.faltan.map((u, j) => ({ nombre: nombresFaltan[j], empleados: u.empleados })),
        fuera: r.fuera.map((u, j) => ({ nombre: nombresFuera[j], empleados: u.empleados, planillaId: u.planilla!.id, estado: u.planilla!.estado })),
      };
    }
  }
  // ─── Tablero sucursal × período (fase 3) ───────────────────────────────────
  let tablero: ReturnType<typeof armarTablero> | null = null;
  if (enTablero) {
    const conPlanillas = [...new Map(delTipo.map((p) => {
      const x: PeriodoClave = { tipo, desde: dia(p.fechaInicio), hasta: dia(p.fechaFin) };
      return [claveDePeriodo(x), x] as const;
    })).values()];
    const faltan: Record<string, FaltaDelTablero[]> = {};
    const aTablero = (r: Awaited<ReturnType<typeof faltasDe>>[number]): FaltaDelTablero[] =>
      r.faltan.map((u) => ({ empresaId: u.empresaId, sucursalId: u.sucursalId, divisionId: u.divisionId, grupo: u.grupo, nombre: u.nombre, empleados: u.empleados }));
    // El período en curso entra aunque no tenga planillas, si ya hay a quién pagar en él.
    let enCurso: PeriodoClave | null = null;
    if (puedeCrear && !conPlanillas.some((p) => claveDePeriodo(p) === claveDePeriodo(actual))) {
      const [r] = await faltasDe([actual]);
      if (r.faltan.length > 0) {
        enCurso = actual;
        faltan[claveDePeriodo(actual)] = aTablero(r);
      }
    }
    const columnas = columnasDelTablero(conPlanillas, enCurso);
    if (puedeCrear) {
      const resto = columnas.filter((p) => !faltan[claveDePeriodo(p)]);
      const rs = await faltasDe(resto);
      resto.forEach((p, i) => { faltan[claveDePeriodo(p)] = aTablero(rs[i]); });
    }
    tablero = armarTablero(columnas, delTipo.map((p) => ({
      id: p.id, tipo, desde: dia(p.fechaInicio), hasta: dia(p.fechaFin), estado: p.estado as EstadoLista, neto: Number(cifras(p).totalNeto),
      empresaId: p.empresaId, sucursalId: p.sucursalId, divisionId: p.divisionId, departamentoId: p.departamentoId,
      grupo: p.sucursal?.nombre ?? null, division: p.division?.nombre ?? null, departamento: p.departamento?.nombre ?? null,
    })), faltan, hoy);
  }

  // «Generar período» cuenta y genera sólo lo del filtro de la lista, igual que «Falta generar».
  const filtroGenerar = new URLSearchParams(Object.entries(alcance).filter((e): e is [string, string] => !!e[1])).toString();
  const nombreFiltro = hayFiltro
    ? [
      opciones.sucursales.find((x) => x.id === alcance.sucursalId)?.nombre,
      opciones.divisiones.find((x) => x.id === alcance.divisionId)?.nombre,
      opciones.departamentos.find((x) => x.id === alcance.departamentoId)?.nombre,
    ].filter(Boolean).join(" / ") || null
    : null;
  // Lo que cada cuenta puede hacer por lote (la ruta de cada planilla lo vuelve a comprobar).
  const permisosLote = (["planillas.calcular", "planillas.aprobar", "planillas.pagar", "planillas.boletas"] as const).filter((x) => puede(usuario, x));

  // Enlaces que conservan filtros y orden.
  const consulta = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...cambios })) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const enlaceOrden = (o: Orden<Columna>) => consulta({ orden: o.campo, dir: o.dir, page: undefined });
  const enlacePagina = (n: number) => consulta({ page: String(n) });
  const th = { actual: orden, enlace: enlaceOrden };

  // En una sola empresa la columna repite lo mismo en todas las filas.
  const variasEmpresas = new Set(planillas.map((p) => p.empresaId)).size > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planillas"
        description="Por período de pago: cada quincena reúne las planillas de sus sucursales, para generarlas, confirmarlas, aprobarlas, pagarlas e imprimirlas juntas."
        actions={
          puedeCrear && (
            <>
              <Link href="/planillas/nueva" className="btn btn-secondary">
                Nueva planilla
              </Link>
              <GenerarPeriodo tipoInicial={tipo} filtro={filtroGenerar} nombreFiltro={nombreFiltro} abrirAlCargar={sp.generar === "1"} />
            </>
          )
        }
      >
        <FormFiltros campos={["sucursalId", "divisionId", "departamentoId", "estado"]} etiqueta="Filtrar planillas" className="flex flex-wrap gap-2">
          <FiltroEstructura {...opciones} inicial={sp} />
          <select name="estado" defaultValue={estado ?? ""} aria-label="Estado" className="input w-auto">
            <option value="">Todos los estados</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>{etiquetaEstado(estadoDePlanilla(e))}</option>
            ))}
          </select>
        </FormFiltros>
        {enLista && <OrdenMovil
          className="mt-2"
          actual={orden}
          opciones={[
            { campo: "creada", etiqueta: "Creación", tipo: "fecha" },
            { campo: "tipo", etiqueta: "Planilla", tipo: "texto" },
            { campo: "periodo", etiqueta: "Período", tipo: "fecha" },
            ...(ordenaMontos ? (["bruto", "deducciones", "neto"] as const).map((c) => ({ campo: c, etiqueta: c === "bruto" ? "Bruto" : c === "neto" ? "Neto" : "Deducciones", tipo: "numero" as const })) : []),
            { campo: "estado", etiqueta: "Estado", tipo: "texto" },
          ]}
        />}
      </PageHeader>

      {/* Lo que espera a alguien, de todas las frecuencias: cada cifra lleva a la lista filtrada. */}
      <FranjaCifras
        etiqueta="Pendientes"
        cifras={[
          ["BORRADOR", "Borradores sin confirmar"],
          ["CALCULADA", "Confirmadas sin aprobar"],
          ["APROBADA", "Aprobadas sin pagar"],
        ].map(([e, label]) => {
          const n = cuantas((c) => c.estado === e);
          return {
            label,
            valor: n,
            detalle: n > 0 ? <Link href={consulta({ vista: "lista", estado: e, page: undefined, tipo: undefined })} className="font-medium text-blue-600 hover:underline">Verlas</Link> : "Ninguna",
          };
        })}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        {tiposConPlanillas.length > 0 ? (
          <nav className="flex flex-wrap gap-1 border-b border-gray-200" aria-label="Frecuencia">
            {tiposConPlanillas.map((t) => {
              const pend = cuantas((c) => c.tipo === t && (PENDIENTES as readonly string[]).includes(c.estado));
              const activa = !enLista && t === tipo;
              return (
                <Link key={t} href={consulta({ tipo: t, vista: enTablero ? "tablero" : undefined, page: undefined })} aria-current={activa ? "page" : undefined}
                  className={cn("-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                    activa ? "border-blue-500 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800")}>
                  {ETIQUETA_TIPO_PLANILLA[t]}
                  {pend > 0 && <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 text-xs font-semibold text-amber-900" title={`${pend} por atender`}>{pend}</span>}
                </Link>
              );
            })}
          </nav>
        ) : <span />}
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white text-sm" role="group" aria-label="Vista">
          <Link href={consulta({ vista: undefined, page: undefined })} aria-current={!enLista && !enTablero ? "page" : undefined}
            className={cn("px-3 py-1.5 font-medium", !enLista && !enTablero ? "bg-blue-50 text-gray-900" : "text-gray-500 hover:text-gray-800")}>Por período</Link>
          <Link href={consulta({ vista: "tablero", page: undefined })} aria-current={enTablero ? "page" : undefined}
            className={cn("border-l border-gray-200 px-3 py-1.5 font-medium", enTablero ? "bg-blue-50 text-gray-900" : "text-gray-500 hover:text-gray-800")}>Tablero</Link>
          <Link href={consulta({ vista: "lista", page: undefined })} aria-current={enLista ? "page" : undefined}
            className={cn("border-l border-gray-200 px-3 py-1.5 font-medium", enLista ? "bg-blue-50 text-gray-900" : "text-gray-500 hover:text-gray-800")}>Lista</Link>
        </div>
      </div>

      {enTablero && (
        tablero && tablero.columnas.length > 0 ? (
          <TableroPlanillas columnas={tablero.columnas} filas={tablero.filas} puedeGenerar={puedeCrear} />
        ) : (
          <div className="panel">
            <EstadoVacio
              titulo={estado ? "Ninguna planilla en ese estado." : hayFiltro ? "Ninguna planilla incluye personal de esa unidad." : "Todavía no hay planillas de esta frecuencia."}
              detalle={hayFiltro || estado ? "Quite o cambie el filtro para ver las demás." : "Cuando se genere la primera, el tablero mostrará cada sucursal por período."}
            />
          </div>
        )
      )}

      {!enLista && !enTablero && (
        grupos.reciente || sinGenerar ? (
          <SeleccionPlanillas puedeImprimir={puede(usuario, "reportes.ver")} permisos={[...permisosLote]} orden={vistaPlanilla.orden} dir={vistaPlanilla.dir}>
            <PlanillasPorPeriodo grupos={grupos} hoy={hoy} puedeImprimir={puede(usuario, "reportes.ver")}
              puedeGenerar={puedeCrear} faltantes={faltantes} sinGenerar={sinGenerar} />
          </SeleccionPlanillas>
        ) : (
          <div className="panel">
            <EstadoVacio
              titulo={estado ? "Ninguna planilla en ese estado." : hayFiltro ? "Ninguna planilla incluye personal de esa unidad." : "Todavía no hay planillas."}
              detalle={hayFiltro || estado ? "Quite o cambie el filtro para ver las demás." : puedeCrear ? "Genere la primera: queda en borrador para revisarla antes de confirmarla." : "Cuando Nómina genere una, aparecerá aquí."}
              accion={puedeCrear && !hayFiltro && !estado && <Link href="/planillas/nueva" className="btn btn-primary">Nueva planilla</Link>}
            />
          </div>
        )
      )}

      {enLista && (
      <div className="panel overflow-hidden">
        <div className="tabla-fija overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <ThOrden campo="tipo" {...th}>Planilla</ThOrden>
                <ThOrden campo="periodo" dirInicial="desc" {...th}>Período</ThOrden>
                {variasEmpresas && <th>{niveles.empresaLegal}</th>}
                <th>Alcance</th>
                {ordenaMontos ? <ThOrden campo="bruto" dirInicial="desc" className="num" {...th}>Bruto</ThOrden> : <th className="num">Bruto</th>}
                {ordenaMontos ? <ThOrden campo="deducciones" dirInicial="desc" className="num" {...th}>Deducciones</ThOrden> : <th className="num">Deducciones</th>}
                {ordenaMontos ? <ThOrden campo="neto" dirInicial="desc" className="num" {...th}>Neto</ThOrden> : <th className="num">Neto</th>}
                <ThOrden campo="estado" {...th}>Estado</ThOrden>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {planillas.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EstadoVacio
                      titulo={estado ? "Ninguna planilla en ese estado." : hayFiltro ? "Ninguna planilla incluye personal de esa unidad." : "Todavía no hay planillas."}
                      detalle={
                        hayFiltro || estado
                          ? "Quite o cambie el filtro para ver las demás."
                          : puedeCrear
                            ? "Genere la primera: queda en borrador para revisarla antes de confirmarla."
                            : "Cuando Nómina genere una, aparecerá aquí."
                      }
                      accion={
                        puedeCrear && !hayFiltro && !estado && (
                          <Link href="/planillas/nueva" className="btn btn-primary">
                            Nueva planilla
                          </Link>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                planillas.map((p) => (
                  <FilaEnlace key={p.id} href={`/planillas/${p.id}`}>
                    <td data-titulo>
                      <Link href={`/planillas/${p.id}`} className="font-medium text-gray-900 hover:text-blue-700">
                        {etiquetaEstado(p.tipo)}
                      </Link>
                    </td>
                    <td data-etiqueta="Período" className="whitespace-nowrap">
                      {formatDate(p.fechaInicio)} al {formatDate(p.fechaFin)}
                    </td>
                    {variasEmpresas && <td data-etiqueta={niveles.empresaLegal}>{p.empresa.nombre}</td>}
                    <td data-etiqueta="Alcance" className="text-gray-600">{describirAlcance(p, niveles.todaLaEmpresa)}</td>
                    <td data-etiqueta="Bruto" className="num whitespace-nowrap">{formatCurrency(cifras(p).totalBruto)}</td>
                    <td data-etiqueta="Deducciones" className="num whitespace-nowrap text-gray-500">{formatCurrency(cifras(p).totalDeducciones)}</td>
                    <td data-etiqueta="Neto" className="num whitespace-nowrap font-medium text-gray-900">{formatCurrency(cifras(p).totalNeto)}</td>
                    <td data-etiqueta="Estado">
                      <EstadoBadge valor={estadoDePlanilla(p.estado)} />
                    </td>
                    <td data-accion className="text-right">
                      <Link href={`/planillas/${p.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                        Ver detalle
                      </Link>
                    </td>
                  </FilaEnlace>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Paginacion pagina={pagina} totalPaginas={Math.ceil(total / POR_PAGINA)} enlace={enlacePagina} />
      </div>
      )}
    </div>
  );
}
