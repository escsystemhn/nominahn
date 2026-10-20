"use client";

/**
 * Generar el archivo de pago para el banco: se elige el formato, se ve qué
 * entra y qué queda fuera (sin cuenta, otro banco) y se descarga.
 */

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface Resumen {
  incluidos: number;
  total: number;
  excluidos: { nombre: string; codigo: string; motivo: string; monto: number }[];
  avisos: string[];
  errores: string[];
}

/** `base`: la ruta sin `formatoId`, p. ej. `/api/planillas/ID/archivo-banco` o `/api/decimos/archivo-banco?tipo=…&anio=…`. */
export default function ArchivoBanco({ base, etiqueta = "Archivo para el banco" }: { base: string; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [formatos, setFormatos] = useState<{ id: string; nombre: string; activo: boolean }[] | null>(null);
  const [formatoId, setFormatoId] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = (extra: string) => `${base}${base.includes("?") ? "&" : "?"}formatoId=${encodeURIComponent(formatoId)}${extra}`;

  useEffect(() => {
    if (!abierto || formatos) return;
    let vivo = true;
    void (async () => {
      const r = await fetch("/api/formatos-banco", { cache: "no-store" });
      const d = await r.json();
      if (!vivo) return;
      if (!r.ok) {
        setError(d.error ?? "No se pudieron leer los formatos");
        return;
      }
      const activos = (d.formatos as { id: string; nombre: string; activo: boolean }[]).filter((f) => f.activo);
      setFormatos(activos);
      if (activos[0]) setFormatoId(activos[0].id);
    })();
    return () => { vivo = false; };
  }, [abierto, formatos]);

  useEffect(() => {
    if (!formatoId) return;
    let vivo = true;
    void (async () => {
      const r = await fetch(url("&resumen=1"), { cache: "no-store" });
      const d = await r.json();
      if (!vivo) return;
      if (!r.ok) {
        setResumen(null);
        setError(d.error ?? "No se pudo preparar el archivo");
      } else {
        setError(null);
        setResumen(d);
      }
    })();
    return () => { vivo = false; };
    // `url` depende de base y formatoId, que ya están en la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatoId, base]);

  if (!abierto) return <button type="button" className="btn btn-secondary" onClick={() => setAbierto(true)}>{etiqueta}</button>;

  return (
    <div className="w-full max-w-xl space-y-3 rounded-md border border-gray-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="ab-formato">Formato del banco</label>
          <select id="ab-formato" className="input" value={formatoId} onChange={(e) => setFormatoId(e.target.value)}>
            {(formatos ?? []).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto(false)}>Cerrar</button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      {resumen && (
        <>
          <p className="text-gray-700">{resumen.incluidos === 1 ? "1 pago" : `${resumen.incluidos} pagos`} por {formatCurrency(resumen.total)}.</p>
          {resumen.excluidos.length > 0 && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer">{resumen.excluidos.length === 1 ? "1 pago queda fuera del archivo" : `${resumen.excluidos.length} pagos quedan fuera del archivo`}</summary>
              <ul className="mt-1 list-disc pl-5">{resumen.excluidos.map((e) => <li key={e.codigo}>{e.nombre} ({e.codigo}): {e.motivo}. {formatCurrency(e.monto)}</li>)}</ul>
            </details>
          )}
          {resumen.avisos.map((a) => <p key={a} className="text-xs text-amber-800">{a}</p>)}
          {resumen.errores.map((a) => <p key={a} className="text-xs text-red-700">{a}</p>)}
          <a className={`btn btn-primary ${resumen.errores.length || !resumen.incluidos ? "pointer-events-none opacity-50" : ""}`} href={url("")} aria-disabled={resumen.errores.length > 0 || !resumen.incluidos}>
            Descargar archivo
          </a>
        </>
      )}
    </div>
  );
}
