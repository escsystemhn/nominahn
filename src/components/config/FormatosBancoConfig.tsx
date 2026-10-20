"use client";

/**
 * Configuración → Formatos de banco. Cada banco entrega su formato de archivo
 * de planilla; aquí se describe una vez (columnas, separador o ancho fijo,
 * relleno, formato del monto y de la fecha) y la planilla lo usa al pagar.
 */

import { useCallback, useEffect, useState } from "react";
import { CAMPOS_BANCO, type CampoBanco, type ColumnaBanco } from "@/lib/payroll/archivo-banco";

interface Formato {
  id: string;
  nombre: string;
  filtroBanco: string | null;
  tipo: "DELIMITADO" | "ANCHO_FIJO";
  delimitador: string;
  encabezado: boolean;
  columnas: ColumnaBanco[];
  extension: string;
  codificacion: "utf8" | "latin1";
  finLinea: "CRLF" | "LF";
  lineaTotal: boolean;
  esSistema: boolean;
  activo: boolean;
}

type Edicion = Omit<Formato, "id" | "esSistema"> & { id?: string; esSistema?: boolean };

const FORMATOS_VALOR: Partial<Record<CampoBanco, { v: string; l: string }[]>> = {
  monto: [{ v: "DECIMAL", l: "1234.50" }, { v: "DECIMAL_COMA", l: "1234,50" }, { v: "CENTAVOS", l: "123450 (sin punto)" }],
  fechaPago: [{ v: "AAAAMMDD", l: "20261015" }, { v: "DDMMAAAA", l: "15102026" }, { v: "DD/MM/AAAA", l: "15/10/2026" }, { v: "AAAA-MM-DD", l: "2026-10-15" }],
  nombre: [{ v: "", l: "Como está" }, { v: "MAYUSCULAS", l: "MAYÚSCULAS" }, { v: "MAYUSCULAS_SIN_ACENTOS", l: "MAYÚSCULAS SIN ACENTOS" }],
  banco: [{ v: "", l: "Como está" }, { v: "MAYUSCULAS", l: "MAYÚSCULAS" }, { v: "MAYUSCULAS_SIN_ACENTOS", l: "MAYÚSCULAS SIN ACENTOS" }],
  referencia: [{ v: "", l: "Como está" }, { v: "MAYUSCULAS_SIN_ACENTOS", l: "MAYÚSCULAS SIN ACENTOS" }],
  concepto: [{ v: "", l: "Como está" }, { v: "MAYUSCULAS_SIN_ACENTOS", l: "MAYÚSCULAS SIN ACENTOS" }],
};

const NOMBRE_CAMPO = Object.fromEntries(CAMPOS_BANCO.map((c) => [c.v, c.l])) as Record<CampoBanco, string>;

const nuevo = (): Edicion => ({
  nombre: "", filtroBanco: "", tipo: "DELIMITADO", delimitador: ",", encabezado: true, extension: "csv", codificacion: "utf8", finLinea: "CRLF", lineaTotal: false, activo: true,
  columnas: [{ campo: "cuenta", titulo: "Cuenta" }, { campo: "nombre", titulo: "Nombre" }, { campo: "monto", titulo: "Monto", formato: "DECIMAL" }],
});

export default function FormatosBancoConfig() {
  const [formatos, setFormatos] = useState<Formato[] | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [vista, setVista] = useState<{ contenido: string; errores: string[]; avisos: string[] } | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/formatos-banco", { cache: "no-store" });
    if (r.ok) setFormatos((await r.json()).formatos);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const cuerpo = (e: Edicion) => ({
    nombre: e.nombre, filtroBanco: e.filtroBanco || null, tipo: e.tipo, delimitador: e.delimitador, encabezado: e.encabezado,
    columnas: e.columnas.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== "" && v !== undefined && v !== null))),
    extension: e.extension, codificacion: e.codificacion, finLinea: e.finLinea, lineaTotal: e.lineaTotal, activo: e.activo,
  });

  async function previsualizar() {
    if (!edicion) return;
    const r = await fetch("/api/formatos-banco/vista-previa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo(edicion)) });
    const d = await r.json();
    if (!r.ok) {
      const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
      setVista({ contenido: "", errores: [[d.error ?? "Formato inválido", ...campos].join(" ")], avisos: [] });
    } else setVista(d);
  }

  async function guardar() {
    if (!edicion) return;
    const r = await fetch(edicion.id ? `/api/formatos-banco/${edicion.id}` : "/api/formatos-banco", { method: edicion.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo(edicion)) });
    const d = await r.json();
    if (!r.ok) {
      const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
      setAviso({ ok: false, texto: [d.error ?? "No se pudo guardar", ...campos].join(" ") });
      return;
    }
    setAviso({ ok: true, texto: `Formato «${edicion.nombre}» guardado.` });
    setEdicion(null);
    setVista(null);
    await cargar();
  }

  async function borrar(f: Formato) {
    if (!confirm(`¿Borrar el formato «${f.nombre}»?`)) return;
    const r = await fetch(`/api/formatos-banco/${f.id}`, { method: "DELETE" });
    const d = await r.json();
    setAviso(r.ok ? { ok: true, texto: "Formato borrado." } : { ok: false, texto: d.error ?? "No se pudo borrar" });
    await cargar();
  }

  const setCol = (i: number, c: Partial<ColumnaBanco>) => edicion && setEdicion({ ...edicion, columnas: edicion.columnas.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const mover = (i: number, d: -1 | 1) => {
    if (!edicion) return;
    const cols = [...edicion.columnas];
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    setEdicion({ ...edicion, columnas: cols });
  };

  if (!formatos) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">Formatos de archivo para el banco</h2>
          <p className="mt-1 text-sm text-gray-600">
            Pida a cada banco su formato de archivo de planilla y descríbalo aquí una vez. Al pagar una planilla o un décimo se elige el formato y se descarga el archivo listo para subir.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEdicion(nuevo()); setVista(null); }}>Nuevo formato</button>
      </div>
      {aviso && <div className={`rounded-md border px-3 py-2 text-sm ${aviso.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{aviso.texto}</div>}

      <div className="panel overflow-hidden">
        <table className="table-base text-sm">
          <thead><tr><th className="px-4">Formato</th><th className="px-4">Banco</th><th className="px-4">Tipo</th><th className="px-4">Columnas</th><th className="px-4" /></tr></thead>
          <tbody>
            {formatos.map((f) => (
              <tr key={f.id} className={f.activo ? "" : "text-gray-400"}>
                <td className="px-4 py-2.5">{f.nombre}{f.esSistema && <span className="block text-xs text-gray-500">De partida</span>}</td>
                <td className="px-4 py-2.5">{f.filtroBanco || "Todos"}</td>
                <td className="px-4 py-2.5">{f.tipo === "ANCHO_FIJO" ? "Ancho fijo" : `Separado por «${f.delimitador === "\t" || f.delimitador === "\\t" ? "tabulador" : f.delimitador}»`}, .{f.extension}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{f.columnas.map((c) => c.titulo || NOMBRE_CAMPO[c.campo] || c.campo).join(", ")}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEdicion({ ...f, filtroBanco: f.filtroBanco ?? "" }); setVista(null); }}>Editar</button>
                    {!f.esSistema && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => void borrar(f)}>Borrar</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edicion && (
        <section className="panel space-y-4 p-6" aria-labelledby="fb-edicion">
          <h3 id="fb-edicion" className="text-sm font-semibold text-gray-900">{edicion.id ? `Editar «${edicion.nombre}»` : "Nuevo formato"}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-nombre">Nombre</label><input id="fb-nombre" className="input" value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} placeholder="p. ej. BAC planilla" /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-filtro">Sólo empleados cuyo banco contenga</label><input id="fb-filtro" className="input" value={edicion.filtroBanco ?? ""} onChange={(e) => setEdicion({ ...edicion, filtroBanco: e.target.value })} placeholder="Vacío = todos" /></div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-tipo">Tipo</label>
              <select id="fb-tipo" className="input" value={edicion.tipo} onChange={(e) => setEdicion({ ...edicion, tipo: e.target.value as Formato["tipo"], extension: e.target.value === "ANCHO_FIJO" && edicion.extension === "csv" ? "txt" : edicion.extension })}>
                <option value="DELIMITADO">Separado por un carácter</option>
                <option value="ANCHO_FIJO">Ancho fijo</option>
              </select>
            </div>
            {edicion.tipo === "DELIMITADO" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-delim">Separador</label>
                <select id="fb-delim" className="input" value={edicion.delimitador} onChange={(e) => setEdicion({ ...edicion, delimitador: e.target.value })}>
                  <option value=",">Coma</option><option value=";">Punto y coma</option><option value="|">Barra vertical</option><option value="\t">Tabulador</option>
                </select>
              </div>
            )}
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-ext">Extensión</label><input id="fb-ext" className="input" value={edicion.extension} onChange={(e) => setEdicion({ ...edicion, extension: e.target.value.toLowerCase() })} /></div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-cod">Codificación</label>
              <select id="fb-cod" className="input" value={edicion.codificacion} onChange={(e) => setEdicion({ ...edicion, codificacion: e.target.value as Formato["codificacion"] })}>
                <option value="utf8">UTF-8</option><option value="latin1">Latin-1 (Windows)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="fb-fin">Fin de línea</label>
              <select id="fb-fin" className="input" value={edicion.finLinea} onChange={(e) => setEdicion({ ...edicion, finLinea: e.target.value as Formato["finLinea"] })}>
                <option value="CRLF">Windows (CRLF)</option><option value="LF">Unix (LF)</option>
              </select>
            </div>
            <div className="flex flex-col justify-end gap-1 text-sm text-gray-700 sm:col-span-2">
              {edicion.tipo === "DELIMITADO" && <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.encabezado} onChange={(e) => setEdicion({ ...edicion, encabezado: e.target.checked })} />Primera línea con los títulos</label>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.lineaTotal} onChange={(e) => setEdicion({ ...edicion, lineaTotal: e.target.checked })} />Última línea con el total</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.activo} onChange={(e) => setEdicion({ ...edicion, activo: e.target.checked })} />Activo</label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead><tr><th className="px-2">#</th><th className="px-2">Dato</th>{edicion.tipo === "DELIMITADO" && <th className="px-2">Título</th>}{edicion.tipo === "ANCHO_FIJO" && <><th className="px-2">Ancho</th><th className="px-2">Alinear</th><th className="px-2">Relleno</th></>}<th className="px-2">Formato o valor</th><th className="px-2" /></tr></thead>
              <tbody>
                {edicion.columnas.map((c, i) => (
                  <tr key={i}>
                    <td className="px-2 text-gray-500">{i + 1}</td>
                    <td className="px-2 py-1">
                      <select aria-label={`Dato de la columna ${i + 1}`} className="input min-w-[12rem]" value={c.campo} onChange={(e) => setCol(i, { campo: e.target.value as CampoBanco, formato: undefined, valor: e.target.value === "constante" ? "" : undefined })}>
                        {CAMPOS_BANCO.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                      </select>
                    </td>
                    {/* En ancho fijo no hay fila de títulos: el banco lee por posición. */}
                    {edicion.tipo === "DELIMITADO" && <td className="px-2 py-1"><input aria-label={`Título de la columna ${i + 1}`} className="input w-32" value={c.titulo ?? ""} onChange={(e) => setCol(i, { titulo: e.target.value })} /></td>}
                    {edicion.tipo === "ANCHO_FIJO" && (
                      <>
                        <td className="px-2 py-1"><input aria-label={`Ancho de la columna ${i + 1}`} type="number" min={1} className="input w-20" value={c.ancho ?? ""} onChange={(e) => setCol(i, { ancho: Number(e.target.value) || undefined })} /></td>
                        <td className="px-2 py-1"><select aria-label={`Alineación de la columna ${i + 1}`} className="input min-w-[8.5rem]" value={c.alinear ?? ""} onChange={(e) => setCol(i, { alinear: (e.target.value || undefined) as ColumnaBanco["alinear"] })}><option value="">Automática</option><option value="IZQUIERDA">Izquierda</option><option value="DERECHA">Derecha</option></select></td>
                        <td className="px-2 py-1"><select aria-label={`Relleno de la columna ${i + 1}`} className="input min-w-[7.5rem]" value={c.relleno ?? "ESPACIO"} onChange={(e) => setCol(i, { relleno: e.target.value as ColumnaBanco["relleno"] })}><option value="ESPACIO">Espacios</option><option value="CERO">Ceros</option></select></td>
                      </>
                    )}
                    <td className="px-2 py-1">
                      {c.campo === "constante" ? (
                        <input aria-label={`Valor fijo de la columna ${i + 1}`} className="input w-32" value={c.valor ?? ""} onChange={(e) => setCol(i, { valor: e.target.value })} />
                      ) : FORMATOS_VALOR[c.campo] ? (
                        <select aria-label={`Formato de la columna ${i + 1}`} className="input min-w-[14rem]" value={c.formato ?? FORMATOS_VALOR[c.campo]![0].v} onChange={(e) => setCol(i, { formato: e.target.value || undefined })}>
                          {FORMATOS_VALOR[c.campo]!.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                        </select>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      <button type="button" className="px-1 text-gray-500 hover:text-gray-900" onClick={() => mover(i, -1)} aria-label={`Subir la columna ${i + 1}`}>↑</button>
                      <button type="button" className="px-1 text-gray-500 hover:text-gray-900" onClick={() => mover(i, 1)} aria-label={`Bajar la columna ${i + 1}`}>↓</button>
                      <button type="button" className="ml-1 text-xs text-red-700 hover:underline" onClick={() => setEdicion({ ...edicion, columnas: edicion.columnas.filter((_, j) => j !== i) })}>Quitar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ ...edicion, columnas: [...edicion.columnas, { campo: "referencia", titulo: "" }] })}>Agregar columna</button>

          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
            <button type="button" className="btn btn-ghost" onClick={() => { setEdicion(null); setVista(null); }}>Cancelar</button>
            <button type="button" className="btn btn-secondary" onClick={() => void previsualizar()}>Vista previa</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!edicion.nombre.trim()}>Guardar formato</button>
          </div>
          {vista && (
            <div className="space-y-1">
              {vista.errores.map((e) => <p key={e} className="text-sm text-red-700">{e}</p>)}
              {vista.avisos.map((a) => <p key={a} className="text-sm text-amber-800">{a}</p>)}
              {vista.contenido && <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 font-mono text-xs leading-relaxed text-gray-100">{vista.contenido.replace(/\t/g, "→")}</pre>}
              <p className="text-[11px] text-gray-500">Con dos empleados de ejemplo. Compare con el ejemplo que da el banco antes de usarlo.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
