"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";

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

const CATEGORIA_LABEL: Record<string, string> = {
  CORE: "Core",
  LIDERAZGO: "Liderazgo",
  TECNICA: "Técnica",
  COMPORTAMIENTO: "Comportamiento",
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
    <div className="space-y-6">
      <PageHeader
        title="Competencias"
        description="Catálogo y matriz de competencias por puesto."
        actions={
          <button onClick={() => setMostrarForm(!mostrarForm)} className="btn btn-primary">
            Nueva competencia
          </button>
        }
      />

      {/* Formulario nueva competencia */}
      {mostrarForm && (
        <form onSubmit={crearCompetencia} className="panel space-y-4 p-5">
          <h3 className="font-semibold text-gray-800">Nueva competencia</h3>
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Nombre *">
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                className="input"
              />
            </Campo>
            <Campo etiqueta="Categoría">
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="input"
              >
                <option value="CORE">Core</option>
                <option value="LIDERAZGO">Liderazgo</option>
                <option value="TECNICA">Técnica</option>
                <option value="COMPORTAMIENTO">Comportamiento</option>
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Descripción">
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              className="input resize-none"
            />
          </Campo>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMostrarForm(false)} className="btn btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="btn btn-primary">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}

      {/* Lista de competencias */}
      <div className="space-y-3">
        {competencias.length === 0 && (
          <div className="panel">
            <EstadoVacio
              titulo="Todavía no hay competencias definidas."
              detalle="Cree la primera con el botón «Nueva competencia» y luego asígnela a los puestos que la requieren."
            />
          </div>
        )}

        {competencias.map((comp) => (
          <div key={comp.id} className="panel">
            {/* Header */}
            <button
              onClick={() => setExpanded(expanded === comp.id ? null : comp.id)}
              className="flex w-full items-center justify-between p-5 text-left"
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{comp.nombre}</p>
                  {comp.descripcion && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{comp.descripcion}</p>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {CATEGORIA_LABEL[comp.categoria] ?? comp.categoria}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{comp.puestosCompetencia.length} puestos</span>
                <svg
                  className={`h-4 w-4 text-gray-500 transition-transform ${expanded === comp.id ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Puestos asignados */}
            {expanded === comp.id && (
              <div className="border-t border-gray-200 px-5 pb-5">
                {comp.puestosCompetencia.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-gray-500">Puestos asignados</p>
                    {comp.puestosCompetencia.map((pc) => (
                      <div key={pc.puestoId} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                        <span className="text-sm text-gray-800">{pc.puesto.nombre}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-600">
                            {NIVEL_LABEL[pc.nivelRequerido] ?? pc.nivelRequerido}
                          </span>
                          <span className="text-xs text-gray-500">peso: {pc.peso}</span>
                          <button
                            onClick={() => quitarPuesto(pc.puestoId, comp.id)}
                            className="btn btn-sm border border-red-300 bg-white text-red-700 hover:bg-red-50"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-gray-500">Esta competencia todavía no está asignada a ningún puesto.</p>
                )}

                {/* Asignar puesto */}
                {asignando === comp.id ? (
                  <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-800">Asignar a puesto</p>
                    <div className="grid grid-cols-3 gap-3">
                      <Campo etiqueta="Puesto">
                        <select
                          value={puestoSel}
                          onChange={(e) => setPuestoSel(e.target.value)}
                          className="input"
                        >
                          <option value="">Seleccione…</option>
                          {puestos.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </select>
                      </Campo>
                      <Campo etiqueta="Nivel requerido">
                        <select
                          value={nivelSel}
                          onChange={(e) => setNivelSel(e.target.value)}
                          className="input"
                        >
                          {NIVELES.map((n) => (
                            <option key={n} value={n}>{NIVEL_LABEL[n]}</option>
                          ))}
                        </select>
                      </Campo>
                      <Campo etiqueta="Peso (1 a 10)">
                        <input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.5}
                          value={pesoSel}
                          onChange={(e) => setPesoSel(Number(e.target.value))}
                          className="input"
                        />
                      </Campo>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setAsignando(null)} className="btn btn-ghost">
                        Cancelar
                      </button>
                      <button
                        onClick={() => asignarPuesto(comp.id)}
                        disabled={!puestoSel}
                        className="btn btn-primary"
                      >
                        Asignar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAsignando(comp.id); setPuestoSel(""); }}
                    className="btn btn-secondary btn-sm mt-3"
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
