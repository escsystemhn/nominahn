/**
 * La lista de Planillas por período de pago (fase 1, 2026-11-24; ver la maqueta aprobada y
 * `lib/payroll/planillas-por-periodo.ts`). Se dibuja en el servidor con `<details>`: abrir
 * y cerrar no necesita JavaScript. Las casillas y los botones de cada período los escucha
 * `SeleccionPlanillas`; los de «Generar» (`data-generar`), `GenerarPeriodo`.
 *
 * Fase 2: en los períodos del mes más reciente, qué sucursales no tienen todavía su
 * planilla y quién quedó fuera de la suya; y el período en curso, si aún no tiene ninguna.
 */

import Link from "next/link";
import EstadoBadge, { estadoDePlanilla } from "@/components/ui/EstadoBadge";
import FilaEnlace from "@/components/ui/FilaEnlace";
import { cn, formatCurrency } from "@/lib/utils";
import { enCurso, rangoLegible, type AnioDePeriodos, type EstadoLista, type MesDePeriodos, type Periodo, type PlanillasPorPeriodo as Grupos, type Resumen } from "@/lib/payroll/planillas-por-periodo";
import { unirNombres } from "@/lib/payroll/lote-planillas";
import { ETIQUETA_TIPO_PLANILLA, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";

/** Lo que falta en un período: sucursales sin planilla y personas fuera de la suya. */
export interface FaltaEnPeriodo {
  faltan: Array<{ nombre: string; empleados: number }>;
  fuera: Array<{ nombre: string; empleados: number; planillaId: string; estado: EstadoLista }>;
}

/** El período en curso cuando todavía no tiene ninguna planilla. */
export interface PeriodoSinGenerar {
  tipo: TipoPlanillaPeriodo;
  desde: string;
  hasta: string;
  nombre: string;
  /** «2026-11»: para ponerlo en la sección de su mes. */
  mes: string;
  nombreMes: string;
  sucursales: number;
  empleados: number;
}

interface Contexto {
  hoy: string;
  puedeImprimir: boolean;
  puedeGenerar: boolean;
  faltantes: Record<string, FaltaEnPeriodo>;
}

const ESTADOS: Array<{ estado: EstadoLista; plural: string; punto: string }> = [
  { estado: "BORRADOR", plural: "en borrador", punto: "bg-amber-500" },
  { estado: "CALCULADA", plural: "confirmadas", punto: "bg-blue-500" },
  { estado: "APROBADA", plural: "aprobadas", punto: "bg-amber-500" },
  { estado: "PAGADA", plural: "pagadas", punto: "bg-green-600" },
  { estado: "ANULADA", plural: "anuladas", punto: "bg-red-600" },
];
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «4 en borrador, 3 confirmadas, 2 sin generar», cada uno con su punto. */
function EstadosDe({ r, sinGenerar = 0 }: { r: Resumen; sinGenerar?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {ESTADOS.filter((e) => r.porEstado[e.estado]).map((e) => (
        <span key={e.estado} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-gray-700">
          <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", e.punto)} />
          {r.porEstado[e.estado]} {r.porEstado[e.estado] === 1 ? e.plural.replace(/s$/, "") : e.plural}
        </span>
      ))}
      {sinGenerar > 0 && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-gray-700" data-sin-generar-cuenta>
          <span aria-hidden="true" className="h-2 w-2 rounded-full border-[1.5px] border-dashed border-gray-500" />
          {sinGenerar} sin generar
        </span>
      )}
    </span>
  );
}

/** El botón que abre «Generar» con el período ya elegido (lo escucha `GenerarPeriodo`). */
function BotonGenerar({ p, children, primario = false }: { p: { tipo: string; desde: string; hasta: string }; children: React.ReactNode; primario?: boolean }) {
  return (
    <button type="button" className={cn("btn btn-sm", primario ? "btn-primary" : "btn-secondary")} data-generar data-tipo={p.tipo} data-desde={p.desde} data-hasta={p.hasta}>
      {children}
    </button>
  );
}

/** Debajo de la tabla de un período: las sucursales sin planilla y quién quedó fuera de la suya. */
function FaltaGenerar({ p, f, puedeGenerar }: { p: Periodo; f: FaltaEnPeriodo; puedeGenerar: boolean }) {
  const empleados = f.faltan.reduce((n, u) => n + u.empleados, 0);
  const frecuencia = ETIQUETA_TIPO_PLANILLA[p.tipo].toLowerCase();
  return (
    <>
      {f.faltan.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-gray-300 bg-gray-50 px-4 py-2.5 text-sm" data-falta-generar>
          <p className="min-w-0 flex-1 text-gray-700">
            Falta generar: <span className="font-semibold text-gray-900">{unirNombres(f.faltan.map((u) => u.nombre))}</span>, con {plural(empleados, "empleado", "empleados")} de planilla {frecuencia} que todavía no {empleados === 1 ? "tiene" : "tienen"} la de este período.
          </p>
          {puedeGenerar && <BotonGenerar p={p}>{f.faltan.length === 1 ? "Generar la que falta" : `Generar las ${f.faltan.length} que faltan`}</BotonGenerar>}
        </div>
      )}
      {f.fuera.map((u) => (
        <p key={u.planillaId} className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-fuera-de-planilla>
          {u.nombre}: {plural(u.empleados, "empleado de planilla", "empleados de planilla")} {frecuencia} no {u.empleados === 1 ? "está" : "están"} en su planilla de este período (entró o cambió de sucursal después de generarla).
          {u.estado === "BORRADOR" ? " Recalcule el borrador para incluirlo." : ""}{" "}
          <Link href={`/planillas/${u.planillaId}`} className="font-medium underline">Abrir la planilla</Link>
        </p>
      ))}
    </>
  );
}

/** Lo que dice una fila cerrada: todo pagado, o lo que falta. */
function Estado({ r }: { r: Resumen }) {
  if (r.pendientes) {
    return <span className="whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">{plural(r.pendientes, "sin pagar", "sin pagar")}</span>;
  }
  return <span className="whitespace-nowrap text-sm text-gray-500">{r.pagadas === r.vigentes ? `${r.pagadas} de ${r.vigentes} pagadas` : plural(r.vigentes, "planilla", "planillas")}</span>;
}

const Flecha = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-90 motion-reduce:transition-none">
    <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Fila({ titulo, sub, derecha, nivel = 3 }: { titulo: React.ReactNode; sub: React.ReactNode; derecha: React.ReactNode; nivel?: 2 | 3 }) {
  const T = nivel === 2 ? "h2" : "h3";
  return (
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
      <Flecha />
      {/* Con base propia: en pantalla angosta lo de la derecha baja de línea en vez de apretar el título. */}
      <span className="min-w-0 flex-1 basis-56">
        <T className={cn("font-semibold text-gray-900", nivel === 2 ? "text-base" : "text-[15px]")}>{titulo}</T>
        <span className="block text-sm text-gray-500">{sub}</span>
      </span>
      <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">{derecha}</span>
    </summary>
  );
}

function TablaPeriodo({ p, c }: { p: Periodo; c: Contexto }) {
  const { puedeImprimir } = c;
  const vigentes = p.planillas.filter((x) => x.estado !== "ANULADA");
  const ids = vigentes.map((x) => x.id).join(",");
  // Todas del mismo grupo: el grupo una vez arriba y, en cada fila, sólo la sucursal.
  const partes = p.planillas.map((x) => x.alcance.split(" / "));
  const grupo = partes.length > 1 && partes.every((ps) => ps.length > 1 && ps[0] === partes[0][0]) ? partes[0][0] : null;
  const nombreDe = (i: number) => (grupo ? partes[i].slice(1).join(" / ") : p.planillas[i].alcance);
  return (
    <div className="border-t border-gray-100">
      {vigentes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-acciones-periodo>
          {/* En el celular la tabla es de tarjetas y su encabezado (con la casilla del período) no se ve. */}
          <label className="inline-flex min-h-6 w-full items-center gap-2 text-sm font-medium text-gray-700 sm:hidden">
            <input type="checkbox" className="h-4 w-4" data-sel-periodo={p.clave} data-sel-periodo-movil aria-label={`Marcar las planillas de ${p.nombre}`} />
            Marcar todas
          </label>
          {grupo && <span className="mr-auto text-sm font-medium text-gray-700">{grupo}</span>}
          {puedeImprimir && (
            <button type="button" className="btn btn-secondary btn-sm" data-lote="imprimir" data-ids={ids} data-nombre={p.nombre}>Imprimir el período</button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" data-lote="comprobantes" data-ids={ids} data-nombre={p.nombre}>Comprobantes del período</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base tabla-tarjetas">
          <thead>
            <tr>
              <th className="w-10">
                {vigentes.length > 0 && (
                  <input type="checkbox" className="h-4 w-4" data-sel-periodo={p.clave} aria-label={`Marcar las planillas de ${p.nombre}`} />
                )}
              </th>
              <th>Sucursal</th>
              <th className="num">Empleados</th>
              <th className="num">Bruto</th>
              <th className="num">Deducciones</th>
              <th className="num">Neto</th>
              <th>Estado</th>
              <th><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody>
            {p.planillas.map((x, i) => (
              <FilaEnlace key={x.id} href={`/planillas/${x.id}`} className={x.estado === "ANULADA" ? "opacity-60" : undefined}>
                <td data-accion>
                  {x.estado !== "ANULADA" && (
                    <input type="checkbox" className="h-4 w-4" data-sel-planilla={x.id} data-periodo={p.clave} data-neto={String(x.neto)}
                      data-estado={x.estado} data-nombre={nombreDe(i)} data-periodo-nombre={p.nombre} aria-label={`Marcar ${x.alcance}`} />
                  )}
                </td>
                <td data-titulo className="font-medium text-gray-900">
                  <Link href={`/planillas/${x.id}`} className="hover:text-blue-700">{nombreDe(i)}</Link>
                </td>
                <td data-etiqueta="Empleados" className="num">{x.empleados}</td>
                <td data-etiqueta="Bruto" className="num">{formatCurrency(x.bruto)}</td>
                <td data-etiqueta="Deducciones" className="num text-gray-500">{formatCurrency(x.deducciones)}</td>
                <td data-etiqueta="Neto" className="num font-medium text-gray-900">{formatCurrency(x.neto)}</td>
                <td data-etiqueta="Estado"><EstadoBadge valor={estadoDePlanilla(x.estado)} /></td>
                <td data-accion className="text-right">
                  <Link href={`/planillas/${x.id}`} className="text-sm font-medium text-blue-600 hover:underline">Ver detalle</Link>
                </td>
              </FilaEnlace>
            ))}
          </tbody>
        </table>
      </div>
      {c.faltantes[p.clave] && <FaltaGenerar p={p} f={c.faltantes[p.clave]} puedeGenerar={c.puedeGenerar} />}
    </div>
  );
}

function BloquePeriodo({ p, abierto, c, nivel = 3 }: { p: Periodo; abierto: boolean; c: Contexto; nivel?: 2 | 3 }) {
  const actual = enCurso(p, c.hoy);
  const sinGenerar = c.faltantes[p.clave]?.faltan.length ?? 0;
  return (
    <details className={cn("group panel overflow-hidden", actual && "border-blue-500 ring-1 ring-blue-500")} open={abierto} data-periodo={p.clave}>
      <Fila
        nivel={nivel}
        titulo={p.nombre}
        sub={<>{rangoLegible(p.desde, p.hasta)}{actual && <span className="ml-2 text-xs font-semibold text-blue-700">Período en curso</span>}</>}
        derecha={<>
          {abierto || p.pendientes || sinGenerar ? <EstadosDe r={p} sinGenerar={sinGenerar} /> : <Estado r={p} />}
          <span className="num font-semibold text-gray-900">{formatCurrency(p.neto)}</span>
        </>}
      />
      <TablaPeriodo p={p} c={c} />
    </details>
  );
}

function BloqueMes({ m, c }: { m: MesDePeriodos; c: Contexto }) {
  // Un mes de una sola planilla mensual es su período: no hace falta otro nivel.
  if (m.periodos.length === 1 && m.periodos[0].tipo === "MENSUAL") return <BloquePeriodo p={m.periodos[0]} abierto={false} c={c} />;
  const tipo = m.periodos[0]?.tipo;
  return (
    <details className="group panel overflow-hidden" data-mes={m.clave}>
      <Fila
        titulo={m.nombre}
        sub={`${tipo === "QUINCENAL" ? `${plural(m.periodos.length, "quincena", "quincenas")}, ` : tipo === "SEMANAL" ? `${plural(m.periodos.length, "semana", "semanas")}, ` : ""}${plural(m.cantidad, "planilla", "planillas")}`}
        derecha={<><Estado r={m} /><span className="num font-semibold text-gray-900">{formatCurrency(m.neto)}</span></>}
      />
      <div className="space-y-2 border-t border-gray-100 bg-gray-50/60 p-2 sm:pl-6">
        {m.periodos.map((p) => <BloquePeriodo key={p.clave} p={p} abierto={false} c={c} />)}
      </div>
    </details>
  );
}

function BloqueAnio({ a, c }: { a: AnioDePeriodos; c: Contexto }) {
  return (
    <details className="group panel overflow-hidden" data-anio={a.anio}>
      <Fila
        titulo={String(a.anio)}
        sub={`${plural(a.cantidad, "planilla", "planillas")}${a.pendientes ? "" : a.vigentes ? ", todas pagadas" : ""}`}
        derecha={<>{a.pendientes ? <Estado r={a} /> : null}<span className="num font-semibold text-gray-900">{formatCurrency(a.neto)}</span></>}
      />
      <div className="space-y-2 border-t border-gray-100 bg-gray-50/60 p-2 sm:pl-6">
        {a.meses.map((m) => <BloqueMes key={m.clave} m={m} c={c} />)}
      </div>
    </details>
  );
}

/** El período en curso sin ninguna planilla: un hueco con borde punteado y el botón para generarlo. */
function HuecoDelPeriodo({ g, puedeGenerar }: { g: PeriodoSinGenerar; puedeGenerar: boolean }) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 border-dashed border-blue-400 px-4 py-3" data-periodo-sin-generar>
      <span className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-gray-900">{g.nombre}</h2>
        <span className="block text-sm text-gray-500">{rangoLegible(g.desde, g.hasta)}<span className="ml-2 text-xs font-semibold text-blue-700">Período en curso</span></span>
      </span>
      <span className="text-sm text-gray-600">Todavía sin planillas: {plural(g.sucursales, "sucursal", "sucursales")}, {plural(g.empleados, "empleado", "empleados")}.</span>
      {puedeGenerar && <BotonGenerar p={g} primario>Generar el período</BotonGenerar>}
    </div>
  );
}

export default function PlanillasPorPeriodo({ grupos, hoy, puedeImprimir, puedeGenerar = false, faltantes = {}, sinGenerar = null }: {
  grupos: Grupos;
  hoy: string;
  puedeImprimir: boolean;
  puedeGenerar?: boolean;
  /** Por clave de período (`claveDePeriodo`): sólo los del mes más reciente. */
  faltantes?: Record<string, FaltaEnPeriodo>;
  sinGenerar?: PeriodoSinGenerar | null;
}) {
  const { reciente, anteriores, anios } = grupos;
  if (!reciente && !sinGenerar) return null;
  const c: Contexto = { hoy, puedeImprimir, puedeGenerar, faltantes };
  const esteMes = hoy.slice(0, 7);
  // El hueco va con su mes: arriba del mes más reciente si es el mismo; si no, en una
  // sección propia antes o después de él, según cuál sea más reciente.
  const huecoAparte = !!sinGenerar && sinGenerar.mes !== reciente?.clave;
  const seccionHueco = sinGenerar && huecoAparte && (
    <section className="space-y-2" aria-labelledby="planillas-en-curso">
      <h2 id="planillas-en-curso" className="text-sm font-semibold text-gray-500">{sinGenerar.nombreMes}{sinGenerar.mes === esteMes ? ", este mes" : ""}</h2>
      <HuecoDelPeriodo g={sinGenerar} puedeGenerar={puedeGenerar} />
    </section>
  );
  const huecoAntes = !reciente || (sinGenerar?.mes ?? "") > reciente.clave;
  return (
    <div className="space-y-6" data-por-periodo>
      {huecoAntes && seccionHueco}
      {reciente && (
        <section className="space-y-2" aria-labelledby="planillas-recientes">
          <h2 id="planillas-recientes" className="text-sm font-semibold text-gray-500">{reciente.nombre}{esteMes === reciente.clave ? ", este mes" : huecoAparte ? "" : ", el mes más reciente"}</h2>
          {sinGenerar && !huecoAparte && <HuecoDelPeriodo g={sinGenerar} puedeGenerar={puedeGenerar} />}
          {reciente.periodos.map((p, i) => <BloquePeriodo key={p.clave} p={p} abierto={i === 0} c={c} nivel={2} />)}
        </section>
      )}
      {!huecoAntes && seccionHueco}
      {anteriores.length > 0 && (
        <section className="space-y-2" aria-labelledby="planillas-meses">
          <h2 id="planillas-meses" className="text-sm font-semibold text-gray-500">Meses anteriores</h2>
          {anteriores.map((m) => <BloqueMes key={m.clave} m={m} c={c} />)}
        </section>
      )}
      {anios.length > 0 && (
        <section className="space-y-2" aria-labelledby="planillas-anios">
          <h2 id="planillas-anios" className="text-sm font-semibold text-gray-500">Años anteriores</h2>
          {anios.map((a) => <BloqueAnio key={a.anio} a={a} c={c} />)}
        </section>
      )}
    </div>
  );
}
