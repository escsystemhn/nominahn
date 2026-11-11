"use client";

import { useCallback, useEffect, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import { formatDate } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { Campo } from "@/components/ui/ModalForm";

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
  const { avisar } = useAvisos();
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
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error ?? "Error al crear."); return; }
    setFNueva({ titulo: "", categoria: "General", descripcion: "", contenido: "" });
    setCreando(false); await cargar();
  }

  async function publicarVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!sel || !nuevaVersion.contenido.trim()) return;
    const res = await fetch(`/api/politicas/${sel}/versiones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nuevaVersion) });
    if (!res.ok) { avisar.error((await res.json().catch(() => ({}))).error ?? "Error."); return; }
    setNuevaVersion({ contenido: "", notasCambio: "" });
    setMostrarNuevaVersion(false);
    await cargarDetalle(sel); await cargar();
  }

  const versionMostrada = detalle?.versiones.find((v) => v.numero === verVersion) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Políticas y procedimientos"
        description="Repositorio documental con control de versiones."
        actions={
          puedeGestionar && (
            <button onClick={() => setCreando((v) => !v)} className={creando ? "btn btn-secondary" : "btn btn-primary"}>
              {creando ? "Cancelar" : "Nueva política"}
            </button>
          )
        }
      />

      {msg && <p className="text-sm text-red-700" role="alert">{msg}</p>}

      {creando && puedeGestionar && (
        <form onSubmit={crearPolitica} className="panel space-y-3 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2"><Campo etiqueta="Título"><input className="input" value={fNueva.titulo} onChange={(e) => setFNueva({ ...fNueva, titulo: e.target.value })} /></Campo></div>
            <Campo etiqueta="Categoría"><input className="input" value={fNueva.categoria} onChange={(e) => setFNueva({ ...fNueva, categoria: e.target.value })} /></Campo>
          </div>
          <Campo etiqueta="Descripción breve"><input className="input" value={fNueva.descripcion} onChange={(e) => setFNueva({ ...fNueva, descripcion: e.target.value })} /></Campo>
          <Campo etiqueta="Contenido (versión 1)"><textarea rows={6} className="input" value={fNueva.contenido} onChange={(e) => setFNueva({ ...fNueva, contenido: e.target.value })} /></Campo>
          <button type="submit" className="btn btn-primary">Crear política</button>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Lista */}
        <div className="panel h-fit overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">Políticas</div>
          {loading ? <p className="p-5 text-sm text-gray-500">Cargando…</p> : lista.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay políticas."
              detalle={puedeGestionar ? "Publique la primera con el botón «Nueva política»." : "Cuando Recursos Humanos publique una, aparecerá aquí."}
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {lista.map((p) => (
                <li key={p.id} className={`cursor-pointer px-5 py-3 hover:bg-gray-50 ${sel === p.id ? "bg-blue-50" : ""}`} onClick={() => setSel(p.id)}>
                  <p className="text-sm font-medium text-gray-900">{p.titulo}</p>
                  <p className="text-xs text-gray-500">{p.categoria}, {p._count.versiones} versión(es)</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detalle */}
        <div className="panel overflow-hidden lg:col-span-2">
          {!detalle ? (
            <EstadoVacio titulo="Ninguna política elegida." detalle="Seleccione una política de la lista para ver su contenido e historial." />
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{detalle.titulo}</p>
                  <p className="text-xs text-gray-500">{detalle.categoria}{detalle.descripcion ? `, ${detalle.descripcion}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select aria-label="Versión" value={verVersion ?? ""} onChange={(e) => setVerVersion(Number(e.target.value))} className="input h-8! w-auto! text-xs">
                    {detalle.versiones.map((v) => (
                      <option key={v.id} value={v.numero}>v{v.numero}{v.vigente ? " (vigente)" : ""}, {formatDate(v.createdAt)}</option>
                    ))}
                  </select>
                  {puedeGestionar && (
                    <button onClick={() => setMostrarNuevaVersion((v) => !v)} className="btn btn-secondary btn-sm">
                      {mostrarNuevaVersion ? "Cancelar" : "Nueva versión"}
                    </button>
                  )}
                </div>
              </div>

              {mostrarNuevaVersion && puedeGestionar && (
                <form onSubmit={publicarVersion} className="space-y-2 border-b border-gray-200 bg-gray-50 px-5 py-4">
                  <textarea rows={5} aria-label="Contenido de la nueva versión" className="input" placeholder="Contenido de la nueva versión" value={nuevaVersion.contenido} onChange={(e) => setNuevaVersion({ ...nuevaVersion, contenido: e.target.value })} />
                  <input className="input" aria-label="Notas del cambio" placeholder="Notas del cambio (qué se modificó)" value={nuevaVersion.notasCambio} onChange={(e) => setNuevaVersion({ ...nuevaVersion, notasCambio: e.target.value })} />
                  <button type="submit" className="btn btn-primary">Publicar versión {(detalle.versiones[0]?.numero ?? 0) + 1}</button>
                </form>
              )}

              {versionMostrada && (
                <div className="px-5 py-4">
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <EstadoBadge
                      valor={versionMostrada.vigente ? "VIGENTE" : "ARCHIVADO"}
                      etiqueta={`Versión ${versionMostrada.numero}, ${versionMostrada.vigente ? "vigente" : "histórica"}`}
                    />
                    <span>{formatDate(versionMostrada.createdAt)}</span>
                    {versionMostrada.notasCambio && <span className="italic">{versionMostrada.notasCambio}</span>}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{versionMostrada.contenido}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
