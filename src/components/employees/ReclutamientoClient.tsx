"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { type Tono } from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";

interface Vacante {
  id: string;
  titulo: string;
  estado: string;
  plazas: number;
  esInterna: boolean;
  publicada: boolean;
  tipoContrato: string;
  salarioMin: string | number | null;
  salarioMax: string | number | null;
  departamento: { nombre: string } | null;
  _count: { candidatos: number };
  createdAt: string;
}

interface Candidato {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  fuente: string | null;
  etapa: string;
  notas: string | null;
  cvUrl: string | null;
}

interface Props {
  departamentos: { id: string; nombre: string }[];
  puedeGestionar: boolean;
}

const ETAPAS = ["RECIBIDO", "PRESELECCION", "ENTREVISTA", "OFERTA", "CONTRATADO", "RECHAZADO"];
const etapaBadge: Record<string, { etiqueta: string; tono: Tono }> = {
  RECIBIDO: { etiqueta: "Recibido", tono: "neutro" },
  PRESELECCION: { etiqueta: "Preselección", tono: "marca" },
  ENTREVISTA: { etiqueta: "Entrevista", tono: "marca" },
  OFERTA: { etiqueta: "Oferta", tono: "aviso" },
  CONTRATADO: { etiqueta: "Contratado", tono: "ok" },
  RECHAZADO: { etiqueta: "Rechazado", tono: "error" },
};
const estadoBadge: Record<string, { etiqueta: string; tono: Tono }> = {
  ABIERTA: { etiqueta: "Abierta", tono: "ok" },
  PAUSADA: { etiqueta: "Pausada", tono: "aviso" },
  CERRADA: { etiqueta: "Cerrada", tono: "neutro" },
};

// Peticiones puras (no tocan estado de React), reutilizables desde los efectos y
// desde los manejadores de eventos.
async function obtenerVacantes(): Promise<Vacante[]> {
  const res = await fetch("/api/reclutamiento/vacantes");
  return res.ok ? await res.json() : [];
}

async function obtenerCandidatos(vacanteId: string): Promise<Candidato[]> {
  const res = await fetch(`/api/reclutamiento/vacantes/${vacanteId}`);
  if (!res.ok) return [];
  const v = await res.json();
  return v.candidatos ?? [];
}

export default function ReclutamientoClient({ departamentos, puedeGestionar }: Props) {
  const [vacantes, setVacantes] = useState<Vacante[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  // Arranca en true: el efecto de carga inicial lo baja al recibir los datos.
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [msg, setMsg] = useState("");

  const [fVac, setFVac] = useState({ titulo: "", departamentoId: "", tipoContrato: "INDEFINIDO", plazas: 1, esInterna: false, publicada: false, salarioMin: "", salarioMax: "", descripcion: "", requisitos: "" });
  const [fCand, setFCand] = useState({ nombre: "", email: "", telefono: "", fuente: "" });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  // Refresco manual tras una mutación (desde manejadores de eventos).
  const cargarVacantes = useCallback(async () => {
    setLoading(true);
    try { setVacantes(await obtenerVacantes()); }
    finally { setLoading(false); }
  }, []);

  const cargarCandidatos = useCallback(async (vacanteId: string) => {
    setCandidatos(await obtenerCandidatos(vacanteId));
  }, []);

  // Carga inicial. `vivo` descarta respuestas que llegan tarde.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const datos = await obtenerVacantes();
      if (!vivo) return;
      setVacantes(datos);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!sel) return;
    let vivo = true;
    (async () => {
      const cs = await obtenerCandidatos(sel);
      if (vivo) setCandidatos(cs);
    })();
    return () => { vivo = false; };
  }, [sel]);

  async function crearVacante(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    if (!fVac.titulo.trim()) { setMsg("El título es obligatorio."); return; }
    const res = await fetch("/api/reclutamiento/vacantes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fVac, publicada: fVac.publicada && !fVac.esInterna }) });
    if (!res.ok) { setMsg((await res.json()).error ?? "Error al crear."); return; }
    setFVac({ titulo: "", departamentoId: "", tipoContrato: "INDEFINIDO", plazas: 1, esInterna: false, publicada: false, salarioMin: "", salarioMax: "", descripcion: "", requisitos: "" });
    setCreando(false);
    await cargarVacantes();
  }

  async function cambiarEstadoVacante(id: string, estado: string) {
    await fetch(`/api/reclutamiento/vacantes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado }) });
    await cargarVacantes();
  }

  async function publicarVacante(id: string, publicada: boolean) {
    setMsg("");
    const res = await fetch(`/api/reclutamiento/vacantes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicada }) });
    if (!res.ok) setMsg((await res.json()).error ?? "No se pudo cambiar la publicación.");
    await cargarVacantes();
  }

  async function agregarCandidato(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    if (!sel || !fCand.nombre.trim()) return;
    setSubiendo(true);
    try {
      let cvUrl: string | null = null;
      if (cvFile) {
        const fd = new FormData();
        fd.append("file", cvFile);
        const up = await fetch("/api/uploads", { method: "POST", body: fd });
        if (!up.ok) { setMsg((await up.json()).error ?? "No se pudo subir el CV."); return; }
        cvUrl = (await up.json()).url;
      }
      const res = await fetch("/api/reclutamiento/candidatos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fCand, vacanteId: sel, cvUrl }) });
      if (res.ok) { setFCand({ nombre: "", email: "", telefono: "", fuente: "" }); setCvFile(null); await cargarCandidatos(sel); await cargarVacantes(); }
    } finally { setSubiendo(false); }
  }

  async function moverEtapa(id: string, etapa: string) {
    await fetch(`/api/reclutamiento/candidatos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etapa }) });
    if (sel) await cargarCandidatos(sel);
  }

  const vacanteSel = vacantes.find((v) => v.id === sel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reclutamiento y selección"
        description="Vacantes y seguimiento de candidatos."
        actions={
          puedeGestionar && (
            <button onClick={() => setCreando((v) => !v)} className={creando ? "btn btn-secondary" : "btn btn-primary"}>
              {creando ? "Cancelar" : "Nueva vacante"}
            </button>
          )
        }
      />

      {msg && <p className="text-sm text-red-700" role="alert">{msg}</p>}

      {creando && puedeGestionar && (
        <form onSubmit={crearVacante} className="panel grid gap-4 p-5 md:grid-cols-2">
          <Campo etiqueta="Título del puesto">
            <input className="input" value={fVac.titulo} onChange={(e) => setFVac({ ...fVac, titulo: e.target.value })} />
          </Campo>
          <Campo etiqueta="Departamento">
            <select className="input" value={fVac.departamentoId} onChange={(e) => setFVac({ ...fVac, departamentoId: e.target.value })}>
              <option value="">—</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Tipo de contrato">
            <select className="input" value={fVac.tipoContrato} onChange={(e) => setFVac({ ...fVac, tipoContrato: e.target.value })}>
              <option value="INDEFINIDO">Indefinido</option>
              <option value="TEMPORAL">Temporal</option>
              <option value="PRUEBA">Prueba</option>
              <option value="SERVICIO">Servicio</option>
            </select>
          </Campo>
          <div className="grid grid-cols-3 gap-2">
            <Campo etiqueta="Plazas">
              <input type="number" min={1} className="input" value={fVac.plazas} onChange={(e) => setFVac({ ...fVac, plazas: Number(e.target.value) })} />
            </Campo>
            <Campo etiqueta="Salario mínimo">
              <input type="number" className="input" value={fVac.salarioMin} onChange={(e) => setFVac({ ...fVac, salarioMin: e.target.value })} />
            </Campo>
            <Campo etiqueta="Salario máximo">
              <input type="number" className="input" value={fVac.salarioMax} onChange={(e) => setFVac({ ...fVac, salarioMax: e.target.value })} />
            </Campo>
          </div>
          <div className="md:col-span-2">
            <Campo etiqueta="Descripción">
              <textarea rows={2} className="input" value={fVac.descripcion} onChange={(e) => setFVac({ ...fVac, descripcion: e.target.value })} />
            </Campo>
          </div>
          <div className="md:col-span-2">
            <Campo etiqueta="Requisitos">
              <textarea rows={2} className="input" value={fVac.requisitos} onChange={(e) => setFVac({ ...fVac, requisitos: e.target.value })} />
            </Campo>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={fVac.esInterna} onChange={(e) => setFVac({ ...fVac, esInterna: e.target.checked, publicada: e.target.checked ? false : fVac.publicada })} />
            Convocatoria interna
          </label>
          <label className={`flex items-center gap-2 text-sm ${fVac.esInterna ? "text-gray-500" : "text-gray-700"}`}>
            <input type="checkbox" checked={fVac.publicada} disabled={fVac.esInterna} onChange={(e) => setFVac({ ...fVac, publicada: e.target.checked })} />
            Publicar en el portal de empleo
          </label>
          <div className="md:col-span-2">
            <button type="submit" className="btn btn-primary">Publicar vacante</button>
          </div>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Lista de vacantes */}
        <div className="panel overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">Vacantes</div>
          {loading ? <p className="p-5 text-sm text-gray-500">Cargando…</p> : vacantes.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay vacantes."
              detalle={puedeGestionar ? "Abra la primera con el botón «Nueva vacante»." : "Cuando Recursos Humanos abra una, aparecerá aquí."}
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {vacantes.map((v) => {
                const est = estadoBadge[v.estado];
                return (
                  <li key={v.id} className={`cursor-pointer px-5 py-3 hover:bg-gray-50 ${sel === v.id ? "bg-blue-50" : ""}`} onClick={() => setSel(v.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{v.titulo}</p>
                        <p className="text-xs text-gray-500">
                          {v.departamento?.nombre ?? "—"}, {v.plazas} plaza(s), {v._count.candidatos} candidato(s){v.esInterna ? ", interna" : ""}{v.publicada && !v.esInterna ? ", en el portal" : ""}
                          {v.salarioMin ? `, ${formatCurrency(Number(v.salarioMin))}` : ""}{v.salarioMax ? ` a ${formatCurrency(Number(v.salarioMax))}` : ""}
                        </p>
                      </div>
                      {est ? <EstadoBadge valor={v.estado} etiqueta={est.etiqueta} tono={est.tono} /> : <EstadoBadge valor={v.estado} />}
                    </div>
                    {puedeGestionar && (
                      <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                        {v.estado !== "ABIERTA" && <button onClick={() => cambiarEstadoVacante(v.id, "ABIERTA")} className="btn btn-ghost btn-sm">Abrir</button>}
                        {v.estado === "ABIERTA" && <button onClick={() => cambiarEstadoVacante(v.id, "PAUSADA")} className="btn btn-ghost btn-sm">Pausar</button>}
                        {v.estado !== "CERRADA" && <button onClick={() => cambiarEstadoVacante(v.id, "CERRADA")} className="btn btn-ghost btn-sm">Cerrar</button>}
                        {!v.esInterna && (
                          v.publicada
                            ? <button onClick={() => publicarVacante(v.id, false)} className="btn btn-ghost btn-sm">Retirar del portal</button>
                            : <button onClick={() => publicarVacante(v.id, true)} className="btn btn-ghost btn-sm">Publicar en el portal</button>
                        )}
                        {v.publicada && !v.esInterna && v.estado === "ABIERTA" && (
                          <a href={`/empleos/${v.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Ver anuncio</a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pipeline de candidatos */}
        <div className="panel overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">
            {vacanteSel ? `Candidatos: ${vacanteSel.titulo}` : "Seleccione una vacante"}
          </div>
          {!sel ? (
            <EstadoVacio titulo="Ninguna vacante elegida." detalle="Elija una vacante de la lista para ver y gestionar sus candidatos." />
          ) : (
            <div className="space-y-3 p-4">
              {puedeGestionar && (
                <form onSubmit={agregarCandidato} className="grid grid-cols-2 gap-2 border-b border-gray-100 pb-3">
                  <input className="input" aria-label="Nombre" placeholder="Nombre" value={fCand.nombre} onChange={(e) => setFCand({ ...fCand, nombre: e.target.value })} />
                  <input className="input" aria-label="Correo electrónico" placeholder="Correo electrónico" value={fCand.email} onChange={(e) => setFCand({ ...fCand, email: e.target.value })} />
                  <input className="input" aria-label="Teléfono" placeholder="Teléfono" value={fCand.telefono} onChange={(e) => setFCand({ ...fCand, telefono: e.target.value })} />
                  <input className="input" aria-label="Fuente" placeholder="Fuente (LinkedIn, referido…)" value={fCand.fuente} onChange={(e) => setFCand({ ...fCand, fuente: e.target.value })} />
                  <label className="col-span-2 block text-xs text-gray-500">
                    CV (PDF, DOC o imagen, máximo 5 MB)
                    <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={(e) => setCvFile(e.target.files?.[0] ?? null)} className="mt-1 block text-xs" />
                  </label>
                  <button type="submit" disabled={subiendo} className="btn btn-secondary col-span-2">{subiendo ? "Guardando…" : "Agregar candidato"}</button>
                </form>
              )}
              {candidatos.length === 0 ? (
                <p className="text-sm text-gray-500">Esta vacante todavía no tiene candidatos.</p>
              ) : (
                <ul className="space-y-2">
                  {candidatos.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {c.nombre}
                          {c.cvUrl && <a href={c.cvUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs font-normal text-blue-700 hover:underline">CV</a>}
                        </p>
                        <p className="truncate text-xs text-gray-500">{[c.email, c.telefono, c.fuente].filter(Boolean).join(", ") || "—"}</p>
                      </div>
                      {puedeGestionar ? (
                        <select aria-label={`Etapa de ${c.nombre}`} value={c.etapa} onChange={(e) => moverEtapa(c.id, e.target.value)} className="input h-8! w-auto! text-xs">
                          {ETAPAS.map((et) => <option key={et} value={et}>{etapaBadge[et].etiqueta}</option>)}
                        </select>
                      ) : (
                        <EstadoBadge valor={c.etapa} etiqueta={etapaBadge[c.etapa]?.etiqueta} tono={etapaBadge[c.etapa]?.tono} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
