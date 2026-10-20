"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";

interface Competencia {
  id: string;
  nombre: string;
  descripcion?: string;
  nivelRequerido: string;
  peso: number;
}

interface EvalData {
  participante: { id: string; rol: string; evaluador: { primerNombre: string; primerApellido: string } };
  evaluacion: {
    id: string;
    tipo: string;
    periodo: string;
    empleado: { primerNombre: string; primerApellido: string; puesto?: { nombre: string } };
    campana?: { nombre: string };
  };
  competenciasRequeridas: Competencia[];
}

const ROL_LABEL: Record<string, string> = {
  AUTOEVALUACION: "Autoevaluación",
  JEFE_DIRECTO: "Evaluación del Jefe Directo",
  PAR: "Evaluación de Par",
  SUBORDINADO: "Evaluación de Subordinado",
  RRHH: "Evaluación RRHH",
};

const NIVEL_LABEL: Record<string, string> = {
  INICIAL: "1 – Inicial",
  BASICO: "2 – Básico",
  INTERMEDIO: "3 – Intermedio",
  AVANZADO: "4 – Avanzado",
  EXPERTO: "5 – Experto",
};

export default function EvaluarPage() {
  const { token } = useParams<{ token: string }>();

  const [data, setData] = useState<EvalData | null>(null);
  const [error, setError] = useState("");
  const [completada, setCompletada] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);

  // Calificaciones por competencia
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [calGeneral, setCalGeneral] = useState(0);
  const [comentGeneral, setComentGeneral] = useState("");

  useEffect(() => {
    fetch(`/api/evaluar/${token}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) {
          if (json.completada) setCompletada(true);
          else setError(json.error ?? "Error al cargar");
        } else {
          setData(json);
          // Inicializar scores
          const init: Record<string, number> = {};
          for (const c of json.competenciasRequeridas) init[c.id] = 0;
          setScores(init);
        }
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;

    // Validar que todas las competencias tienen calificación
    for (const c of data.competenciasRequeridas) {
      if (!scores[c.id] || scores[c.id] === 0) {
        alert(`Por favor califica la competencia: ${c.nombre}`);
        return;
      }
    }

    setEnviando(true);
    const criteriosPayload = data.competenciasRequeridas.map((c) => ({
      criterio: c.nombre,
      competenciaId: c.id,
      calificacion: scores[c.id] ?? 0,
      peso: c.peso,
      comentario: comentarios[c.id],
    }));

    const res = await fetch(`/api/evaluar/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calificacion: calGeneral,
        comentarios: comentGeneral,
        criterios: criteriosPayload,
      }),
    });

    setEnviando(false);
    if (res.ok) {
      setCompletada(true);
    } else {
      const json = await res.json();
      setError(json.error ?? "Error al enviar");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 animate-pulse">Cargando evaluación...</div>
      </div>
    );
  }

  if (completada) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Evaluación enviada</h1>
          <p className="text-gray-500 text-sm">Tu evaluación fue registrada exitosamente. Gracias por tu participación.</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Enlace no disponible</h1>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { participante, evaluacion, competenciasRequeridas } = data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            {/* La abre gente de fuera de la empresa, así que la marca importa. */}
            <Image
              src="/logo-escsystem-icono.png"
              alt=""
              width={40}
              height={40}
              className="w-10 h-10 rounded-lg shrink-0"
            />
            <div>
              <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">NominaHN · Evaluaciones</p>
              <h1 className="text-lg font-bold text-gray-900">{ROL_LABEL[participante.rol] ?? participante.rol}</h1>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
            <p>
              <span className="text-gray-500">Evaluado:</span>{" "}
              <span className="font-medium">{evaluacion.empleado.primerNombre} {evaluacion.empleado.primerApellido}</span>
              {evaluacion.empleado.puesto && (
                <span className="text-gray-400 ml-1">— {evaluacion.empleado.puesto.nombre}</span>
              )}
            </p>
            <p>
              <span className="text-gray-500">Evaluador:</span>{" "}
              <span className="font-medium">{participante.evaluador.primerNombre} {participante.evaluador.primerApellido}</span>
            </p>
            <p>
              <span className="text-gray-500">Período:</span>{" "}
              <span className="font-medium">{evaluacion.periodo}</span>
            </p>
            {evaluacion.campana && (
              <p>
                <span className="text-gray-500">Campaña:</span>{" "}
                <span className="font-medium">{evaluacion.campana.nombre}</span>
              </p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Competencias */}
          {competenciasRequeridas.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-800 mb-4">Competencias requeridas</h2>
              <div className="space-y-6">
                {competenciasRequeridas.map((comp) => (
                  <div key={comp.id} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{comp.nombre}</p>
                        {comp.descripcion && (
                          <p className="text-xs text-gray-500 mt-0.5">{comp.descripcion}</p>
                        )}
                        <p className="text-xs text-blue-600 mt-1">
                          Nivel requerido: {NIVEL_LABEL[comp.nivelRequerido] ?? comp.nivelRequerido}
                        </p>
                      </div>
                      <div className="text-right min-w-[48px]">
                        <span className="text-2xl font-bold text-blue-700">{scores[comp.id] ?? 0}</span>
                        <p className="text-xs text-gray-400">/ 100</p>
                      </div>
                    </div>

                    {/* Slider de calificación */}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={scores[comp.id] ?? 0}
                      onChange={(e) => setScores((prev) => ({ ...prev, [comp.id]: Number(e.target.value) }))}
                      className="w-full accent-blue-600 mb-2"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mb-3">
                      <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
                    </div>

                    <textarea
                      placeholder="Comentario sobre esta competencia (opcional)"
                      value={comentarios[comp.id] ?? ""}
                      onChange={(e) => setComentarios((prev) => ({ ...prev, [comp.id]: e.target.value }))}
                      rows={2}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Calificación general */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-800 mb-4">Calificación general</h2>

            <div className="flex items-center gap-4 mb-3">
              <span className="text-3xl font-bold text-blue-700">{calGeneral}</span>
              <span className="text-gray-400">/ 100</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={calGeneral}
              onChange={(e) => setCalGeneral(Number(e.target.value))}
              className="w-full accent-blue-600 mb-4"
              required
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Comentarios generales</label>
            <textarea
              placeholder="Observaciones, fortalezas o áreas de mejora..."
              value={comentGeneral}
              onChange={(e) => setComentGeneral(e.target.value)}
              rows={4}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={enviando || calGeneral === 0}
            className="w-full py-3 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            {enviando ? "Enviando..." : "Enviar evaluación"}
          </button>
        </form>
      </div>
    </div>
  );
}
