"use client";

/**
 * Elegir qué filas exportar (empleados, deducciones). Parte sin nada marcado:
 * exportar datos personales o salariales debe ser un acto deliberado, y sin marcar
 * nada el archivo sale sólo con los encabezados. La marca se conserva al buscar,
 * para poder armar la lista por partes.
 *
 * La API de cada recurso responde `GET ?lista=1` con `{ filas: [{ id, titulo, detalle }] }`
 * y `POST { ids, formato | delimitador }` con el archivo.
 *
 * Deducciones se exporta POR EMPLEADO y para un período: se marcan empleados y el
 * archivo trae una columna por tipo de deducción con lo que se descuenta en ese
 * período (`tipoPlanilla`, `desde` y `hasta` van en la lista y en el POST).
 */

import { useEffect, useMemo, useState } from "react";
import { Campo, Modal } from "@/components/ui/ModalForm";
import SelectorPeriodo, { periodoInicial } from "@/components/payroll/SelectorPeriodo";
import { claveNombre } from "@/lib/organizacion/puestos";
import { frasePeriodo, errorDePeriodo, type TipoPlanillaPeriodo } from "@/lib/payroll/periodos-planilla";
import type { RecursoImportacion } from "@/lib/importacion/tipos";

interface FilaExportable {
  id: string;
  titulo: string;
  detalle: string;
}

interface ConfigExportar {
  titulo: string;
  uno: string;
  varios: string;
  /** Para concordar «marcados/marcadas», «todos/todas». */
  femenino: boolean;
  buscar: string;
  vacio: string;
  avisoPII: string;
  /** Se exporta para un período de planilla: se elige arriba de la lista. */
  conPeriodo?: boolean;
}

const CONFIG: Partial<Record<RecursoImportacion, ConfigExportar>> = {
  empleados: {
    titulo: "Exportar empleados", uno: "empleado", varios: "empleados", femenino: false,
    buscar: "Buscar por nombre, código o departamento",
    vacio: "No hay empleados con los filtros de la pantalla.",
    avisoPII: "El archivo incluirá identidad, salario y cuenta bancaria. La descarga queda registrada en la auditoría.",
  },
  deducciones: {
    titulo: "Exportar deducciones por empleado", uno: "empleado", varios: "empleados", femenino: false,
    buscar: "Buscar por nombre, código, departamento o sucursal",
    vacio: "No hay empleados activos con este tipo de planilla en su alcance.",
    avisoPII: "Una fila por empleado y una columna por tipo de deducción, con lo que se descuenta en el período. Se puede corregir y volver a importar. La descarga queda registrada en la auditoría.",
    conPeriodo: true,
  },
};

export function exportaConSeleccion(recurso: RecursoImportacion): boolean {
  return recurso in CONFIG;
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function ExportarSeleccion({ recurso, filtros, incluyePII, tipoPlanilla, onCerrar }: {
  recurso: RecursoImportacion;
  /** Los de la pantalla: sólo se ofrece lo que se está viendo. */
  filtros?: Record<string, string | undefined>;
  incluyePII?: boolean;
  /** Tipo de planilla con que arranca el selector de período (deducciones). */
  tipoPlanilla?: TipoPlanillaPeriodo;
  onCerrar: () => void;
}) {
  const c = CONFIG[recurso]!;
  const marcadasTxt = c.femenino ? "marcadas" : "marcados";
  const todos = c.femenino ? "todas" : "todos";
  const [filas, setFilas] = useState<Array<FilaExportable & { clave: string }> | null>(null);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [formato, setFormato] = useState("xlsx");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(() => periodoInicial(tipoPlanilla));
  const errorPeriodo = c.conPeriodo ? errorDePeriodo(periodo) : null;

  const q = new URLSearchParams({ lista: "1" });
  for (const [k, v] of Object.entries(filtros ?? {})) if (v) q.set(k, v);
  if (c.conPeriodo) q.set("tipoPlanilla", periodo.tipo);
  const consulta = q.toString();

  function cambiarPeriodo(p: typeof periodo) {
    // Otro tipo de planilla es otra lista de empleados: lo marcado ya no aplica.
    if (p.tipo !== periodo.tipo) { setFilas(null); setMarcadas(new Set()); }
    setPeriodo(p);
  }

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/exportar/${recurso}?${consulta}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error ?? `No se pudo cargar la lista de ${c.varios}.`);
        setFilas((d.filas as FilaExportable[]).map((f) => ({ ...f, clave: claveNombre(`${f.titulo} ${f.detalle}`) })));
      } catch (e) {
        if (vivo) { setFilas([]); setError(e instanceof Error ? e.message : `No se pudo cargar la lista de ${c.varios}.`); }
      }
    })();
    return () => { vivo = false; };
  }, [consulta, recurso, c.varios]);

  const visibles = useMemo(() => {
    const palabras = claveNombre(busqueda).split(" ").filter(Boolean);
    return (filas ?? []).filter((f) => palabras.every((p) => f.clave.includes(p)));
  }, [filas, busqueda]);

  const todasVisibles = visibles.length > 0 && visibles.every((f) => marcadas.has(f.id));
  const n = marcadas.size;

  function alternarVisibles() {
    const nuevo = new Set(marcadas);
    for (const f of visibles) {
      if (todasVisibles) nuevo.delete(f.id);
      else nuevo.add(f.id);
    }
    setMarcadas(nuevo);
  }

  function alternar(id: string) {
    const nuevo = new Set(marcadas);
    if (!nuevo.delete(id)) nuevo.add(id);
    setMarcadas(nuevo);
  }

  async function exportar() {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/exportar/${recurso}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [...marcadas],
          ...(formato === "xlsx" ? { formato } : { delimitador: formato }),
          ...(c.conPeriodo ? { tipoPlanilla: periodo.tipo, desde: periodo.desde, hasta: periodo.hasta } : {}),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo generar el archivo. Intente de nuevo.");
      }
      const nombre = /filename="?([^";]+)/i.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `${recurso}.csv`;
      const enlace = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = enlace;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(enlace);
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el archivo. Intente de nuevo.");
      setCargando(false);
    }
  }

  const idGrupo = `exportar-${recurso}`;
  return (
    <Modal titulo={c.titulo} error={error ?? errorPeriodo} cargando={cargando} puedeGuardar={filas !== null && !errorPeriodo} onCerrar={onCerrar} onGuardar={() => void exportar()}
      textoGuardar={n === 0 ? "Descargar sólo encabezados" : n === 1 ? `Exportar 1 ${c.uno}` : `Exportar ${n} ${c.varios}`}>
      {c.conPeriodo && (
        <div className="space-y-1" data-periodo={`${periodo.desde}|${periodo.hasta}`}>
          <SelectorPeriodo id={`exportar-${recurso}-periodo`} valor={periodo} onCambio={cambiarPeriodo} />
          {!errorPeriodo && <p className="text-xs text-gray-500">Montos que se descuentan {frasePeriodo(periodo, "en")}.</p>}
        </div>
      )}
      <input className="input" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={c.buscar} aria-label={c.buscar} />

      <div role="group" aria-labelledby={idGrupo} className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <span id={idGrupo} className="text-sm font-medium text-gray-800">
            {mayuscula(c.varios)}{filas ? ` (${n} de ${filas.length} ${marcadasTxt})` : ""}
          </span>
          {visibles.length > 0 && (
            <button type="button" className="-my-1 py-1 text-sm font-medium text-blue-700 hover:underline" onClick={alternarVisibles}>
              {todasVisibles ? `Quitar ${todos}` : `Marcar ${todos}`}
            </button>
          )}
        </div>
        <div className="mt-1 h-56 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-300">
          {filas === null && <p className="px-3 py-3 text-sm text-gray-500">Cargando {c.varios}…</p>}
          {filas !== null && visibles.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">{filas.length ? "Nada coincide con la búsqueda." : c.vacio}</p>}
          {visibles.map((f) => (
            <label key={f.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50">
              <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" checked={marcadas.has(f.id)} onChange={() => alternar(f.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{f.titulo}</span>
                <span className="block truncate text-xs text-gray-500">{f.detalle}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <Campo etiqueta="Formato">
        <select className="input" value={formato} onChange={(e) => setFormato(e.target.value)}>
          <option value="xlsx">{n === 0 ? "Plantilla de Excel (.xlsx)" : "Excel (.xlsx)"}</option>
          <option value=",">CSV separado por comas</option>
          <option value=";">CSV separado por punto y coma</option>
        </select>
      </Campo>

      {n === 0
        ? <p className="text-xs text-gray-500">Sin marcar nada, el archivo sale vacío, sólo con los encabezados.</p>
        : incluyePII && <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">{c.avisoPII}</p>}
    </Modal>
  );
}
