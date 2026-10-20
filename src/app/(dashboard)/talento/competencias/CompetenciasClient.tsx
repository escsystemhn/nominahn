"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PuestoComp {
  puestoId: string;
  nivelRequerido: string;
  peso: number;
  puesto: { id: string; nombre: string };
}

interface Competencia {
  id: string;
  nombre: string;
  descripcion?: string | null;
  categoria: string;
  activa: boolean;
  puestosCompetencia: PuestoComp[];
}

interface Props {
  competencias: Competencia[];
  puestos: { id: string; nombre: string }[];
}

const CATEGORIA_COLOR: Record<string, string> = {
  CORE: "bg-blue-100 text-blue-700",
  LIDERAZGO: "bg-purple-100 text-purple-700",
  TECNICA: "bg-orange-100 text-orange-700",
  COMPORTAMIENTO: "bg-teal-100 text-teal-700",
};

const NIVELES = ["INICIAL", "BASICO", "INTERMEDIO", "AVANZADO", "EXPERTO"];
const NIVEL_LABEL: Record<string, string> = {
  INICIAL: "1-Inicial", BASICO: "2-Básico", INTERMEDIO: "3-Intermedio",
  AVANZADO: "4-Avanzado", EXPERTO: "5-Experto",
};

// `competencias` se usa directo desde las props: tras crear una, el componente
// llama a router.refresh() y el server component vuelve a enviarlas. Copiarlas a
// useState las habría congelado en el primer render y el listado nunca se
// habría actualizado.
export default function CompetenciasClient({ competencias, puestos }: Props) {
  const router = useRouter();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState("CORE");
  const [guardando, setGuardando] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Estado para asignar puesto a competencia
  const [asignando, setAsignando] = useState<string | null>(null);
  const [puestoSel, setPuestoSel] = useState("");
  const [nivelSel, setNivelSel] = useState("INTERMEDIO");
  const [pesoSel, setPesoSel] = useState(1);

  async function crearCompetencia(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const res = await fetch("/api/competencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, descripcion, categoria }),
    });
    setGuardando(false);
    if (res.ok) {
      setNombre(""); setDescripcion(""); setCategoria("CORE");
      setMostrarForm(false);
      router.refresh();
    }
  }

  async function asignarPuesto(competenciaId: string) {
    if (!puestoSel) return;
    const res = await fetch(`/api/puestos/${puestoSel}/competencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competenciaId, nivelRequerido: nivelSel, peso: pesoSel }),
    });
    if (res.ok) {
      setAsignando(null); setPuestoSel(""); setNivelSel("INTERMEDIO"); setPesoSel(1);
      router.refresh();
    }
  }

  async function quitarPuesto(puestoId: string, competenciaId: string) {
    await fetch(`/api/puestos/${puestoId}/competencias?competenciaId=${competenciaId}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Competencias</h1>
          <p className="text-sm text-gray-500 mt-0.5">Catálogo y matriz de competencias por puesto</p>
        </div>
        <button
          onClick={() => setMostrarForm(!mostrarForm)}
          className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 transition-colors"
        >
          Nueva competencia
        </button>
      </div>

      {/* Formulario nueva competencia */}
      {mostrarForm && (
        <form onSubmit={crearCompetencia} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-800">Nueva competencia</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="CORE">Core</option>
                <option value="LIDERAZGO">Liderazgo</option>
                <option value="TECNICA">Técnica</option>
                <option value="COMPORTAMIENTO">Comportamiento</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMostrarForm(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:bg-blue-400">
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      )}

      {/* Lista de competencias */}
      <div className="space-y-3">
        {competencias.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No hay competencias definidas. Crea la primera.
          </div>
        )}

        {competencias.map((comp) => (
          <div key={comp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            {/* Header */}
            <button
              onClick={() => setExpanded(expanded === comp.id ? null : comp.id)}
              className="w-full flex items-center justify-between p-5 text-left"
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{comp.nombre}</p>
                  {comp.descripcion && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{comp.descripcion}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORIA_COLOR[comp.categoria] ?? "bg-gray-100 text-gray-600"}`}>
                  {comp.categoria}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{comp.puestosCompetencia.length} puestos</span>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expanded === comp.id ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Puestos asignados */}
            {expanded === comp.id && (
              <div className="border-t border-gray-100 px-5 pb-5">
                {comp.puestosCompetencia.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Puestos asignados</p>
                    {comp.puestosCompetencia.map((pc) => (
                      <div key={pc.puestoId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-800">{pc.puesto.nombre}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                            {NIVEL_LABEL[pc.nivelRequerido] ?? pc.nivelRequerido}
                          </span>
                          <span className="text-xs text-gray-400">peso: {pc.peso}</span>
                          <button
                            onClick={() => quitarPuesto(pc.puestoId, comp.id)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 mt-4">Sin puestos asignados.</p>
                )}

                {/* Asignar puesto */}
                {asignando === comp.id ? (
                  <div className="mt-4 bg-blue-50 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-blue-700">Asignar a puesto</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Puesto</label>
                        <select
                          value={puestoSel}
                          onChange={(e) => setPuestoSel(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <option value="">Seleccione...</option>
                          {puestos.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Nivel requerido</label>
                        <select
                          value={nivelSel}
                          onChange={(e) => setNivelSel(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          {NIVELES.map((n) => (
                            <option key={n} value={n}>{NIVEL_LABEL[n]}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">Peso (1–10)</label>
                        <input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.5}
                          value={pesoSel}
                          onChange={(e) => setPesoSel(Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setAsignando(null)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                        Cancelar
                      </button>
                      <button
                        onClick={() => asignarPuesto(comp.id)}
                        disabled={!puestoSel}
                        className="px-3 py-1.5 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:bg-blue-300"
                      >
                        Asignar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAsignando(comp.id); setPuestoSel(""); }}
                    className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Asignar a un puesto
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
