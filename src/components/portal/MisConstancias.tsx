"use client";

/** Mi espacio → Constancias: el empleado genera la suya, con folio, al momento. */

import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/utils";

interface Datos {
  plantillas: { id: string; nombre: string; tipo: string }[];
  emitidos: { id: string; folio: string; titulo: string; destinatario: string | null; createdAt: string }[];
}

export default function MisConstancias() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [plantillaId, setPlantillaId] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/mi-espacio/documentos", { cache: "no-store" });
    if (res.ok) setDatos(await res.json());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  if (!datos) return <p className="text-sm text-gray-400">Cargando…</p>;
  const sel = plantillaId || datos.plantillas[0]?.id || "";

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/mi-espacio/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantillaId: sel, destinatario: destinatario || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo generar");
      setAviso({ ok: true, texto: `Constancia generada con el folio ${d.folio}.` });
      window.open(`/api/documentos/emitidos/${d.id}/pdf?modo=ver`, "_blank", "noopener");
      setDestinatario("");
      await cargar();
    } catch (err) {
      setAviso({ ok: false, texto: err instanceof Error ? err.message : "Error" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <form onSubmit={generar} className="panel h-fit space-y-3 p-5" aria-labelledby="pedir-constancia">
        <h2 id="pedir-constancia" className="text-sm font-semibold text-gray-900">Generar una constancia</h2>
        {datos.plantillas.length === 0 ? (
          <p className="text-sm text-gray-500">Recursos Humanos todavía no habilitó constancias en autoservicio.</p>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="mc-tipo">Constancia</label>
              <select id="mc-tipo" className="input" value={sel} onChange={(e) => setPlantillaId(e.target.value)}>
                {datos.plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="mc-dest">Dirigida a</label>
              <input id="mc-dest" className="input" placeholder="A quien interese" value={destinatario} onChange={(e) => setDestinatario(e.target.value)} />
              <p className="mt-1 text-[11px] text-gray-500">Por ejemplo, el nombre del banco o de la embajada.</p>
            </div>
            {aviso && <p className={`text-sm ${aviso.ok ? "text-green-800" : "text-red-700"}`}>{aviso.texto}</p>}
            <button type="submit" className="btn btn-primary" disabled={enviando || !sel}>{enviando ? "Generando…" : "Generar y descargar"}</button>
          </>
        )}
      </form>
      <section className="panel overflow-hidden" aria-labelledby="mis-constancias">
        <h2 id="mis-constancias" className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">Mis constancias</h2>
        {datos.emitidos.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No ha generado constancias.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {datos.emitidos.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm text-gray-900">{d.titulo}</p>
                  <p className="text-xs text-gray-500">Folio {d.folio}. {formatDateTime(d.createdAt)}{d.destinatario ? `. Para ${d.destinatario}` : ""}</p>
                </div>
                <a className="btn btn-ghost btn-sm" href={`/api/documentos/emitidos/${d.id}/pdf?modo=ver`} target="_blank" rel="noopener noreferrer">PDF</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
