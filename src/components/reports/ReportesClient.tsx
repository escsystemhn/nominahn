"use client";

/**
 * Reportes: se ven dentro de la aplicación y desde el visor se exportan a
 * Excel o PDF (y CSV para quien lo necesite). Los filtros de arriba aplican a
 * cualquier reporte que se abra o descargue.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import { columnasNumericas, esFilaTotal } from "@/lib/reportes/salida-celdas";

interface Props {
  sucursales: Array<{ id: string; nombre: string }>;
  departamentos: Array<{ id: string; nombre: string }>;
  empresas: Array<{ id: string; nombre: string }>;
  /** Planillas dispersables (APROBADA o PAGADA), para el archivo del banco. */
  planillas: Array<{ id: string; etiqueta: string }>;
}

/** Reportes que operan sobre UNA planilla concreta, no sobre un rango de fechas. */
const REQUIEREN_PLANILLA = new Set(["nomina-banco"]);

const reportes = [
  { id: "planilla-detallada", nombre: "Planilla detallada", descripcion: "Detalle completo de planilla con todas las deducciones por empleado", categoria: "Planillas" },
  { id: "resumen-planilla", nombre: "Resumen de planilla", descripcion: "Totales por departamento y sucursal", categoria: "Planillas" },
  { id: "nomina-banco", nombre: "Nómina para banco", descripcion: "Archivo con transferencias bancarias para pago de nómina", categoria: "Planillas" },
  { id: "ihss-planilla", nombre: "Planilla IHSS (proyectada)", descripcion: "Aportes IHSS EM/IVM estimados sobre el salario actual de los empleados activos", categoria: "Legal" },
  { id: "ihss-historico", nombre: "Planilla IHSS (histórica)", descripcion: "Aportes IHSS EM/IVM realmente registrados en las planillas del período (usa fechas)", categoria: "Legal" },
  { id: "rap-planilla", nombre: "Planilla RAP", descripcion: "Reporte de aportes al RAP", categoria: "Legal" },
  { id: "isr-anual", nombre: "Constancia anual de ISR", descripcion: "Constancia de retención de ISR por empleado para declaración anual", categoria: "Legal" },
  { id: "13vo-proyeccion", nombre: "Proyección del decimotercer mes", descripcion: "Acumulado de provisión de décimo tercer mes", categoria: "Provisiones" },
  { id: "14vo-proyeccion", nombre: "Proyección del decimocuarto mes", descripcion: "Acumulado de provisión de décimo cuarto mes", categoria: "Provisiones" },
  { id: "vacaciones-proyeccion", nombre: "Provisión de vacaciones", descripcion: "Saldo acumulado de vacaciones y provisión por empleado", categoria: "Provisiones" },
  { id: "empleados-activos", nombre: "Listado de empleados", descripcion: "Directorio completo de empleados con datos laborales", categoria: "RRHH" },
  { id: "historial-salarial", nombre: "Historial salarial", descripcion: "Cambios de salario por empleado o colectivo", categoria: "RRHH" },
  { id: "asistencia-mensual", nombre: "Asistencia mensual", descripcion: "Reporte de asistencia, ausencias y horas extra por mes", categoria: "Asistencia" },
  { id: "puntualidad", nombre: "Puntualidad", descripcion: "Llegadas tarde según el turno y días laborales sin marca (usa fechas)", categoria: "Asistencia" },
  { id: "evaluaciones-resumen", nombre: "Resumen de evaluaciones", descripcion: "Calificaciones de desempeño y competencias por período", categoria: "RRHH" },
];

const categorias = ["Todos", "Planillas", "Legal", "Provisiones", "RRHH", "Asistencia"];

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

export default function ReportesClient({ sucursales, departamentos, empresas, planillas }: Props) {
  const [categoria, setCategoria] = useState("Todos");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<Visor | null>(null);
  const [filtros, setFiltros] = useState({
    fechaDesde: "",
    fechaHasta: "",
    sucursalId: "",
    departamentoId: "",
    empresaId: empresas[0]?.id ?? "",
    planillaId: planillas[0]?.id ?? "",
  });

  const filtrados = categoria === "Todos" ? reportes : reportes.filter((r) => r.categoria === categoria);

  const campo = (k: keyof typeof filtros) => ({
    value: filtros[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFiltros((f) => ({ ...f, [k]: e.target.value })),
  });

  function validar(reporteId: string): boolean {
    if (REQUIEREN_PLANILLA.has(reporteId) && !filtros.planillaId) {
      setError("Seleccione la planilla a dispersar. Sólo aparecen las aprobadas o pagadas.");
      return false;
    }
    return true;
  }

  function url(reporteId: string, formato: Formato | "JSON"): string {
    const params = new URLSearchParams({ reporteId, ...filtros, formato });
    return `/api/reportes?${params.toString()}`;
  }

  async function ver(reporteId: string) {
    setError(null);
    if (!validar(reporteId)) return;
    setOcupado(`${reporteId}:ver`);
    try {
      const res = await fetch(url(reporteId, "JSON"));
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? "No se pudo generar el reporte.");
      setVisor(d as Visor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el reporte.");
    } finally {
      setOcupado(null);
    }
  }

  async function descargar(reporteId: string, formato: Formato) {
    setError(null);
    if (!validar(reporteId)) return;
    setOcupado(`${reporteId}:${formato}`);
    try {
      const res = await fetch(url(reporteId, formato));
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
      a.download = nombreDescarga(res, reporteId);
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

      {/* Filtros globales: se aplican a todos los reportes de abajo. */}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-gray-900">Filtros</h2>
        <p className="mt-0.5 text-xs text-gray-500">Se aplican a cualquier reporte que abra o descargue.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="rep-desde" className="mb-1 block text-xs font-medium text-gray-700">Desde</label>
            <input id="rep-desde" type="date" {...campo("fechaDesde")} className="input" />
          </div>
          <div>
            <label htmlFor="rep-hasta" className="mb-1 block text-xs font-medium text-gray-700">Hasta</label>
            <input id="rep-hasta" type="date" {...campo("fechaHasta")} className="input" />
          </div>
          <div>
            <label htmlFor="rep-sucursal" className="mb-1 block text-xs font-medium text-gray-700">Sucursal</label>
            <select id="rep-sucursal" {...campo("sucursalId")} className="input">
              <option value="">Todas</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rep-depto" className="mb-1 block text-xs font-medium text-gray-700">Departamento</label>
            <select id="rep-depto" {...campo("departamentoId")} className="input">
              <option value="">Todos</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label htmlFor="rep-planilla" className="mb-1 block text-xs font-medium text-gray-700">
              Planilla a dispersar <span className="font-normal text-gray-400">(archivo del banco)</span>
            </label>
            <select id="rep-planilla" {...campo("planillaId")} className="input">
              {planillas.length === 0 ? (
                <option value="">No hay planillas aprobadas</option>
              ) : (
                planillas.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)
              )}
            </select>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div role="tablist" aria-label="Categoría de reportes" className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {categorias.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={categoria === c}
            onClick={() => setCategoria(c)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
              categoria === c ? "border-blue-500 font-medium text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <ul className="panel divide-y divide-gray-100">
        {filtrados.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-sm font-medium text-gray-900">{r.nombre}</h3>
                {categoria === "Todos" && <span className="text-xs text-gray-400">{r.categoria}</span>}
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{r.descripcion}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => ver(r.id)} disabled={ocupado !== null} className="btn btn-primary btn-sm">
                {ocupado === `${r.id}:ver` ? "Generando" : "Ver"}
              </button>
              <button type="button" onClick={() => descargar(r.id, "XLSX")} disabled={ocupado !== null} className="btn btn-secondary btn-sm" title="Descargar en Excel">
                {ocupado === `${r.id}:XLSX` ? "Generando" : "Excel"}
              </button>
              <button type="button" onClick={() => descargar(r.id, "PDF")} disabled={ocupado !== null} className="btn btn-secondary btn-sm" title="Descargar en PDF">
                {ocupado === `${r.id}:PDF` ? "Generando" : "PDF"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {visor && (
        <VisorReporte
          visor={visor}
          ocupado={ocupado}
          onCerrar={() => setVisor(null)}
          onExportar={(formato) => descargar(visor.reporteId, formato)}
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
                  const total = esFilaTotal(fila);
                  return (
                    <tr key={f} className={cn(total && "bg-gray-50 font-semibold text-gray-900")}>
                      {visor.cabeceras.map((_, i) => (
                        <td key={i} className={cn("whitespace-nowrap px-3 py-2", numericas[i] && "text-right")}>{fila[i] ?? ""}</td>
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
