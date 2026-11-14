"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";
import { useAvisos } from "@/components/ui/Avisos";

interface PuestoComp {
  puestoId: string;
  nivelRequerido: string;
  peso: number;
  puesto: { id: string; nombre: string };
}

type TipoEval = "DESEMPENO_MENSUAL" | "COMPETENCIA_TRIMESTRAL";

interface Competencia {
  id: string;
  nombre: string;
  descripcion?: string | null;
  categoria: string;
  activa: boolean;
  general: boolean;
  tipoEvaluacion: TipoEval | null;
  peso: number;
  puestosCompetencia: PuestoComp[];
}

interface Props {
  competencias: Competencia[];
  /** nombreCorto = el nombre del puesto sin sucursal ni departamento. */
  puestos: { id: string; nombre: string; nombreCorto: string }[];
}

const CATEGORIA_LABEL: Record<string, string> = {
  CORE: "Core",
  LIDERAZGO: "Liderazgo",
  TECNICA: "Técnica",
  COMPORTAMIENTO: "Comportamiento",
};
const TIPO_LABEL: Record<string, string> = {
  AMBAS: "Las dos evaluaciones",
  DESEMPENO_MENSUAL: "Sólo desempeño mensual",
  COMPETENCIA_TRIMESTRAL: "Sólo competencias trimestrales",
};

const NIVELES = ["INICIAL", "BASICO", "INTERMEDIO", "AVANZADO", "EXPERTO"];
const NIVEL_LABEL: Record<string, string> = {
  INICIAL: "1-Inicial", BASICO: "2-Básico", INTERMEDIO: "3-Intermedio",
  AVANZADO: "4-Avanzado", EXPERTO: "5-Experto",
};

interface Datos {
  nombre: string;
  descripcion: string;
  categoria: string;
  tipo: string; // "AMBAS" | TipoEval
  general: boolean;
  peso: number;
}
const VACIO: Datos = { nombre: "", descripcion: "", categoria: "CORE", tipo: "AMBAS", general: false, peso: 1 };

const cuerpo = (d: Datos) => ({
  nombre: d.nombre,
  descripcion: d.descripcion || null,
  categoria: d.categoria,
  tipoEvaluacion: d.tipo === "AMBAS" ? null : d.tipo,
  general: d.general,
  peso: d.peso,
});

/** Los campos de un aspecto, iguales al crear y al editar. */
function CamposAspecto({ d, set }: { d: Datos; set: (d: Datos) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Nombre *">
          <input value={d.nombre} onChange={(e) => set({ ...d, nombre: e.target.value })} required className="input" />
        </Campo>
        <Campo etiqueta="Categoría">
          <select value={d.categoria} onChange={(e) => set({ ...d, categoria: e.target.value })} className="input">
            {Object.entries(CATEGORIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
      </div>
      <Campo etiqueta="Descripción (la ve quien evalúa)">
        <textarea value={d.descripcion} onChange={(e) => set({ ...d, descripcion: e.target.value })} rows={2} className="input resize-none" />
      </Campo>
      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Se usa en">
          <select value={d.tipo} onChange={(e) => set({ ...d, tipo: e.target.value })} className="input">
            {Object.entries(TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Peso como aspecto general (0.1 a 10)">
          <input type="number" min={0.1} max={10} step={0.5} value={d.peso} onChange={(e) => set({ ...d, peso: Number(e.target.value) })} className="input" disabled={!d.general} />
        </Campo>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={d.general} onChange={(e) => set({ ...d, general: e.target.checked })} />
        <span>
          <b>Aspecto general.</b> Se evalúa a todo el que no tenga aspectos asignados en su puesto (por ejemplo, puntualidad y asistencia).
        </span>
      </label>
    </>
  );
}

// `competencias` se usa directo desde las props: tras crear una, el componente
// llama a router.refresh() y el server component vuelve a enviarlas. Copiarlas a
// useState las habría congelado en el primer render y el listado nunca se
// habría actualizado.
export default function CompetenciasClient({ competencias, puestos }: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nueva, setNueva] = useState<Datos>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; d: Datos } | null>(null);
  const [verInactivas, setVerInactivas] = useState(false);

  // Estado para asignar puesto a competencia
  const [asignando, setAsignando] = useState<string | null>(null);
  const [puestoSel, setPuestoSel] = useState("");
  const [nivelSel, setNivelSel] = useState("INTERMEDIO");
  const [pesoSel, setPesoSel] = useState(1);
  const [mismoNombre, setMismoNombre] = useState(true);

  const lista = competencias.filter((c) => verInactivas || c.activa);
  const generales = competencias.filter((c) => c.activa && c.general);

  async function enviar(url: string, method: string, body: unknown, ok: string): Promise<boolean> {
    setGuardando(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        avisar.error(typeof d.error === "string" ? d.error : "No se pudo guardar. Revise los datos.");
        return false;
      }
      avisar.exito(ok);
      router.refresh();
      return true;
    } finally {
      setGuardando(false);
    }
  }

  async function crearCompetencia(e: React.FormEvent) {
    e.preventDefault();
    if (await enviar("/api/competencias", "POST", cuerpo(nueva), "Aspecto creado.")) {
      setNueva(VACIO);
      setMostrarForm(false);
    }
  }

  async function guardarEdicion() {
    if (!editando) return;
    if (await enviar(`/api/competencias/${editando.id}`, "PATCH", cuerpo(editando.d), "Aspecto actualizado.")) setEditando(null);
  }

  async function asignarPuesto(competenciaId: string) {
    if (!puestoSel) return;
    const res = await fetch(`/api/puestos/${puestoSel}/competencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competenciaId, nivelRequerido: nivelSel, peso: pesoSel, mismoNombre }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      avisar.exito(d.puestos > 1 ? `Asignado a ${d.puestos} puestos con ese nombre.` : "Asignado al puesto.");
      setAsignando(null); setPuestoSel(""); setNivelSel("INTERMEDIO"); setPesoSel(1);
      router.refresh();
    } else {
      avisar.error("No se pudo asignar.");
    }
  }

  async function quitarPuesto(puestoId: string, competenciaId: string) {
    await fetch(`/api/puestos/${puestoId}/competencias?competenciaId=${competenciaId}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  const puestoElegido = puestos.find((p) => p.id === puestoSel);
  const homonimos = puestoElegido ? puestos.filter((p) => p.nombreCorto.toLowerCase() === puestoElegido.nombreCorto.toLowerCase()).length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aspectos a evaluar"
        description="Catálogo de competencias y aspectos (puntualidad, asistencia, calidad…) y cuáles se evalúan en cada puesto, con su peso."
        actions={
          <button onClick={() => setMostrarForm(!mostrarForm)} className="btn btn-primary">
            Nuevo aspecto
          </button>
        }
      />

      <div className="panel p-4 text-sm text-gray-700">
        <p>
          <b>Cómo se elige qué evaluar:</b> a cada empleado se le evalúan los aspectos asignados a su <b>puesto</b>, con el peso de cada uno.
          Si su puesto no tiene, los <b>aspectos generales</b>
          {generales.length > 0 ? ` (${generales.map((g) => g.nombre).join(", ")})` : " (todavía no hay: se usa la lista base de siempre)"}.
          La calificación es el promedio de los aspectos, cada uno con su peso.
        </p>
      </div>

      {mostrarForm && (
        <form onSubmit={crearCompetencia} className="panel space-y-4 p-5">
          <h3 className="font-semibold text-gray-800">Nuevo aspecto</h3>
          <CamposAspecto d={nueva} set={setNueva} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMostrarForm(false)} className="btn btn-ghost">
              Cancelar
            </button>
            <button type="submit" disabled={guardando || !nueva.nombre.trim()} className="btn btn-primary">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} />
        Mostrar también los desactivados
      </label>

      <div className="space-y-3">
        {lista.length === 0 && (
          <div className="panel">
            <EstadoVacio
              titulo="Todavía no hay aspectos definidos."
              detalle="Cree el primero con el botón «Nuevo aspecto» y luego asígnelo a los puestos que lo requieren, o márquelo como general."
            />
          </div>
        )}

        {lista.map((comp) => (
          <div key={comp.id} className={`panel ${comp.activa ? "" : "opacity-70"}`} data-aspecto={comp.nombre}>
            <button
              onClick={() => setExpanded(expanded === comp.id ? null : comp.id)}
              className="flex w-full items-center justify-between p-5 text-left"
              aria-expanded={expanded === comp.id}
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
                  {comp.tipoEvaluacion ? ` · ${comp.tipoEvaluacion === "DESEMPENO_MENSUAL" ? "desempeño" : "competencias"}` : ""}
                </span>
                {comp.general && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">General · peso {comp.peso}</span>}
                {!comp.activa && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Desactivado</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{comp.puestosCompetencia.length} {comp.puestosCompetencia.length === 1 ? "puesto" : "puestos"}</span>
                <svg
                  className={`h-4 w-4 text-gray-500 transition-transform ${expanded === comp.id ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {expanded === comp.id && (
              <div className="border-t border-gray-200 px-5 pb-5">
                {editando?.id === comp.id ? (
                  <div className="mt-4 space-y-4 rounded-xl bg-gray-50 p-4">
                    <CamposAspecto d={editando.d} set={(d) => setEditando({ id: comp.id, d })} />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditando(null)} className="btn btn-ghost">Cancelar</button>
                      <button onClick={guardarEdicion} disabled={guardando || !editando.d.nombre.trim()} className="btn btn-primary">
                        {guardando ? "Guardando…" : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        setEditando({
                          id: comp.id,
                          d: {
                            nombre: comp.nombre,
                            descripcion: comp.descripcion ?? "",
                            categoria: comp.categoria,
                            tipo: comp.tipoEvaluacion ?? "AMBAS",
                            general: comp.general,
                            peso: comp.peso,
                          },
                        })
                      }
                    >
                      Editar
                    </button>
                    <button
                      className="btn btn-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      disabled={guardando}
                      onClick={() =>
                        void enviar(`/api/competencias/${comp.id}`, "PATCH", { activa: !comp.activa }, comp.activa ? "Aspecto desactivado: ya no se evalúa." : "Aspecto activado.")
                      }
                    >
                      {comp.activa ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                )}

                {comp.puestosCompetencia.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-gray-500">Puestos que lo evalúan</p>
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
                  <p className="mt-4 text-sm text-gray-500">
                    {comp.general ? "Ningún puesto lo tiene asignado: se evalúa como aspecto general." : "Todavía no está asignado a ningún puesto."}
                  </p>
                )}

                {comp.activa && (asignando === comp.id ? (
                  <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-800">Asignar a un puesto</p>
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
                      <Campo etiqueta="Peso (0.1 a 10)">
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
                    {homonimos > 1 && (
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={mismoNombre} onChange={(e) => setMismoNombre(e.target.checked)} />
                        En los {homonimos} puestos «{puestoElegido?.nombreCorto}» de todas las sucursales y departamentos
                      </label>
                    )}
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
                    onClick={() => { setAsignando(comp.id); setPuestoSel(""); setMismoNombre(true); }}
                    className="btn btn-secondary btn-sm mt-3"
                  >
                    Asignar a un puesto
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
