"use client";

/**
 * Documentos: constancias, contratos y cartas desde plantilla.
 *
 * Emitir resuelve el texto con los datos del expediente y lo congela con un
 * folio. Lo que falta en el expediente se ve resaltado en la vista previa antes
 * de emitir, para completarlo o llenarlo a mano en el papel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/utils";
import { etiquetaVariable, type VariableDoc } from "@/lib/documentos/plantillas";
import TextoDocumento from "./TextoDocumento";

interface Empleado { id: string; codigo: string; nombre: string; activo: boolean }

interface Plantilla {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "CONSTANCIA_TRABAJO" | "CONSTANCIA_SALARIO" | "CONTRATO" | "CARTA" | "OTRO";
  titulo: string;
  contenido: string;
  autoservicio: boolean;
  esSistema: boolean;
  activo: boolean;
  updatedAt: string;
}

interface Firmante { nombre: string; cargo: string; identidad: string; ciudad: string }

interface Emitido {
  id: string;
  folio: string;
  titulo: string;
  destinatario: string | null;
  porAutoservicio: boolean;
  anulado: boolean;
  createdAt: string;
  emitidoPor: string | null;
  plantilla: { nombre: string; tipo: string };
  empleado: { id: string; codigo: string; primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null };
}

interface Vista { titulo: string; texto: string; faltantes: string[]; desconocidas: string[] }

type Tab = "emitir" | "historial" | "plantillas";

const TIPOS: { v: Plantilla["tipo"]; l: string }[] = [
  { v: "CONSTANCIA_TRABAJO", l: "Constancia de trabajo" },
  { v: "CONSTANCIA_SALARIO", l: "Constancia de salario" },
  { v: "CONTRATO", l: "Contrato" },
  { v: "CARTA", l: "Carta" },
  { v: "OTRO", l: "Otro" },
];

const nombreEmp = (e: Emitido["empleado"]) => [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");

interface Props {
  empleados: Empleado[];
  puedeEmitir: boolean;
  puedePlantillas: boolean;
  empleadoInicial: string;
  tabInicial?: Tab;
}

export default function DocumentosClient({ empleados, puedeEmitir, puedePlantillas, empleadoInicial, tabInicial }: Props) {
  const [tab, setTab] = useState<Tab>(tabInicial ?? (puedeEmitir ? "emitir" : "plantillas"));
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [variables, setVariables] = useState<{ grupo: string; variables: VariableDoc[] }[]>([]);
  const [firmante, setFirmante] = useState<Firmante>({ nombre: "", cargo: "", identidad: "", ciudad: "" });
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargarPlantillas = useCallback(async () => {
    const res = await fetch("/api/documentos/plantillas", { cache: "no-store" });
    if (!res.ok) return;
    const d = await res.json();
    setPlantillas(d.plantillas);
    setVariables(d.variables);
    setFirmante(d.firmante);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargarPlantillas(), 0);
    return () => clearTimeout(t);
  }, [cargarPlantillas]);

  const tabs: [Tab, string][] = [
    ...(puedeEmitir ? ([["emitir", "Emitir"], ["historial", "Historial"]] as [Tab, string][]) : []),
    ...(puedePlantillas ? ([["plantillas", "Plantillas y firmante"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentos"
        description="Constancias de trabajo y salario, contratos y cartas con los datos del expediente. Cada documento emitido lleva folio y se puede volver a descargar idéntico."
      >
        <nav className="-mb-5 flex gap-1" aria-label="Secciones de documentos">
          {tabs.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => { setTab(k); setAviso(null); }}
              aria-current={tab === k ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${tab === k ? "border-blue-500 font-medium text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            >
              {l}
            </button>
          ))}
        </nav>
      </PageHeader>

      {aviso && (
        <div role="status" className={`rounded-md border px-3 py-2 text-sm ${aviso.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {aviso.texto}
        </div>
      )}

      {tab === "emitir" && puedeEmitir && (
        <Emitir empleados={empleados} plantillas={plantillas.filter((p) => p.activo)} empleadoInicial={empleadoInicial} firmanteVacio={!firmante.nombre} onAviso={setAviso} />
      )}
      {tab === "historial" && puedeEmitir && <Historial onAviso={setAviso} />}
      {tab === "plantillas" && puedePlantillas && (
        <Plantillas
          plantillas={plantillas}
          variables={variables}
          firmante={firmante}
          empleados={empleados}
          onCambio={cargarPlantillas}
          onAviso={setAviso}
        />
      )}
    </div>
  );
}

// ─── Emitir ───────────────────────────────────────────────────────────────────

function Emitir({
  empleados, plantillas, empleadoInicial, firmanteVacio, onAviso,
}: {
  empleados: Empleado[];
  plantillas: Plantilla[];
  empleadoInicial: string;
  firmanteVacio: boolean;
  onAviso: (a: { ok: boolean; texto: string } | null) => void;
}) {
  const [empleadoId, setEmpleadoId] = useState(empleadoInicial);
  const [plantillaId, setPlantillaId] = useState("");
  const [destinatario, setDestinatario] = useState("");
  const [vista, setVista] = useState<Vista | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const plantillaSel = plantillaId || plantillas[0]?.id || "";

  async function previsualizar() {
    if (!empleadoId || !plantillaSel) return;
    setOcupado(true);
    onAviso(null);
    try {
      const res = await fetch("/api/documentos/vista-previa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId, plantillaId: plantillaSel, destinatario: destinatario || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo preparar la vista previa");
      setVista(d);
    } catch (e) {
      onAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setOcupado(false);
    }
  }

  async function emitir() {
    setOcupado(true);
    try {
      const res = await fetch("/api/documentos/emitidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId, plantillaId: plantillaSel, destinatario: destinatario || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo emitir");
      onAviso({ ok: true, texto: `Documento emitido con el folio ${d.folio}.` });
      window.open(`/api/documentos/emitidos/${d.id}/pdf?modo=ver`, "_blank", "noopener");
      setVista(null);
    } catch (e) {
      onAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <section className="panel h-fit space-y-4 p-5" aria-label="Datos del documento">
        {firmanteVacio && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Falta el firmante por el patrono. Configúrelo en «Plantillas y firmante» para que aparezca en los documentos.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="doc-emp">Empleado</label>
          <select id="doc-emp" className="input" value={empleadoId} onChange={(e) => { setEmpleadoId(e.target.value); setVista(null); }}>
            <option value="">Elegir</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre} ({e.codigo}){e.activo ? "" : ", inactivo"}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="doc-pl">Documento</label>
          <select id="doc-pl" className="input" value={plantillaSel} onChange={(e) => { setPlantillaId(e.target.value); setVista(null); }}>
            {plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="doc-dest">Dirigido a</label>
          <input id="doc-dest" className="input" placeholder="A quien interese" value={destinatario} onChange={(e) => { setDestinatario(e.target.value); setVista(null); }} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void previsualizar()} disabled={!empleadoId || !plantillaSel || ocupado}>
            Vista previa
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void emitir()} disabled={!vista || ocupado || vista.desconocidas.length > 0}>
            {ocupado && vista ? "Emitiendo…" : "Emitir y descargar"}
          </button>
        </div>
        <p className="text-[11px] text-gray-500">Revise la vista previa antes de emitir: lo emitido queda con folio en el historial.</p>
      </section>

      <section aria-label="Vista previa">
        {!vista ? (
          <div className="flex h-full min-h-48 items-center justify-center rounded-md border border-dashed border-gray-300 p-6 text-sm text-gray-500">
            Elija empleado y documento, y pulse «Vista previa».
          </div>
        ) : (
          <div className="space-y-3">
            {vista.faltantes.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                El expediente no tiene: {vista.faltantes.map(etiquetaVariable).join(", ")}. Quedan como línea para llenar a mano, o complete el expediente y vuelva a generar la vista previa.
              </p>
            )}
            {vista.desconocidas.length > 0 && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                La plantilla usa variables que no existen: {vista.desconocidas.join(", ")}. Corríjala antes de emitir.
              </p>
            )}
            <TextoDocumento titulo={vista.titulo} texto={vista.texto} />
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Historial ────────────────────────────────────────────────────────────────

function Historial({ onAviso }: { onAviso: (a: { ok: boolean; texto: string } | null) => void }) {
  const [emitidos, setEmitidos] = useState<Emitido[] | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/documentos/emitidos", { cache: "no-store" });
    setEmitidos(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  async function anular(e: Emitido) {
    if (!confirm(`¿Anular el documento ${e.folio}? Conserva su folio y saldrá con la marca «ANULADO».`)) return;
    const res = await fetch(`/api/documentos/emitidos/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anulado: true }) });
    const d = await res.json();
    onAviso(res.ok ? { ok: true, texto: `Documento ${e.folio} anulado.` } : { ok: false, texto: d.error ?? "No se pudo anular" });
    await cargar();
  }

  if (emitidos === null) return <p className="text-sm text-gray-400">Cargando…</p>;
  return (
    <section className="panel overflow-hidden" aria-label="Documentos emitidos">
      {emitidos.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">Todavía no se ha emitido ningún documento.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base text-sm">
            <thead>
              <tr>
                <th className="px-4">Folio</th>
                <th className="px-4">Fecha</th>
                <th className="px-4">Empleado</th>
                <th className="px-4">Documento</th>
                <th className="px-4">Dirigido a</th>
                <th className="px-4">Origen</th>
                <th className="px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {emitidos.map((e) => (
                <tr key={e.id} className={e.anulado ? "text-gray-400" : ""}>
                  <td className="px-4 py-2.5 font-mono">{e.folio}{e.anulado && <span className="ml-2 text-xs text-red-700">anulado</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(e.createdAt)}</td>
                  <td className="px-4 py-2.5">{nombreEmp(e.empleado)}<span className="block text-xs text-gray-500">{e.empleado.codigo}</span></td>
                  <td className="px-4 py-2.5">{e.plantilla.nombre}</td>
                  <td className="px-4 py-2.5">{e.destinatario ?? "A quien interese"}</td>
                  <td className="px-4 py-2.5 text-xs">{e.porAutoservicio ? "Mi espacio" : e.emitidoPor ?? "RRHH"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <a className="btn btn-ghost btn-sm" href={`/api/documentos/emitidos/${e.id}/pdf?modo=ver`} target="_blank" rel="noopener noreferrer">PDF</a>
                      {!e.anulado && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => void anular(e)}>Anular</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Plantillas y firmante ────────────────────────────────────────────────────

const plantillaNueva = (): Omit<Plantilla, "id" | "codigo" | "esSistema" | "updatedAt"> => ({
  nombre: "", titulo: "", tipo: "CARTA", contenido: "", autoservicio: false, activo: true,
});

function Plantillas({
  plantillas, variables, firmante, empleados, onCambio, onAviso,
}: {
  plantillas: Plantilla[];
  variables: { grupo: string; variables: VariableDoc[] }[];
  firmante: Firmante;
  empleados: Empleado[];
  onCambio: () => Promise<void>;
  onAviso: (a: { ok: boolean; texto: string } | null) => void;
}) {
  const [selId, setSelId] = useState<string | "nueva">(plantillas[0]?.id ?? "nueva");
  const sel = plantillas.find((p) => p.id === selId) ?? null;
  const [edicion, setEdicion] = useState(sel ? { ...sel } : { ...plantillaNueva(), id: "", codigo: "", esSistema: false, updatedAt: "" });
  const [empPrueba, setEmpPrueba] = useState(empleados.find((e) => e.activo)?.id ?? "");
  const [vista, setVista] = useState<Vista | null>(null);
  const [fForm, setFForm] = useState(firmante);
  const [guardando, setGuardando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setFForm(firmante), 0);
    return () => clearTimeout(t);
  }, [firmante]);

  function elegir(id: string | "nueva") {
    setSelId(id);
    setVista(null);
    const p = plantillas.find((x) => x.id === id);
    setEdicion(p ? { ...p } : { ...plantillaNueva(), id: "", codigo: "", esSistema: false, updatedAt: "" });
  }

  function insertar(clave: string) {
    const area = areaRef.current;
    const token = `{{${clave}}}`;
    if (!area) {
      setEdicion((e) => ({ ...e, contenido: e.contenido + token }));
      return;
    }
    const ini = area.selectionStart ?? edicion.contenido.length;
    const fin = area.selectionEnd ?? ini;
    const nuevo = edicion.contenido.slice(0, ini) + token + edicion.contenido.slice(fin);
    setEdicion((e) => ({ ...e, contenido: nuevo }));
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(ini + token.length, ini + token.length);
    });
  }

  async function probar() {
    if (!empPrueba) return;
    const res = await fetch("/api/documentos/vista-previa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId: empPrueba, contenido: edicion.contenido, titulo: edicion.titulo }),
    });
    const d = await res.json();
    if (!res.ok) onAviso({ ok: false, texto: d.error ?? "No se pudo probar" });
    else setVista(d);
  }

  async function guardar() {
    setGuardando(true);
    onAviso(null);
    try {
      const cuerpo = { nombre: edicion.nombre, titulo: edicion.titulo, tipo: edicion.tipo, contenido: edicion.contenido, autoservicio: edicion.autoservicio, activo: edicion.activo };
      const res = await fetch(selId === "nueva" ? "/api/documentos/plantillas" : `/api/documentos/plantillas/${selId}`, {
        method: selId === "nueva" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const d = await res.json();
      if (!res.ok) {
        const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
        throw new Error([d.error ?? "No se pudo guardar", ...campos].join(" "));
      }
      onAviso({ ok: true, texto: "Plantilla guardada." });
      await onCambio();
      if (selId === "nueva") setSelId(d.id);
    } catch (e) {
      onAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!sel || !confirm(`¿Borrar la plantilla «${sel.nombre}»?`)) return;
    const res = await fetch(`/api/documentos/plantillas/${sel.id}`, { method: "DELETE" });
    const d = await res.json();
    onAviso(res.ok ? { ok: true, texto: "Plantilla borrada." } : { ok: false, texto: d.error ?? "No se pudo borrar" });
    if (res.ok) {
      await onCambio();
      elegir("nueva");
    }
  }

  async function guardarFirmante() {
    const res = await fetch("/api/documentos/firmante", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fForm) });
    const d = await res.json();
    onAviso(res.ok ? { ok: true, texto: "Firmante guardado." } : { ok: false, texto: d.error ?? "No se pudo guardar" });
    if (res.ok) await onCambio();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav className="panel h-fit p-2" aria-label="Plantillas">
          <ul className="space-y-0.5">
            {plantillas.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => elegir(p.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${selId === p.id ? "bg-blue-50 font-medium text-blue-900" : "text-gray-700 hover:bg-gray-50"}`}
                >
                  {p.nombre}
                  <span className="block text-[11px] text-gray-500">
                    {[p.autoservicio ? "En Mi espacio" : null, p.activo ? null : "Desactivada", p.esSistema ? "Del sistema" : null].filter(Boolean).join(". ") || "Propia"}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => elegir("nueva")} className={`w-full rounded-md px-3 py-2 text-left text-sm ${selId === "nueva" ? "bg-blue-50 font-medium text-blue-900" : "text-blue-700 hover:bg-gray-50"}`}>
                Nueva plantilla
              </button>
            </li>
          </ul>
        </nav>

        <section className="panel space-y-4 p-5" aria-label="Editor de plantilla">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pl-nombre">Nombre</label>
              <input id="pl-nombre" className="input" value={edicion.nombre} onChange={(e) => setEdicion((x) => ({ ...x, nombre: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pl-titulo">Título impreso</label>
              <input id="pl-titulo" className="input" value={edicion.titulo} onChange={(e) => setEdicion((x) => ({ ...x, titulo: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pl-tipo">Tipo</label>
              <select id="pl-tipo" className="input" value={edicion.tipo} disabled={edicion.esSistema} onChange={(e) => setEdicion((x) => ({ ...x, tipo: e.target.value as Plantilla["tipo"] }))}>
                {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-500">El contrato lleva firma del patrono y del trabajador; los demás, sólo del patrono.</p>
            </div>
            <div className="flex flex-col justify-center gap-2 text-sm text-gray-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.autoservicio} onChange={(e) => setEdicion((x) => ({ ...x, autoservicio: e.target.checked }))} />El empleado puede emitirla en Mi espacio</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.activo} onChange={(e) => setEdicion((x) => ({ ...x, activo: e.target.checked }))} />Activa</label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pl-contenido">Texto</label>
            <textarea id="pl-contenido" ref={areaRef} className="input min-h-72 font-[inherit] leading-relaxed" value={edicion.contenido} onChange={(e) => setEdicion((x) => ({ ...x, contenido: e.target.value }))} />
            <p className="mt-1 text-[11px] text-gray-500">Separe los párrafos con una línea en blanco. Escriba **así** para negrita. Pulse una variable para insertarla donde está el cursor.</p>
          </div>

          <div className="space-y-2">
            {variables.map((g) => (
              <div key={g.grupo}>
                <p className="text-[11px] font-medium text-gray-500">{g.grupo}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.variables.map((v) => (
                    <button key={v.clave} type="button" onClick={() => insertar(v.clave)} title={`{{${v.clave}}}`} className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 hover:border-blue-300 hover:bg-blue-50">
                      {v.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-gray-100 pt-4">
            <div className="flex items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pl-prueba">Probar con</label>
                <select id="pl-prueba" className="input" value={empPrueba} onChange={(e) => setEmpPrueba(e.target.value)}>
                  {empleados.filter((e) => e.activo).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => void probar()} disabled={!empPrueba || !edicion.contenido.trim()}>Vista previa</button>
            </div>
            <div className="flex gap-2">
              {sel && !sel.esSistema && <button type="button" className="btn btn-ghost text-red-700" onClick={() => void borrar()}>Borrar</button>}
              <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? "Guardando…" : "Guardar plantilla"}</button>
            </div>
          </div>

          {vista && (
            <div className="space-y-2">
              {vista.desconocidas.length > 0 && <p className="text-sm text-red-700">Variables que no existen: {vista.desconocidas.join(", ")}</p>}
              {vista.faltantes.length > 0 && <p className="text-sm text-amber-800">Sin dato para este empleado: {vista.faltantes.map(etiquetaVariable).join(", ")}</p>}
              <TextoDocumento titulo={vista.titulo} texto={vista.texto} />
            </div>
          )}
        </section>
      </div>

      <section className="panel space-y-4 p-5" aria-labelledby="firmante-titulo">
        <div>
          <h2 id="firmante-titulo" className="text-sm font-medium text-gray-900">Firmante por el patrono</h2>
          <p className="mt-1 text-xs text-gray-500">Aparece en la firma de constancias, contratos y finiquitos. La ciudad se usa en el cierre de los documentos.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="f-nombre">Nombre</label><input id="f-nombre" className="input" value={fForm.nombre} onChange={(e) => setFForm((f) => ({ ...f, nombre: e.target.value }))} /></div>
          <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="f-cargo">Cargo</label><input id="f-cargo" className="input" value={fForm.cargo} onChange={(e) => setFForm((f) => ({ ...f, cargo: e.target.value }))} /></div>
          <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="f-identidad">Identidad</label><input id="f-identidad" className="input" value={fForm.identidad} onChange={(e) => setFForm((f) => ({ ...f, identidad: e.target.value }))} /></div>
          <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="f-ciudad">Ciudad</label><input id="f-ciudad" className="input" value={fForm.ciudad} onChange={(e) => setFForm((f) => ({ ...f, ciudad: e.target.value }))} /></div>
        </div>
        <div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={() => void guardarFirmante()}>Guardar firmante</button></div>
      </section>
    </div>
  );
}
