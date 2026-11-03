"use client";

/**
 * Reportes: se elige uno y se ven sólo los filtros que ese reporte usa. Antes había un
 * único formulario para los dieciséis, y quien filtraba por fecha un reporte que no las
 * usa creía estar viendo un período que en realidad no se aplicaba.
 *
 * La lista de filtros de cada reporte (`DefReporte`) sale de lo que `/api/reportes` lee
 * de verdad para ese reporte: si se cambia allá, hay que cambiarla aquí.
 */

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import { columnasNumericas, metaFila, type MetaFila } from "@/lib/reportes/salida-celdas";

interface Props {
  /** El administrador habilitó el nivel División (Configuración, Estructura organizacional). */
  conDivisiones: boolean;
  sucursales: Array<{ id: string; nombre: string }>;
  /** Vacío si el administrador no habilitó el nivel División. */
  divisiones: Array<{ id: string; nombre: string; sucursalId: string }>;
  departamentos: Array<{ id: string; nombre: string; sucursalId: string; divisionId: string | null }>;
  /** Planillas vigentes; sólo las aprobadas o pagadas sirven para el archivo del banco. */
  planillas: Array<{ id: string; etiqueta: string; dispersable: boolean }>;
  /** Para llegar con un reporte ya elegido, por ejemplo desde un borrador. */
  reporteInicial?: string;
  planillaInicial?: string;
}

/** Qué período usa el reporte: ninguno, opcional, obligatorio o un año. */
type Periodo = "ninguno" | "opcional" | "requerido" | "anio";
/** Si el reporte trabaja sobre una planilla concreta. */
type UsoPlanilla = "no" | "opcional" | "requerida";

interface DefReporte {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  periodo: Periodo;
  planilla: UsoPlanilla;
}

const reportes: DefReporte[] = [
  { id: "planilla-detallada", nombre: "Planilla detallada", descripcion: "Deducciones por empleado, agrupadas por sucursal, división y departamento con subtotales.", categoria: "Planillas", periodo: "opcional", planilla: "opcional" },
  { id: "resumen-planilla", nombre: "Resumen de planilla", descripcion: "Totales por sucursal, división y departamento, en árbol.", categoria: "Planillas", periodo: "opcional", planilla: "opcional" },
  { id: "nomina-banco", nombre: "Nómina para banco", descripcion: "Transferencias bancarias para pagar una planilla aprobada o pagada.", categoria: "Planillas", periodo: "ninguno", planilla: "requerida" },
  { id: "ihss-planilla", nombre: "Planilla IHSS (proyectada)", descripcion: "Aportes IHSS EM/IVM estimados sobre el salario actual de los empleados activos.", categoria: "Legal", periodo: "ninguno", planilla: "no" },
  { id: "ihss-historico", nombre: "Planilla IHSS (histórica)", descripcion: "Aportes IHSS EM/IVM realmente registrados en las planillas del período.", categoria: "Legal", periodo: "opcional", planilla: "opcional" },
  { id: "rap-planilla", nombre: "Planilla RAP", descripcion: "Aportes al RAP de los empleados activos.", categoria: "Legal", periodo: "ninguno", planilla: "no" },
  { id: "isr-dmr", nombre: "Retenciones de ISR del mes (DMR)", descripcion: "RTN, ingreso anual proyectado, deducción y base mensual y retención de quien tuvo ISR en el mes.", categoria: "Legal", periodo: "requerido", planilla: "opcional" },
  { id: "isr-anual", nombre: "Constancia anual de ISR", descripcion: "Constancia de retención de ISR por empleado para la declaración anual.", categoria: "Legal", periodo: "anio", planilla: "no" },
  { id: "13vo-proyeccion", nombre: "Proyección del decimotercer mes", descripcion: "Acumulado de la provisión del décimo tercer mes.", categoria: "Provisiones", periodo: "anio", planilla: "no" },
  { id: "14vo-proyeccion", nombre: "Proyección del decimocuarto mes", descripcion: "Acumulado de la provisión del décimo cuarto mes.", categoria: "Provisiones", periodo: "anio", planilla: "no" },
  { id: "vacaciones-proyeccion", nombre: "Provisión de vacaciones", descripcion: "Saldo acumulado de vacaciones y provisión por empleado.", categoria: "Provisiones", periodo: "ninguno", planilla: "no" },
  { id: "empleados-activos", nombre: "Listado de empleados", descripcion: "Directorio de empleados activos con sus datos laborales.", categoria: "RRHH", periodo: "ninguno", planilla: "no" },
  { id: "historial-salarial", nombre: "Historial salarial", descripcion: "Los 200 cambios de salario más recientes.", categoria: "RRHH", periodo: "ninguno", planilla: "no" },
  { id: "evaluaciones-resumen", nombre: "Resumen de evaluaciones", descripcion: "Calificaciones de desempeño y competencias por período.", categoria: "RRHH", periodo: "opcional", planilla: "no" },
  { id: "asistencia-mensual", nombre: "Asistencia mensual", descripcion: "Asistencia, ausencias y horas extra del período.", categoria: "Asistencia", periodo: "opcional", planilla: "no" },
  { id: "puntualidad", nombre: "Puntualidad", descripcion: "Llegadas tarde según el turno y días laborales sin marca.", categoria: "Asistencia", periodo: "requerido", planilla: "no" },
];

const categorias = ["Planillas", "Legal", "Provisiones", "RRHH", "Asistencia"];

const anioActual = new Date().getFullYear();
const ANIOS = [anioActual, anioActual - 1, anioActual - 2, anioActual - 3];

type Formato = "XLSX" | "PDF" | "CSV";
const ETIQUETA_FORMATO: Record<Formato, string> = { XLSX: "Excel", PDF: "PDF", CSV: "CSV" };

interface Visor {
  reporteId: string;
  titulo: string;
  cabeceras: string[];
  datos: string[][];
  generado: string;
  filtros: string[];
  total: number;
  /** Sólo en reportes agrupados por estructura: tipo y nivel de cada fila. */
  filas?: MetaFila[];
}

/**
 * Nombre con el que se guarda la descarga. Lo decide el SERVIDOR, que es quien
 * sabe qué generó: se lee de Content-Disposition y, si no viniera, se deriva del
 * Content-Type.
 */
function nombreDescarga(res: Response, reporteId: string): string {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (m?.[1]) return decodeURIComponent(m[1].trim());

  const tipo = res.headers.get("Content-Type") ?? "";
  const ext = tipo.includes("spreadsheetml") ? "xlsx" : tipo.includes("pdf") ? "pdf" : tipo.includes("csv") ? "csv" : "html";
  return `${reporteId}_${new Date().toISOString().split("T")[0]}.${ext}`;
}

const etiquetaCampo = "mb-1 block text-xs font-medium text-gray-700";

export default function ReportesClient({ conDivisiones, sucursales, divisiones, departamentos, planillas, reporteInicial, planillaInicial }: Props) {
  const [elegido, setElegido] = useState(() => reportes.find((r) => r.id === reporteInicial)?.id ?? reportes[0].id);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<Visor | null>(null);
  const [porDivision, setPorDivision] = useState(false);
  // Los valores se conservan al pasar de un reporte a otro: lo usual es sacar varios del mismo período.
  const [filtros, setFiltros] = useState({
    fechaDesde: "",
    fechaHasta: "",
    anio: String(anioActual),
    sucursalId: "",
    divisionId: "",
    departamentoId: "",
    planillaId: planillaInicial ?? "",
  });
  const panel = useRef<HTMLElement>(null);

  const reporte = reportes.find((r) => r.id === elegido) ?? reportes[0];
  const descripcion = conDivisiones ? reporte.descripcion : reporte.descripcion.replace("sucursal, división y departamento", "sucursal y departamento");
  // El archivo del banco sólo admite una planilla aprobada o pagada.
  const planillasDelReporte = reporte.planilla === "requerida" ? planillas.filter((p) => p.dispersable) : planillas;

  function elegir(id: string) {
    setElegido(id);
    setError(null);
    window.history.replaceState(null, "", `?reporte=${id}`);
    // En pantalla angosta el panel queda debajo de la lista: hay que llevar la vista hasta él.
    if (window.matchMedia("(max-width: 1023.98px)").matches) {
      requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" }));
    }
  }

  const campo = (k: keyof typeof filtros) => ({
    value: filtros[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFiltros((f) => ({ ...f, [k]: e.target.value })),
  });

  // Selectores en cascada: Sucursal, División, Departamento. Al cambiar un
  // nivel se limpian los de abajo, que podrían ya no pertenecerle.
  const divisionesVisibles = divisiones.filter((v) => !filtros.sucursalId || v.sucursalId === filtros.sucursalId);
  const departamentosVisibles = departamentos.filter((d) =>
    (!filtros.sucursalId || d.sucursalId === filtros.sucursalId) && (!filtros.divisionId || d.divisionId === filtros.divisionId)
  );
  const nombreSucursal = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "";
  const cambiarSucursal = (sucursalId: string) => setFiltros((f) => ({ ...f, sucursalId, divisionId: "", departamentoId: "" }));
  const cambiarDivision = (divisionId: string) => setFiltros((f) => ({ ...f, divisionId, departamentoId: "" }));

  function validar(): boolean {
    if (reporte.planilla === "requerida" && !planillasDelReporte.some((p) => p.id === filtros.planillaId)) {
      setError("Seleccione la planilla: debe estar aprobada o pagada.");
      return false;
    }
    if (reporte.periodo === "requerido" && (!filtros.fechaDesde || !filtros.fechaHasta)) {
      setError("Indique las fechas Desde y Hasta.");
      return false;
    }
    return true;
  }

  function url(formato: Formato | "JSON"): string {
    const q = new URLSearchParams({ reporteId: reporte.id, formato });
    // Viaja sólo lo que este reporte usa: el documento no debe decir que se filtró por algo que no aplicó.
    if (reporte.periodo === "opcional" || reporte.periodo === "requerido") {
      if (filtros.fechaDesde) q.set("fechaDesde", filtros.fechaDesde);
      if (filtros.fechaHasta) q.set("fechaHasta", filtros.fechaHasta);
    }
    // Estos reportes toman el año de la fecha inicial.
    if (reporte.periodo === "anio") q.set("fechaDesde", `${filtros.anio}-01-01`);
    if (filtros.sucursalId) q.set("sucursalId", filtros.sucursalId);
    if (filtros.divisionId) q.set("divisionId", filtros.divisionId);
    if (filtros.departamentoId) q.set("departamentoId", filtros.departamentoId);
    if (reporte.planilla !== "no" && filtros.planillaId) q.set("planillaId", filtros.planillaId);
    // Sólo cambia lo que se imprime: en pantalla se sigue viendo el árbol completo.
    if (reporte.id === "planilla-detallada" && conDivisiones && porDivision && formato !== "JSON") q.set("porDivision", "1");
    return `/api/reportes?${q.toString()}`;
  }

  async function ver() {
    setError(null);
    if (!validar()) return;
    setOcupado(`${reporte.id}:ver`);
    try {
      const res = await fetch(url("JSON"));
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? "No se pudo generar el reporte.");
      setVisor(d as Visor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el reporte.");
    } finally {
      setOcupado(null);
    }
  }

  async function descargar(formato: Formato) {
    setError(null);
    if (!validar()) return;
    setOcupado(`${reporte.id}:${formato}`);
    try {
      const res = await fetch(url(formato));
      // El servidor explica por qué no puede generarlo; antes se mostraba un
      // mensaje genérico o, peor, se descargaba un archivo vacío.
      if (!res.ok) {
        const detalle = await res.json().catch(() => null);
        throw new Error(detalle?.error ?? "No se pudo generar el reporte.");
      }
      const blob = await res.blob();
      const enlace = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = enlace;
      a.download = nombreDescarga(res, reporte.id);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(enlace);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el reporte.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description="Planillas, obligaciones legales, provisiones y personal. Se ven aquí mismo y se exportan a Excel o PDF."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Lista de reportes" className="space-y-4">
          {categorias.map((c) => (
            <div key={c}>
              <h2 className="px-3 pb-1 text-xs font-medium text-gray-500">{c}</h2>
              <ul>
                {reportes.filter((r) => r.categoria === c).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={r.id === elegido ? "true" : undefined}
                      onClick={() => elegir(r.id)}
                      className={cn(
                        "w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors max-lg:py-2.5",
                        r.id === elegido ? "bg-blue-100 font-semibold text-blue-950" : "text-gray-700 hover:bg-gray-100"
                      )}
                    >
                      {r.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section id="panel-reporte" ref={panel} aria-labelledby="reporte-titulo" className="panel scroll-mt-4 p-5 lg:sticky lg:top-0">
          <h2 id="reporte-titulo" className="text-lg font-semibold text-gray-900">{reporte.nombre}</h2>
          <p className="mt-0.5 text-sm text-gray-500">{descripcion}</p>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reporte.planilla !== "no" && (
              <div className="sm:col-span-2 xl:col-span-3">
                <label htmlFor="rep-planilla" className={etiquetaCampo}>
                  Planilla{reporte.planilla === "requerida" && " (obligatoria)"}
                </label>
                <select id="rep-planilla" {...campo("planillaId")} className="input">
                  <option value="">
                    {reporte.planilla === "requerida"
                      ? planillasDelReporte.length ? "Seleccione…" : "No hay planillas aprobadas o pagadas"
                      : planillasDelReporte.length ? "Todas, según las fechas" : "No hay planillas vigentes"}
                  </option>
                  {planillasDelReporte.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
                </select>
              </div>
            )}
            {(reporte.periodo === "opcional" || reporte.periodo === "requerido") && (
              <>
                <div>
                  <label htmlFor="rep-desde" className={etiquetaCampo}>Desde{reporte.periodo === "requerido" && " (obligatorio)"}</label>
                  <input id="rep-desde" type="date" {...campo("fechaDesde")} className="input" />
                </div>
                <div>
                  <label htmlFor="rep-hasta" className={etiquetaCampo}>Hasta{reporte.periodo === "requerido" && " (obligatorio)"}</label>
                  <input id="rep-hasta" type="date" {...campo("fechaHasta")} className="input" />
                </div>
              </>
            )}
            {reporte.periodo === "anio" && (
              <div>
                <label htmlFor="rep-anio" className={etiquetaCampo}>Año</label>
                <select id="rep-anio" {...campo("anio")} className="input">
                  {ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="rep-sucursal" className={etiquetaCampo}>Sucursal</label>
              <select id="rep-sucursal" value={filtros.sucursalId} onChange={(e) => cambiarSucursal(e.target.value)} className="input">
                <option value="">Todas</option>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            {conDivisiones && (
              <div>
                <label htmlFor="rep-division" className={etiquetaCampo}>División</label>
                <select id="rep-division" value={filtros.divisionId} onChange={(e) => cambiarDivision(e.target.value)} className="input">
                  <option value="">Todas</option>
                  {divisionesVisibles.map((v) => (
                    <option key={v.id} value={v.id}>{filtros.sucursalId ? v.nombre : `${v.nombre} (${nombreSucursal(v.sucursalId)})`}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="rep-depto" className={etiquetaCampo}>Departamento</label>
              <select id="rep-depto" {...campo("departamentoId")} className="input">
                <option value="">Todos</option>
                {departamentosVisibles.map((d) => (
                  <option key={d.id} value={d.id}>{filtros.sucursalId ? d.nombre : `${d.nombre} (${nombreSucursal(d.sucursalId)})`}</option>
                ))}
              </select>
            </div>
          </div>

          {reporte.id === "planilla-detallada" && conDivisiones && (
            <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={porDivision} onChange={(e) => setPorDivision(e.target.checked)} />
              Imprimir cada división en hoja aparte (PDF y Excel)
            </label>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={ver} disabled={ocupado !== null} className="btn btn-primary">
              {ocupado === `${reporte.id}:ver` ? "Generando…" : "Ver en pantalla"}
            </button>
            <button type="button" onClick={() => descargar("XLSX")} disabled={ocupado !== null} className="btn btn-secondary">
              {ocupado === `${reporte.id}:XLSX` ? "Generando…" : "Excel"}
            </button>
            <button type="button" onClick={() => descargar("PDF")} disabled={ocupado !== null} className="btn btn-secondary">
              {ocupado === `${reporte.id}:PDF` ? "Generando…" : "PDF"}
            </button>
          </div>
        </section>
      </div>

      {visor && (
        <VisorReporte
          visor={visor}
          ocupado={ocupado}
          onCerrar={() => setVisor(null)}
          onExportar={(formato) => descargar(formato)}
        />
      )}
    </div>
  );
}

function VisorReporte({
  visor,
  ocupado,
  onCerrar,
  onExportar,
}: {
  visor: Visor;
  ocupado: string | null;
  onCerrar: () => void;
  onExportar: (formato: Formato) => void;
}) {
  const numericas = useMemo(() => columnasNumericas(visor.cabeceras, visor.datos), [visor]);
  const generado = new Date(visor.generado).toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tegucigalpa" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="visor-titulo">
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id="visor-titulo" className="text-lg font-semibold text-gray-900">{visor.titulo}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {visor.total === 1 ? "1 registro" : `${visor.total} registros`}, generado el {generado}
              {visor.filtros.length > 0 && <>. {visor.filtros.join(". ")}.</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["XLSX", "PDF", "CSV"] as Formato[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onExportar(f)}
                disabled={ocupado !== null}
                className={cn("btn btn-sm", f === "XLSX" ? "btn-primary" : "btn-secondary")}
              >
                {ocupado === `${visor.reporteId}:${f}` ? "Generando" : `Exportar a ${ETIQUETA_FORMATO[f]}`}
              </button>
            ))}
            <button type="button" onClick={onCerrar} className="btn btn-ghost btn-sm">
              Cerrar
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          {visor.datos.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-gray-900">Sin registros para los filtros elegidos.</p>
              <p className="mt-1 text-sm text-gray-500">Amplíe las fechas o quite la sucursal y vuelva a generar.</p>
            </div>
          ) : (
            <table className="table-base text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  {visor.cabeceras.map((h, i) => (
                    <th key={i} className={cn("px-3", numericas[i] && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visor.datos.map((fila, f) => {
                  const m = metaFila(fila, visor.filas?.[f]);
                  // Sangría por nivel en los reportes agrupados (Sucursal → División → Departamento).
                  const sangria = visor.filas ? { paddingLeft: `${0.75 + m.nivel * 1.25}rem` } : undefined;
                  if (m.tipo === "grupo") {
                    return (
                      <tr key={f}>
                        <td colSpan={visor.cabeceras.length} style={sangria}
                          className={cn("px-3 py-2 font-semibold text-gray-900", m.nivel === 0 ? "bg-blue-50" : m.nivel === 1 ? "bg-gray-100" : "bg-gray-50")}>
                          {fila[0]}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={f} className={cn(
                      m.tipo === "total" && "bg-gray-50 font-semibold text-gray-900",
                      m.tipo === "subtotal" && "font-semibold text-gray-900 [&>td]:border-t [&>td]:border-gray-300",
                    )}>
                      {visor.cabeceras.map((_, i) => (
                        <td key={i} style={i === 0 ? sangria : undefined} className={cn("whitespace-nowrap px-3 py-2", numericas[i] && "text-right")}>{fila[i] ?? ""}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
