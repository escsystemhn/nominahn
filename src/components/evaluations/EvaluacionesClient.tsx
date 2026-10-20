"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { nombreCompleto } from "@/lib/utils";

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
  "Puntualidad y Asistencia",
  "Calidad del Trabajo",
  "Productividad",
  "Trabajo en Equipo",
  "Actitud y Compromiso",
];

const criteriosCompetencia = [
  "Conocimiento Técnico",
  "Liderazgo",
  "Comunicación",
  "Resolución de Problemas",
  "Orientación al Cliente",
  "Innovación",
];

export default function EvaluacionesClient({ evaluaciones, empleados }: Props) {
  const router = useRouter();
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
      alert("No se pudo guardar la evaluación. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  const listaCriterios = form.tipo === "DESEMPENO_MENSUAL" ? criteriosDesempeno : criteriosCompetencia;

  function colorCalif(n: number) {
    if (n >= 80) return "text-green-600";
    if (n >= 60) return "text-amber-600";
    return "text-red-600";
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Evaluaciones</h1>
          <p className="text-sm text-gray-500">Desempeño mensual y competencias trimestrales</p>
        </div>
        <button onClick={() => setModal(true)} className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800">
          Nueva evaluación
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {["TODOS", "DESEMPENO_MENSUAL", "COMPETENCIA_TRIMESTRAL"].map((t) => (
          <button
            key={t}
            onClick={() => setTipoFiltro(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tipoFiltro === t ? "bg-blue-700 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t === "TODOS" ? "Todas" : t === "DESEMPENO_MENSUAL" ? "Desempeño Mensual" : "Competencias Trimestrales"}
          </button>
        ))}
      </div>

      {/* Grid de evaluaciones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activos.length === 0 ? (
          <p className="text-gray-400 text-sm col-span-2 py-6 text-center">No hay evaluaciones registradas</p>
        ) : activos.map((ev) => (
          <div key={ev.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-gray-900">{ev.empleado.primerNombre} {ev.empleado.primerApellido}</p>
                <p className="text-xs text-gray-400 mt-0.5">{ev.empleado.sucursal.nombre} · {ev.empleado.departamento.nombre}</p>
                <div className="flex gap-2 mt-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    ev.tipo === "DESEMPENO_MENSUAL" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                  }`}>
                    {ev.tipo === "DESEMPENO_MENSUAL" ? "Desempeño" : "Competencia"}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{ev.periodo}</span>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-3xl font-black ${colorCalif(Number(ev.calificacion))}`}>
                  {Number(ev.calificacion).toFixed(1)}
                </p>
                <p className="text-xs text-gray-400">/100</p>
              </div>
            </div>
            {ev.comentarios && (
              <p className="mt-3 text-sm text-gray-600 line-clamp-2">{ev.comentarios}</p>
            )}
            {ev.fortalezas && (
              <div className="mt-2">
                <p className="text-xs font-medium text-green-700">Fortalezas:</p>
                <p className="text-xs text-gray-500">{ev.fortalezas}</p>
              </div>
            )}
            {ev.mejoras && (
              <div className="mt-1">
                <p className="text-xs font-medium text-amber-700">Áreas de mejora:</p>
                <p className="text-xs text-gray-500">{ev.mejoras}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-gray-900 text-lg">Nueva evaluación</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Empleado</label>
                <select value={form.empleadoId} onChange={(e) => setForm((f) => ({ ...f, empleadoId: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Seleccione...</option>
                  {empleados.map((emp) => (
                    <option key={emp.id} value={emp.id}>{nombreCompleto(emp)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                <select value={form.tipo} onChange={(e) => { setForm((f) => ({ ...f, tipo: e.target.value })); setCriterios({}); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="DESEMPENO_MENSUAL">Desempeño Mensual</option>
                  <option value="COMPETENCIA_TRIMESTRAL">Competencia Trimestral</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Período</label>
                <input value={form.periodo} onChange={(e) => setForm((f) => ({ ...f, periodo: e.target.value }))} placeholder="Ej: 2024-01 ó 2024-T1" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">Criterios de Evaluación (0-100)</p>
              <div className="space-y-2">
                {listaCriterios.map((c) => (
                  <div key={c} className="flex items-center gap-3">
                    <label className="text-sm text-gray-600 flex-1">{c}</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={criterios[c] ?? ""}
                      onChange={(e) => setCriterio(c, parseInt(e.target.value) || 0)}
                      className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right"
                    />
                  </div>
                ))}
                {Object.keys(criterios).length > 0 && (
                  <div className="flex justify-between items-center pt-1 border-t font-medium text-sm">
                    <span>Promedio Calculado</span>
                    <span className={colorCalif(parseFloat(calcPromedioLocal()) || 0)}>{calcPromedioLocal()}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Comentarios Generales</label>
              <textarea value={form.comentarios} onChange={(e) => setForm((f) => ({ ...f, comentarios: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fortalezas</label>
                <textarea value={form.fortalezas} onChange={(e) => setForm((f) => ({ ...f, fortalezas: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Áreas de Mejora</label>
                <textarea value={form.mejoras} onChange={(e) => setForm((f) => ({ ...f, mejoras: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={guardarEvaluacion} disabled={loading || !form.empleadoId || !form.periodo} className="flex-1 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 disabled:bg-blue-400">
                {loading ? "Guardando..." : "Guardar Evaluación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
