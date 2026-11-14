"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { PRODUCTO } from "@/lib/marca";
import { calificacionPonderada } from "@/lib/evaluaciones/calificacion";
import type { Aspecto } from "@/lib/evaluaciones/aspectos";

interface EvalData {
  participante: { id: string; rol: string; evaluador: { primerNombre: string; primerApellido: string } };
  evaluacion: {
    id: string;
    tipo: string;
    periodo: string;
    empleado: { primerNombre: string; primerApellido: string; puesto?: { nombre: string } };
    campana?: { nombre: string };
  };
  aspectos: Aspecto[];
}

/** Clave estable de un aspecto: su id de catálogo o, en la lista base, su nombre. */
const clave = (a: Aspecto) => a.competenciaId ?? a.nombre;

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
  const { avisar } = useAvisos();

  const [data, setData] = useState<EvalData | null>(null);
  const [error, setError] = useState("");
  const [completada, setCompletada] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);

  // Calificaciones por competencia
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [calGeneral, setCalGeneral] = useState(0);
  // Un aspecto sin tocar no está calificado (no es un 0).
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [comentGeneral, setComentGeneral] = useState("");

  useEffect(() => {
    fetch(`/api/evaluar/${token}`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (json.completada) setCompletada(true);
          else setError(json.error ?? "Error al cargar");
        } else {
          setData(json);
          const init: Record<string, number> = {};
          for (const a of json.aspectos as Aspecto[]) init[clave(a)] = 0;
          setScores(init);
        }
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;

    // Cada aspecto tiene que haberse calificado (un 0 puesto a propósito vale).
    for (const a of data.aspectos) {
      if (!tocados.has(clave(a))) {
        avisar.error(`Falta calificar: ${a.nombre}`);
        return;
      }
    }

    setEnviando(true);
    const criteriosPayload = data.aspectos.map((a) => ({
      criterio: a.nombre,
      competenciaId: a.competenciaId,
      calificacion: scores[clave(a)] ?? 0,
      peso: a.peso,
      comentario: comentarios[clave(a)],
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
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Error al enviar");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 animate-pulse">Cargando evaluación…</div>
      </div>
    );
  }

  if (completada) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <svg className="w-8 h-8 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Enlace no disponible</h1>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { participante, evaluacion, aspectos } = data;
  // Con aspectos, la nota es su promedio ponderado; la general sólo cuenta si no hay aspectos.
  const notaAspectos = calificacionPonderada(aspectos.map((a) => ({ calificacion: tocados.has(clave(a)) ? scores[clave(a)] : null, peso: a.peso })));

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
              <p className="text-xs text-blue-600 font-semibold">Evaluaciones de {PRODUCTO}</p>
              <h1 className="text-lg font-bold text-gray-900">{ROL_LABEL[participante.rol] ?? participante.rol}</h1>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
            <p>
              <span className="text-gray-500">Evaluado:</span>{" "}
              <span className="font-medium">{evaluacion.empleado.primerNombre} {evaluacion.empleado.primerApellido}</span>
              {evaluacion.empleado.puesto && (
                <span className="text-gray-500 ml-1">— {evaluacion.empleado.puesto.nombre}</span>
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
          {aspectos.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-800 mb-4">Aspectos a evaluar</h2>
              <div className="space-y-6">
                {aspectos.map((comp) => (
                  <div key={clave(comp)} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{comp.nombre}</p>
                        {comp.descripcion && (
                          <p className="text-xs text-gray-500 mt-0.5">{comp.descripcion}</p>
                        )}
                        {comp.nivelRequerido && (
                          <p className="text-xs text-blue-600 mt-1">
                            Nivel requerido: {NIVEL_LABEL[comp.nivelRequerido] ?? comp.nivelRequerido}
                          </p>
                        )}
                        {aspectos.some((a) => a.peso !== comp.peso) && (
                          <p className="text-xs text-gray-500 mt-0.5">Peso {comp.peso}</p>
                        )}
                      </div>
                      <div className="text-right min-w-[48px]">
                        <span className="text-2xl font-bold text-blue-700">{tocados.has(clave(comp)) ? scores[clave(comp)] : "—"}</span>
                        <p className="text-xs text-gray-500">/ 100</p>
                      </div>
                    </div>

                    {/* Slider de calificación */}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={scores[clave(comp)] ?? 0}
                      aria-label={`Calificación de ${comp.nombre}`}
                      onChange={(e) => {
                        const k = clave(comp);
                        setScores((prev) => ({ ...prev, [k]: Number(e.target.value) }));
                        setTocados((prev) => new Set(prev).add(k));
                      }}
                      className="w-full accent-blue-600 mb-2"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mb-3">
                      <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
                    </div>

                    <textarea
                      placeholder="Comentario sobre esta competencia (opcional)"
                      value={comentarios[clave(comp)] ?? ""}
                      onChange={(e) => setComentarios((prev) => ({ ...prev, [clave(comp)]: e.target.value }))}
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
              <span className="text-3xl font-bold text-blue-700">{aspectos.length > 0 ? (notaAspectos ?? "—") : calGeneral}</span>
              <span className="text-gray-500">/ 100</span>
            </div>
            {aspectos.length > 0 ? (
              <p className="mb-4 text-xs text-gray-500">Es el promedio de los aspectos, cada uno con su peso.</p>
            ) : (
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={calGeneral}
                onChange={(e) => setCalGeneral(Number(e.target.value))}
                className="w-full accent-blue-600 mb-4"
                aria-label="Calificación general"
                required
              />
            )}

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
            disabled={enviando || (aspectos.length > 0 ? tocados.size < aspectos.length : calGeneral === 0)}
            className="w-full py-3 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-semibold rounded-xl transition-colors text-sm"
          >
            {enviando ? "Enviando..." : "Enviar evaluación"}
          </button>
        </form>
      </div>
    </div>
  );
}
