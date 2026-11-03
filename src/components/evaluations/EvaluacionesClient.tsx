"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { nombreCompleto } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";

// Date cuando lo pasa el server component; string ISO cuando viene del JSON de
// /api/evaluaciones. Ambas fuentes son reales, así que el tipo las admite.
type FechaSerializable = Date | string;

interface Evaluacion {
  id: string;
  tipo: string;
  periodo: string;
  calificacion: number;
  estado: string;
  comentarios: string | null;
  fortalezas: string | null;
  mejoras: string | null;
  createdAt: FechaSerializable;
  empleado: {
    id: string;
    codigo: string;
    primerNombre: string;
    primerApellido: string;
    sucursal: { nombre: string };
    departamento: { nombre: string };
  };
}

interface Props {
  evaluaciones: Evaluacion[];
  empleados: Array<{ id: string; codigo: string; primerNombre: string; segundoNombre?: string | null; primerApellido: string; segundoApellido?: string | null }>;
}

const criteriosDesempeno = [
  "Puntualidad y asistencia",
  "Calidad del trabajo",
  "Productividad",
  "Trabajo en equipo",
  "Actitud y compromiso",
];

const criteriosCompetencia = [
  "Conocimiento técnico",
  "Liderazgo",
  "Comunicación",
  "Resolución de problemas",
  "Orientación al cliente",
  "Innovación",
];

export default function EvaluacionesClient({ evaluaciones, empleados }: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState("TODOS");

  const [form, setForm] = useState({
    empleadoId: "",
    tipo: "DESEMPENO_MENSUAL",
    periodo: "",
    calificacion: "",
    comentarios: "",
    fortalezas: "",
    mejoras: "",
    objetivos: "",
  });
  const [criterios, setCriterios] = useState<Record<string, number>>({});

  const activos = tipoFiltro === "TODOS" ? evaluaciones : evaluaciones.filter((e) => e.tipo === tipoFiltro);

  function setCriterio(c: string, val: number) {
    setCriterios((prev) => ({ ...prev, [c]: val }));
  }

  function calcPromedioLocal() {
    const vals = Object.values(criterios);
    if (vals.length === 0) return "";
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  }

  async function guardarEvaluacion() {
    setLoading(true);
    try {
      const promedio = calcPromedioLocal() || form.calificacion;
      const res = await fetch("/api/evaluaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, calificacion: parseFloat(promedio) || 0, criterios }),
      });
      if (!res.ok) throw new Error();
      setModal(false);
      router.refresh();
    } catch {
      avisar.error("No se pudo guardar la evaluación. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  const listaCriterios = form.tipo === "DESEMPENO_MENSUAL" ? criteriosDesempeno : criteriosCompetencia;

  function colorCalif(n: number) {
    if (n >= 80) return "text-green-700";
    if (n >= 60) return "text-amber-700";
    return "text-red-600";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evaluaciones"
        description="Desempeño mensual y competencias trimestrales."
        actions={
          <button onClick={() => setModal(true)} className="btn btn-primary">
            Nueva evaluación
          </button>
        }
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de evaluación">
        {["TODOS", "DESEMPENO_MENSUAL", "COMPETENCIA_TRIMESTRAL"].map((t) => (
          <button
            key={t}
            onClick={() => setTipoFiltro(t)}
            aria-pressed={tipoFiltro === t}
            className={`btn btn-sm btn-secondary ${tipoFiltro === t ? "border-blue-500 bg-blue-50 text-blue-800" : ""}`}
          >
            {t === "TODOS" ? "Todas" : t === "DESEMPENO_MENSUAL" ? "Desempeño mensual" : "Competencias trimestrales"}
          </button>
        ))}
      </div>

      {/* Grid de evaluaciones */}
      {activos.length === 0 ? (
        <div className="panel">
          <EstadoVacio
            titulo="Todavía no hay evaluaciones."
            detalle="Registre la primera con el botón «Nueva evaluación», o cambie el filtro para ver las de otro tipo."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {activos.map((ev) => (
            <div key={ev.id} className="panel p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900">{ev.empleado.primerNombre} {ev.empleado.primerApellido}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{ev.empleado.sucursal.nombre}, {ev.empleado.departamento.nombre}</p>
                  <p className="mt-2 text-xs text-gray-600">
                    {ev.tipo === "DESEMPENO_MENSUAL" ? "Desempeño" : "Competencia"}, {ev.periodo}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`tnum text-3xl font-semibold ${colorCalif(Number(ev.calificacion))}`}>
                    {Number(ev.calificacion).toFixed(1)}
                  </p>
                  <p className="text-xs text-gray-500">de 100</p>
                </div>
              </div>
              {ev.comentarios && (
                <p className="mt-3 line-clamp-2 text-sm text-gray-600">{ev.comentarios}</p>
              )}
              {ev.fortalezas && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-700">Fortalezas:</p>
                  <p className="text-xs text-gray-500">{ev.fortalezas}</p>
                </div>
              )}
              {ev.mejoras && (
                <div className="mt-1">
                  <p className="text-xs font-medium text-gray-700">Áreas de mejora:</p>
                  <p className="text-xs text-gray-500">{ev.mejoras}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="panel max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Nueva evaluación</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Campo etiqueta="Empleado">
                  <select value={form.empleadoId} onChange={(e) => setForm((f) => ({ ...f, empleadoId: e.target.value }))} className="input">
                    <option value="">Seleccione…</option>
                    {empleados.map((emp) => (
                      <option key={emp.id} value={emp.id}>{nombreCompleto(emp)}</option>
                    ))}
                  </select>
                </Campo>
              </div>
              <Campo etiqueta="Tipo">
                <select value={form.tipo} onChange={(e) => { setForm((f) => ({ ...f, tipo: e.target.value })); setCriterios({}); }} className="input">
                  <option value="DESEMPENO_MENSUAL">Desempeño mensual</option>
                  <option value="COMPETENCIA_TRIMESTRAL">Competencia trimestral</option>
                </select>
              </Campo>
              <Campo etiqueta="Período">
                <input value={form.periodo} onChange={(e) => setForm((f) => ({ ...f, periodo: e.target.value }))} placeholder="Ej: 2024-01 o 2024-T1" className="input" />
              </Campo>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-800">Criterios de evaluación (0 a 100)</p>
              <div className="space-y-2">
                {listaCriterios.map((c) => (
                  <label key={c} className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-600">{c}</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={criterios[c] ?? ""}
                      onChange={(e) => setCriterio(c, parseInt(e.target.value) || 0)}
                      className="input w-20! text-right"
                    />
                  </label>
                ))}
                {Object.keys(criterios).length > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm font-medium">
                    <span>Promedio calculado</span>
                    <span className={colorCalif(parseFloat(calcPromedioLocal()) || 0)}>{calcPromedioLocal()}</span>
                  </div>
                )}
              </div>
            </div>

            <Campo etiqueta="Comentarios generales">
              <textarea value={form.comentarios} onChange={(e) => setForm((f) => ({ ...f, comentarios: e.target.value }))} rows={2} className="input" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Fortalezas">
                <textarea value={form.fortalezas} onChange={(e) => setForm((f) => ({ ...f, fortalezas: e.target.value }))} rows={2} className="input" />
              </Campo>
              <Campo etiqueta="Áreas de mejora">
                <textarea value={form.mejoras} onChange={(e) => setForm((f) => ({ ...f, mejoras: e.target.value }))} rows={2} className="input" />
              </Campo>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModal(false)} className="btn btn-ghost">Cancelar</button>
              <button onClick={guardarEvaluacion} disabled={loading || !form.empleadoId || !form.periodo} className="btn btn-primary">
                {loading ? "Guardando…" : "Guardar evaluación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
