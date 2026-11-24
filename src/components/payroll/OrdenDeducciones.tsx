"use client";

/**
 * «Orden de las deducciones»: en qué orden van las columnas de deducción de la planilla,
 * en pantalla y al imprimir. Uno solo para toda la empresa; lo cambia quien configura
 * deducciones. Ver `lib/deducciones/orden-columnas.ts`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/ModalForm";

interface Tipo { codigo: string; nombre: string }
type Origen = "GUARDADO" | "FORMATO" | "NOMBRE";

const DE_DONDE: Record<Exclude<Origen, "GUARDADO">, string> = {
  FORMATO: "Todavía no se ha guardado un orden: ahora siguen el del formato por sucursal.",
  NOMBRE: "Todavía no se ha guardado un orden: ahora van por nombre.",
};

export default function OrdenDeducciones({ enPlanilla }: { enPlanilla: string[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipos, setTipos] = useState<Tipo[] | null>(null);
  const [origen, setOrigen] = useState<Origen>("NOMBRE");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enEsta = new Set(enPlanilla);

  async function abrir() {
    setAbierto(true);
    setTipos(null);
    setError(null);
    try {
      const r = await fetch("/api/deducciones/orden", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo cargar el orden.");
      setTipos(d.tipos as Tipo[]);
      setOrigen(d.origen as Origen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el orden.");
    }
  }

  function mover(i: number, paso: -1 | 1) {
    if (!tipos) return;
    const j = i + paso;
    if (j < 0 || j >= tipos.length) return;
    const lista = [...tipos];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    setTipos(lista);
  }

  async function enviar(metodo: "PUT" | "DELETE") {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/deducciones/orden", {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: metodo === "PUT" ? JSON.stringify({ codigos: (tipos ?? []).map((t) => t.codigo) }) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar el orden.");
      setAbierto(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el orden.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => void abrir()} data-orden-deducciones>Orden de las deducciones</button>
      {abierto && (
        <Modal titulo="Orden de las deducciones" error={error} cargando={cargando} puedeGuardar={!!tipos?.length}
          textoGuardar="Guardar orden" onCerrar={() => setAbierto(false)} onGuardar={() => void enviar("PUT")}>
          <p className="text-sm text-gray-600">
            Ponga las deducciones en el orden de su planilla. Vale para la pantalla y para la impresa, para todos. En cada planilla
            salen sólo las que alguien tiene.
          </p>
          {origen !== "GUARDADO" && <p className="text-xs text-gray-500" data-origen-orden>{DE_DONDE[origen]}</p>}
          {tipos === null && !error && <p className="text-sm text-gray-500">Cargando…</p>}
          {tipos && (
            <ol className="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200" data-lista-orden>
              {tipos.map((t, i) => (
                <li key={t.codigo} className="flex items-center gap-2 px-3 py-1">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                    {t.nombre}
                    {enEsta.has(t.nombre) && <span className="ml-2 text-xs text-gray-500">en esta planilla</span>}
                  </span>
                  <button type="button" data-toque className="btn btn-ghost btn-sm px-2" aria-label={`Subir ${t.nombre}`} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                  <button type="button" data-toque className="btn btn-ghost btn-sm px-2" aria-label={`Bajar ${t.nombre}`} disabled={i === tipos.length - 1} onClick={() => mover(i, 1)}>↓</button>
                </li>
              ))}
            </ol>
          )}
          {origen === "GUARDADO" && (
            <button type="button" className="text-sm font-medium text-blue-700 hover:underline disabled:opacity-50" disabled={cargando}
              onClick={() => void enviar("DELETE")} data-quitar-orden>
              Quitar el orden guardado
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
