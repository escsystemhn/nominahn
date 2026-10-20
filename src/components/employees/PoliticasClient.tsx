"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/utils";

interface Politica {
  id: string;
  titulo: string;
  categoria: string;
  descripcion: string | null;
  _count: { versiones: number };
}

interface Version {
  id: string;
  numero: number;
  contenido: string;
  notasCambio: string | null;
  vigente: boolean;
  createdAt: string;
}

interface PoliticaDetalle extends Politica {
  versiones: Version[];
}

// Peticiones puras (no tocan estado de React), reutilizables desde los efectos y
// desde los manejadores de eventos.
async function obtenerPoliticas(): Promise<Politica[]> {
  const res = await fetch("/api/politicas");
  return res.ok ? await res.json() : [];
}

async function obtenerDetalle(id: string): Promise<PoliticaDetalle | null> {
  const res = await fetch(`/api/politicas/${id}`);
  return res.ok ? await res.json() : null;
}

export default function PoliticasClient({ puedeGestionar }: { puedeGestionar: boolean }) {
  const [lista, setLista] = useState<Politica[]>([]);
  const [detalle, setDetalle] = useState<PoliticaDetalle | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [verVersion, setVerVersion] = useState<number | null>(null);
  // Arranca en true: el efecto de carga inicial lo baja al recibir los datos.
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [creando, setCreando] = useState(false);
  const [fNueva, setFNueva] = useState({ titulo: "", categoria: "General", descripcion: "", contenido: "" });
  const [nuevaVersion, setNuevaVersion] = useState({ contenido: "", notasCambio: "" });
  const [mostrarNuevaVersion, setMostrarNuevaVersion] = useState(false);

  // Refresco manual tras una mutación (desde manejadores de eventos).
  const cargar = useCallback(async () => {
    setLoading(true);
    try { setLista(await obtenerPoliticas()); }
    finally { setLoading(false); }
  }, []);

  const aplicarDetalle = useCallback((d: PoliticaDetalle | null) => {
    setDetalle(d);
    if (!d) return;
    const vig = d.versiones.find((v) => v.vigente) ?? d.versiones[0];
    setVerVersion(vig?.numero ?? null);
  }, []);

  const cargarDetalle = useCallback(async (id: string) => {
    aplicarDetalle(await obtenerDetalle(id));
  }, [aplicarDetalle]);

  // Carga inicial. `vivo` descarta respuestas que llegan tarde.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const datos = await obtenerPoliticas();
      if (!vivo) return;
      setLista(datos);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!sel) return;
    let vivo = true;
    (async () => {
      const d = await obtenerDetalle(sel);
      if (!vivo) return;
      setMostrarNuevaVersion(false);
      aplicarDetalle(d);
    })();
    return () => { vivo = false; };
  }, [sel, aplicarDetalle]);

  async function crearPolitica(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    if (!fNueva.titulo.trim() || !fNueva.contenido.trim()) { setMsg("Título y contenido son obligatorios."); return; }
    const res = await fetch("/api/politicas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fNueva) });
    if (!res.ok) { setMsg((await res.json()).error ?? "Error al crear."); return; }
    setFNueva({ titulo: "", categoria: "General", descripcion: "", contenido: "" });
    setCreando(false); await cargar();
  }

  async function publicarVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!sel || !nuevaVersion.contenido.trim()) return;
    const res = await fetch(`/api/politicas/${sel}/versiones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nuevaVersion) });
    if (!res.ok) { alert((await res.json()).error ?? "Error."); return; }
    setNuevaVersion({ contenido: "", notasCambio: "" });
    setMostrarNuevaVersion(false);
    await cargarDetalle(sel); await cargar();
  }

  const versionMostrada = detalle?.versiones.find((v) => v.numero === verVersion) ?? null;
  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Políticas y procedimientos</h1>
          <p className="text-sm text-gray-500">Repositorio documental con control de versiones</p>
        </div>
        {puedeGestionar && (
          <button onClick={() => setCreando((v) => !v)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            {creando ? "Cancelar" : "Nueva política"}
          </button>
        )}
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {creando && puedeGestionar && (
        <form onSubmit={crearPolitica} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2"><label className="block text-xs text-gray-600 mb-1">Título</label><input className={inputCls} value={fNueva.titulo} onChange={(e) => setFNueva({ ...fNueva, titulo: e.target.value })} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Categoría</label><input className={inputCls} value={fNueva.categoria} onChange={(e) => setFNueva({ ...fNueva, categoria: e.target.value })} /></div>
          </div>
          <div><label className="block text-xs text-gray-600 mb-1">Descripción breve</label><input className={inputCls} value={fNueva.descripcion} onChange={(e) => setFNueva({ ...fNueva, descripcion: e.target.value })} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Contenido (versión 1)</label><textarea rows={6} className={inputCls} value={fNueva.contenido} onChange={(e) => setFNueva({ ...fNueva, contenido: e.target.value })} /></div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Crear política</button>
        </form>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Lista */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden h-fit">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Políticas</div>
          {loading ? <p className="p-5 text-sm text-gray-400">Cargando…</p> : lista.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No hay políticas registradas.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {lista.map((p) => (
                <li key={p.id} className={`px-5 py-3 cursor-pointer hover:bg-gray-50 ${sel === p.id ? "bg-blue-50" : ""}`} onClick={() => setSel(p.id)}>
                  <p className="text-sm font-medium text-gray-900">{p.titulo}</p>
                  <p className="text-xs text-gray-500">{p.categoria} · {p._count.versiones} versión(es)</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detalle */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {!detalle ? (
            <p className="p-5 text-sm text-gray-400">Seleccione una política para ver su contenido e historial.</p>
          ) : (
            <div>
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{detalle.titulo}</p>
                  <p className="text-xs text-gray-500">{detalle.categoria}{detalle.descripcion ? ` · ${detalle.descripcion}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select value={verVersion ?? ""} onChange={(e) => setVerVersion(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
                    {detalle.versiones.map((v) => (
                      <option key={v.id} value={v.numero}>v{v.numero}{v.vigente ? " (vigente)" : ""} · {formatDate(v.createdAt)}</option>
                    ))}
                  </select>
                  {puedeGestionar && (
                    <button onClick={() => setMostrarNuevaVersion((v) => !v)} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
                      {mostrarNuevaVersion ? "Cancelar" : "Nueva versión"}
                    </button>
                  )}
                </div>
              </div>

              {mostrarNuevaVersion && puedeGestionar && (
                <form onSubmit={publicarVersion} className="px-5 py-4 border-b border-gray-100 bg-gray-50 space-y-2">
                  <textarea rows={5} className={inputCls} placeholder="Contenido de la nueva versión" value={nuevaVersion.contenido} onChange={(e) => setNuevaVersion({ ...nuevaVersion, contenido: e.target.value })} />
                  <input className={inputCls} placeholder="Notas del cambio (qué se modificó)" value={nuevaVersion.notasCambio} onChange={(e) => setNuevaVersion({ ...nuevaVersion, notasCambio: e.target.value })} />
                  <button type="submit" className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">Publicar versión {(detalle.versiones[0]?.numero ?? 0) + 1}</button>
                </form>
              )}

              {versionMostrada && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${versionMostrada.vigente ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                      Versión {versionMostrada.numero}{versionMostrada.vigente ? " · vigente" : " · histórica"}
                    </span>
                    <span>{formatDate(versionMostrada.createdAt)}</span>
                    {versionMostrada.notasCambio && <span className="italic">· {versionMostrada.notasCambio}</span>}
                  </div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{versionMostrada.contenido}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
