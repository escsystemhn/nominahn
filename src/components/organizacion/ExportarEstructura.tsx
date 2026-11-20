"use client";

/**
 * «Exportar estructura»: la organización por grupos y sucursales en Excel o PDF, con el
 * detalle que se elija. Está en Empleados y en Jerarquía de nómina; el archivo lo arma
 * `GET /api/exportar/estructura`.
 */

import { useState } from "react";

interface Grupo { id: string; nombre: string }
interface Division { id: string; nombre: string; sucursalId: string }

const DETALLES = [
  { valor: "departamentos", titulo: "Departamentos", texto: "Cada nivel con sus departamentos y cuántos puestos y empleados tiene." },
  { valor: "puestos", titulo: "Puestos", texto: "Además, los puestos de cada departamento y cuántas personas hay en cada uno." },
  { valor: "empleados", titulo: "Empleados", texto: "Además, la lista de empleados de cada departamento, con su puesto y su ingreso." },
] as const;

export default function ExportarEstructura({
  grupos,
  divisiones,
  etiquetas,
  inicial,
}: {
  grupos: Grupo[];
  /** Vacío si el nivel División está apagado. */
  divisiones: Division[];
  etiquetas: { sucursal: string; todasSucursales: string; division: string; todasDivisiones: string; sucursales: string; divisiones: string };
  /** Los filtros de la pantalla, para arrancar con lo que se está viendo. */
  inicial?: { sucursalId?: string; divisionId?: string };
}) {
  const [abierto, setAbierto] = useState(false);
  const [sucursalId, setSucursalId] = useState(inicial?.sucursalId ?? "");
  const [divisionId, setDivisionId] = useState(inicial?.divisionId ?? "");
  const [detalle, setDetalle] = useState<(typeof DETALLES)[number]["valor"]>("departamentos");
  const [inactivos, setInactivos] = useState(false);
  const [formato, setFormato] = useState<"xlsx" | "pdf">("xlsx");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const divisionesDelGrupo = divisiones.filter((v) => !sucursalId || v.sucursalId === sucursalId);
  const nombreGrupo = (id: string) => grupos.find((g) => g.id === id)?.nombre ?? "";

  function abrir() {
    // Cada vez que se abre, arranca con lo que la pantalla tiene filtrado.
    setSucursalId(inicial?.sucursalId ?? "");
    setDivisionId(inicial?.divisionId ?? "");
    setError(null);
    setAbierto(true);
  }

  async function descargar() {
    setCargando(true);
    setError(null);
    try {
      const q = new URLSearchParams({ detalle, formato });
      if (sucursalId) q.set("sucursalId", sucursalId);
      if (divisionId) q.set("divisionId", divisionId);
      if (inactivos) q.set("inactivos", "1");
      const r = await fetch(`/api/exportar/estructura?${q}`);
      if (!r.ok) {
        const cuerpo = await r.json().catch(() => null);
        setError(cuerpo?.error ?? "No se pudo generar el archivo. Intente de nuevo.");
        return;
      }
      const nombre = /filename="?([^";]+)/i.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `estructura.${formato}`;
      const enlace = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = enlace;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(enlace), 1000);
      setAbierto(false);
    } catch {
      setError("No se pudo conectar con el servidor. Intente de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={abrir} data-exportar-estructura>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
          <rect x="7.5" y="2.5" width="5" height="4" rx="1" />
          <rect x="2.5" y="13.5" width="5" height="4" rx="1" />
          <rect x="12.5" y="13.5" width="5" height="4" rx="1" />
          <path d="M10 6.5v3.5M5 13.5V10h10v3.5" />
        </svg>
        Exportar estructura
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Exportar estructura"
          onKeyDown={(e) => { if (e.key === "Escape" && !cargando) setAbierto(false); }}>
          <div className="panel max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 shadow-xl">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Exportar estructura</h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {etiquetas.sucursales}{divisiones.length > 0 ? `, ${etiquetas.divisiones.toLowerCase()}` : ""} y departamentos, con sus totales. Con más de
                un {etiquetas.sucursal.toLowerCase()}, el Excel trae un resumen y una pestaña por cada uno.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-800">{etiquetas.sucursal}</span>
                <select className="input mt-1 w-full" value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setDivisionId(""); }}>
                  <option value="">{etiquetas.todasSucursales}</option>
                  {grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
                </select>
              </label>
              {divisiones.length > 0 && (
                <label className="block text-sm">
                  <span className="font-medium text-gray-800">{etiquetas.division}</span>
                  <select className="input mt-1 w-full" value={divisionId} onChange={(e) => setDivisionId(e.target.value)} disabled={divisionesDelGrupo.length === 0}>
                    <option value="">{etiquetas.todasDivisiones}</option>
                    {divisionesDelGrupo.map((v) => (
                      <option key={v.id} value={v.id}>{sucursalId ? v.nombre : `${v.nombre} (${nombreGrupo(v.sucursalId)})`}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-gray-800">Detalle</legend>
              <div className="mt-1.5 space-y-2">
                {DETALLES.map((d) => (
                  <label key={d.valor} className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm ${detalle === d.valor ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}>
                    <input type="radio" name="detalle-estructura" className="mt-0.5" checked={detalle === d.valor} onChange={() => setDetalle(d.valor)} />
                    <span>
                      <span className="block font-medium text-gray-900">{d.titulo}</span>
                      <span className="block text-xs text-gray-500">{d.texto}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} />
              Contar también a los dados de baja
            </label>

            <fieldset className="flex flex-wrap items-center gap-4 text-sm">
              <legend className="sr-only">Formato</legend>
              <span className="font-medium text-gray-800">Formato</span>
              <label className="flex items-center gap-1.5"><input type="radio" name="formato-estructura" checked={formato === "xlsx"} onChange={() => setFormato("xlsx")} /> Excel</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="formato-estructura" checked={formato === "pdf"} onChange={() => setFormato("pdf")} /> PDF</label>
            </fieldset>

            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost" onClick={() => setAbierto(false)} disabled={cargando}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={descargar} disabled={cargando}>{cargando ? "Generando…" : "Descargar"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
