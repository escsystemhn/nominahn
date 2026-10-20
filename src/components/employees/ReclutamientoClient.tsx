"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

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
const etapaBadge: Record<string, string> = {
  RECIBIDO: "bg-gray-100 text-gray-700",
  PRESELECCION: "bg-blue-100 text-blue-800",
  ENTREVISTA: "bg-indigo-100 text-indigo-800",
  OFERTA: "bg-amber-100 text-amber-800",
  CONTRATADO: "bg-green-100 text-green-800",
  RECHAZADO: "bg-red-100 text-red-700",
};
const estadoBadge: Record<string, string> = {
  ABIERTA: "bg-green-100 text-green-800",
  PAUSADA: "bg-amber-100 text-amber-800",
  CERRADA: "bg-gray-100 text-gray-500",
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
  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reclutamiento y selección</h1>
          <p className="text-sm text-gray-500">Vacantes y seguimiento de candidatos</p>
        </div>
        {puedeGestionar && (
          <button onClick={() => setCreando((v) => !v)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            {creando ? "Cancelar" : "Nueva vacante"}
          </button>
        )}
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {creando && puedeGestionar && (
        <form onSubmit={crearVacante} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Título del puesto</label>
            <input className={inputCls} value={fVac.titulo} onChange={(e) => setFVac({ ...fVac, titulo: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Departamento</label>
            <select className={inputCls} value={fVac.departamentoId} onChange={(e) => setFVac({ ...fVac, departamentoId: e.target.value })}>
              <option value="">—</option>
              {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Tipo de contrato</label>
            <select className={inputCls} value={fVac.tipoContrato} onChange={(e) => setFVac({ ...fVac, tipoContrato: e.target.value })}>
              <option value="INDEFINIDO">Indefinido</option>
              <option value="TEMPORAL">Temporal</option>
              <option value="PRUEBA">Prueba</option>
              <option value="SERVICIO">Servicio</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Plazas</label>
              <input type="number" min={1} className={inputCls} value={fVac.plazas} onChange={(e) => setFVac({ ...fVac, plazas: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Salario mín.</label>
              <input type="number" className={inputCls} value={fVac.salarioMin} onChange={(e) => setFVac({ ...fVac, salarioMin: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Salario máx.</label>
              <input type="number" className={inputCls} value={fVac.salarioMax} onChange={(e) => setFVac({ ...fVac, salarioMax: e.target.value })} />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Descripción</label>
            <textarea rows={2} className={inputCls} value={fVac.descripcion} onChange={(e) => setFVac({ ...fVac, descripcion: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Requisitos</label>
            <textarea rows={2} className={inputCls} value={fVac.requisitos} onChange={(e) => setFVac({ ...fVac, requisitos: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={fVac.esInterna} onChange={(e) => setFVac({ ...fVac, esInterna: e.target.checked, publicada: e.target.checked ? false : fVac.publicada })} />
            Convocatoria interna
          </label>
          <label className={`flex items-center gap-2 text-sm ${fVac.esInterna ? "text-gray-400" : "text-gray-700"}`}>
            <input type="checkbox" checked={fVac.publicada} disabled={fVac.esInterna} onChange={(e) => setFVac({ ...fVac, publicada: e.target.checked })} />
            Publicar en el portal de empleo
          </label>
          <div className="md:col-span-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Publicar vacante</button>
          </div>
        </form>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Lista de vacantes */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Vacantes</div>
          {loading ? <p className="p-5 text-sm text-gray-400">Cargando…</p> : vacantes.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No hay vacantes.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {vacantes.map((v) => (
                <li key={v.id} className={`px-5 py-3 cursor-pointer hover:bg-gray-50 ${sel === v.id ? "bg-blue-50" : ""}`} onClick={() => setSel(v.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{v.titulo}</p>
                      <p className="text-xs text-gray-500">
                        {v.departamento?.nombre ?? "—"} · {v.plazas} plaza(s) · {v._count.candidatos} candidato(s){v.esInterna ? " · Interna" : ""}{v.publicada && !v.esInterna ? " · En el portal" : ""}
                        {v.salarioMin ? ` · ${formatCurrency(Number(v.salarioMin))}` : ""}{v.salarioMax ? `–${formatCurrency(Number(v.salarioMax))}` : ""}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${estadoBadge[v.estado]}`}>{v.estado}</span>
                  </div>
                  {puedeGestionar && (
                    <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                      {v.estado !== "ABIERTA" && <button onClick={() => cambiarEstadoVacante(v.id, "ABIERTA")} className="text-xs text-green-700 hover:underline">Abrir</button>}
                      {v.estado === "ABIERTA" && <button onClick={() => cambiarEstadoVacante(v.id, "PAUSADA")} className="text-xs text-amber-700 hover:underline">Pausar</button>}
                      {v.estado !== "CERRADA" && <button onClick={() => cambiarEstadoVacante(v.id, "CERRADA")} className="text-xs text-red-700 hover:underline">Cerrar</button>}
                      {!v.esInterna && (
                        v.publicada
                          ? <button onClick={() => publicarVacante(v.id, false)} className="text-xs text-gray-600 hover:underline">Retirar del portal</button>
                          : <button onClick={() => publicarVacante(v.id, true)} className="text-xs text-blue-700 hover:underline">Publicar en el portal</button>
                      )}
                      {v.publicada && !v.esInterna && v.estado === "ABIERTA" && (
                        <a href={`/empleos/${v.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline">Ver anuncio</a>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pipeline de candidatos */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">
            {vacanteSel ? `Candidatos · ${vacanteSel.titulo}` : "Seleccione una vacante"}
          </div>
          {!sel ? (
            <p className="p-5 text-sm text-gray-400">Elija una vacante para ver y gestionar sus candidatos.</p>
          ) : (
            <div className="p-4 space-y-3">
              {puedeGestionar && (
                <form onSubmit={agregarCandidato} className="grid grid-cols-2 gap-2 pb-3 border-b border-gray-100">
                  <input className={inputCls} placeholder="Nombre" value={fCand.nombre} onChange={(e) => setFCand({ ...fCand, nombre: e.target.value })} />
                  <input className={inputCls} placeholder="Email" value={fCand.email} onChange={(e) => setFCand({ ...fCand, email: e.target.value })} />
                  <input className={inputCls} placeholder="Teléfono" value={fCand.telefono} onChange={(e) => setFCand({ ...fCand, telefono: e.target.value })} />
                  <input className={inputCls} placeholder="Fuente (LinkedIn, referido…)" value={fCand.fuente} onChange={(e) => setFCand({ ...fCand, fuente: e.target.value })} />
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">CV (PDF/DOC/imagen, máx. 5 MB)</label>
                    <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={(e) => setCvFile(e.target.files?.[0] ?? null)} className="text-xs" />
                  </div>
                  <button type="submit" disabled={subiendo} className="col-span-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">{subiendo ? "Guardando…" : "Agregar candidato"}</button>
                </form>
              )}
              {candidatos.length === 0 ? (
                <p className="text-sm text-gray-400">Sin candidatos.</p>
              ) : (
                <ul className="space-y-2">
                  {candidatos.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {c.nombre}
                          {c.cvUrl && <a href={c.cvUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-600 hover:underline font-normal">CV</a>}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{[c.email, c.telefono, c.fuente].filter(Boolean).join(" · ") || "—"}</p>
                      </div>
                      {puedeGestionar ? (
                        <select value={c.etapa} onChange={(e) => moverEtapa(c.id, e.target.value)} className={`text-xs rounded-full px-2 py-1 font-medium border-0 ${etapaBadge[c.etapa]}`}>
                          {ETAPAS.map((et) => <option key={et} value={et}>{et}</option>)}
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${etapaBadge[c.etapa]}`}>{c.etapa}</span>
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
