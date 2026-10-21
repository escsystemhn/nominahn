"use client";

/**
 * Horarios rotativos: planes, cobertura mínima por sucursal, preferencias del
 * personal y reglas del planificador.
 *
 * El generador y la validación viven en src/lib/horarios (puros y probados);
 * aquí sólo se capturan los datos y se muestran los planes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { ETIQUETA_ROTACION, ETIQUETA_VISPERA } from "@/lib/horarios/reglas";
import { sumarDias, lunesDe, periodoTexto, NOMBRE_DIA } from "@/lib/horarios/fechas";
import type { ModoVispera, PoliticaRotacion } from "@/lib/horarios/tipos";

type Sucursal = { id: string; nombre: string };
type Pestana = "planes" | "cobertura" | "personal" | "reglas";

const DIAS: [number, string][] = [[1, "L"], [2, "M"], [3, "X"], [4, "J"], [5, "V"], [6, "S"], [7, "D"]];
const hoyHN = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Tegucigalpa" });

function Aviso({ aviso }: { aviso: { ok: boolean; texto: string } | null }) {
  if (!aviso) return null;
  return (
    <p role={aviso.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${aviso.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}>
      {aviso.texto}
    </p>
  );
}

function SelectorDias({ valor, onChange, deshabilitado }: { valor: number[]; onChange: (v: number[]) => void; deshabilitado?: boolean }) {
  return (
    <div className="flex gap-1">
      {DIAS.map(([n, l]) => {
        const activo = valor.includes(n);
        return (
          <button
            key={n}
            type="button"
            title={NOMBRE_DIA[n]}
            disabled={deshabilitado}
            aria-pressed={activo}
            onClick={() => onChange(activo ? valor.filter((x) => x !== n) : [...valor, n].sort())}
            className={`h-7 w-7 rounded text-xs font-medium ${activo ? "bg-blue-700 text-white" : "border border-gray-300 bg-white text-gray-600"} disabled:opacity-60`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

const textoError = async (r: Response) => {
  const d = await r.json().catch(() => ({}));
  const campos = d.detalles ? Object.values(d.detalles as Record<string, string[]>).flat() : [];
  return [d.error ?? "No se pudo guardar", ...campos].join(" ");
};

export default function HorariosClient({ puedeEditar, sucursales }: { puedeEditar: boolean; sucursales: Sucursal[] }) {
  const [pestana, setPestana] = useState<Pestana>("planes");
  const pestanas: [Pestana, string][] = [["planes", "Planes"], ["cobertura", "Cobertura por sucursal"], ["personal", "Disponibilidad del personal"], ["reglas", "Reglas"]];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Horarios rotativos"
        description="Genera el horario de varias sucursales cumpliendo el Código del Trabajo: jornadas, descansos, víspera del descanso, horas extra y cobertura mínima por puesto."
      >
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-gray-200">
          {pestanas.map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={pestana === k} onClick={() => setPestana(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === k ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {l}
            </button>
          ))}
        </div>
      </PageHeader>
      {pestana === "planes" && <Planes puedeEditar={puedeEditar} sucursales={sucursales} />}
      {pestana === "cobertura" && <Cobertura puedeEditar={puedeEditar} sucursales={sucursales} />}
      {pestana === "personal" && <Personal puedeEditar={puedeEditar} sucursales={sucursales} />}
      {pestana === "reglas" && <Reglas puedeEditar={puedeEditar} />}
    </div>
  );
}

// ─── Planes ─────────────────────────────────────────────────────────────────

interface PlanLista {
  id: string; nombre: string; desde: string; hasta: string; estado: string; sucursales: string[];
  resumen: { errores?: number; avisos?: number; faltantes?: number } | null; publicadoAt: string | null;
}

function Planes({ puedeEditar, sucursales }: { puedeEditar: boolean; sucursales: Sucursal[] }) {
  const router = useRouter();
  const [planes, setPlanes] = useState<PlanLista[] | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [generando, setGenerando] = useState(false);
  const lunesProximo = sumarDias(lunesDe(hoyHN()), 7);
  const [form, setForm] = useState({ desde: lunesProximo, hasta: sumarDias(lunesProximo, 6), nombre: "", sucursalesIds: sucursales.map((s) => s.id) });

  const cargar = useCallback(async () => {
    const r = await fetch("/api/horarios/planes", { cache: "no-store" });
    if (r.ok) setPlanes(await r.json());
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const presets = useMemo(() => {
    const hoy = hoyHN();
    const [a, m, d] = hoy.split("-").map(Number);
    const finMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
    const sig = m === 12 ? [a + 1, 1] : [a, m + 1];
    const quincena = d <= 15 ? [`${hoy.slice(0, 8)}16`, finMes(a, m)] : [`${sig[0]}-${String(sig[1]).padStart(2, "0")}-01`, `${sig[0]}-${String(sig[1]).padStart(2, "0")}-15`];
    return [
      { etiqueta: "Próxima semana", desde: lunesProximo, hasta: sumarDias(lunesProximo, 6) },
      { etiqueta: "Próxima quincena", desde: quincena[0], hasta: quincena[1] },
      { etiqueta: "Próximo mes", desde: `${sig[0]}-${String(sig[1]).padStart(2, "0")}-01`, hasta: finMes(sig[0], sig[1]) },
      { etiqueta: "Próximas 4 semanas", desde: lunesProximo, hasta: sumarDias(lunesProximo, 27) },
    ];
  }, [lunesProximo]);

  async function generar() {
    setGenerando(true);
    setAviso(null);
    const r = await fetch("/api/horarios/planes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, nombre: form.nombre.trim() || undefined }),
    });
    setGenerando(false);
    if (!r.ok) {
      setAviso({ ok: false, texto: await textoError(r) });
      return;
    }
    const d = await r.json();
    router.push(`/horarios/${d.id}`);
  }

  return (
    <div className="space-y-6">
      {puedeEditar && (
        <section className="panel space-y-4 p-5">
          <h2 className="text-base font-semibold text-gray-900">Generar un plan</h2>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.etiqueta} type="button" className="btn btn-secondary btn-sm" onClick={() => setForm((f) => ({ ...f, desde: p.desde, hasta: p.hasta }))}>
                {p.etiqueta}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm"><span className="font-medium text-gray-800">Desde</span>
              <input type="date" className="input mt-1" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
            </label>
            <label className="text-sm"><span className="font-medium text-gray-800">Hasta</span>
              <input type="date" className="input mt-1" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
            </label>
            <label className="text-sm"><span className="font-medium text-gray-800">Nombre (opcional)</span>
              <input className="input mt-1" value={form.nombre} placeholder="Se arma con las sucursales y fechas" onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-gray-800">Sucursales</legend>
            <p className="text-xs text-gray-500">Las que se planifican juntas pueden prestarse personal (si la persona acepta traslados).</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {sucursales.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.sucursalesIds.includes(s.id)}
                    onChange={(e) => setForm({ ...form, sucursalesIds: e.target.checked ? [...form.sucursalesIds, s.id] : form.sucursalesIds.filter((x) => x !== s.id) })} />
                  {s.nombre}
                </label>
              ))}
            </div>
          </fieldset>
          <Aviso aviso={aviso} />
          <button type="button" className="btn btn-primary" disabled={generando || !form.sucursalesIds.length} onClick={generar}>
            {generando ? "Generando…" : "Generar plan"}
          </button>
        </section>
      )}

      <section className="panel overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Plan</th><th>Período</th><th>Sucursales</th><th>Estado</th><th>Errores legales</th><th>Avisos</th><th>Huecos</th></tr>
          </thead>
          <tbody>
            {planes === null && <tr><td colSpan={7} className="text-gray-500">Cargando…</td></tr>}
            {planes?.length === 0 && <tr><td colSpan={7} className="text-gray-500">Todavía no hay planes. Defina la cobertura de cada sucursal y genere el primero.</td></tr>}
            {planes?.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/horarios/${p.id}`} className="font-medium text-blue-800 hover:underline">{p.nombre}</Link></td>
                <td className="whitespace-nowrap">{periodoTexto(p.desde, p.hasta)}</td>
                <td>{p.sucursales.join(", ")}</td>
                <td><EstadoBadge valor={p.estado} /></td>
                <td className={p.resumen?.errores ? "font-semibold text-red-700" : ""}>{p.resumen?.errores ?? "—"}</td>
                <td>{p.resumen?.avisos ?? "—"}</td>
                <td className={p.resumen?.faltantes ? "text-amber-700" : ""}>{p.resumen?.faltantes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── Cobertura ──────────────────────────────────────────────────────────────

interface Franja { puestoId: string; dias: number[]; desde: string; hasta: string; minimo: number; etiqueta: string }
interface HorarioDia { dia: number; apertura: string; cierre: string; cerrado: boolean }

function Cobertura({ puedeEditar, sucursales }: { puedeEditar: boolean; sucursales: Sucursal[] }) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [puestos, setPuestos] = useState<{ id: string; nombre: string; departamento: string }[]>([]);
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [horario, setHorario] = useState<HorarioDia[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  // Al cambiar de sucursal rápido, una respuesta lenta de la anterior no debe pisar la nueva.
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async () => {
    if (!sucursalId) return;
    const n = ++ultimaCarga.current;
    setCargando(true);
    const r = await fetch(`/api/horarios/cobertura?sucursalId=${sucursalId}`, { cache: "no-store" });
    if (n !== ultimaCarga.current) return;
    setCargando(false);
    if (!r.ok) return;
    const d = await r.json();
    if (n !== ultimaCarga.current) return;
    setPuestos(d.puestos);
    setFranjas(d.franjas.map((f: Franja & { etiqueta: string | null }) => ({ puestoId: f.puestoId, dias: f.dias, desde: f.desde, hasta: f.hasta, minimo: f.minimo, etiqueta: f.etiqueta ?? "" })));
    setHorario(DIAS.map(([n]) => {
      const h = d.horario.find((x: { dia: number }) => x.dia === n);
      return { dia: n, apertura: h?.apertura ?? "", cierre: h?.cierre ?? "", cerrado: h?.cerrado ?? false };
    }));
  }, [sucursalId]);
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const cambiar = (i: number, v: Partial<Franja>) => setFranjas((fs) => fs.map((f, j) => (j === i ? { ...f, ...v } : f)));

  async function guardar() {
    setAviso(null);
    const r = await fetch("/api/horarios/cobertura", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sucursalId,
        franjas: franjas.map((f) => ({ ...f, minimo: Number(f.minimo), etiqueta: f.etiqueta || null })),
        horario: horario.map((h) => ({ dia: h.dia, cerrado: h.cerrado, apertura: h.apertura || null, cierre: h.cierre || null })),
      }),
    });
    setAviso(r.ok ? { ok: true, texto: "Cobertura guardada." } : { ok: false, texto: await textoError(r) });
  }

  const nombrePuesto = (id: string) => puestos.find((p) => p.id === id)?.nombre ?? "";
  const deshabilitado = !puedeEditar;

  return (
    <div className="space-y-6">
      <label className="block max-w-sm text-sm"><span className="font-medium text-gray-800">Sucursal</span>
        <select className="input mt-1" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label>
      {cargando && <p className="text-sm text-gray-500">Cargando…</p>}

      <section className="panel p-5">
        <h2 className="text-base font-semibold text-gray-900">Horario de atención al público</h2>
        <p className="mt-1 text-sm text-gray-500">El plan avisa si en algún momento de este horario la sucursal queda sin nadie.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {horario.map((h, i) => (
            <div key={h.dia} className="rounded-lg border border-gray-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize text-gray-800">{NOMBRE_DIA[h.dia]}</span>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" disabled={deshabilitado} checked={h.cerrado} onChange={(e) => setHorario((hs) => hs.map((x, j) => (j === i ? { ...x, cerrado: e.target.checked } : x)))} />
                  Cerrado
                </label>
              </div>
              {!h.cerrado && (
                <div className="mt-2 flex items-center gap-2">
                  <input type="time" className="input" disabled={deshabilitado} value={h.apertura} aria-label={`Apertura ${NOMBRE_DIA[h.dia]}`} onChange={(e) => setHorario((hs) => hs.map((x, j) => (j === i ? { ...x, apertura: e.target.value } : x)))} />
                  <span className="text-gray-400">a</span>
                  <input type="time" className="input" disabled={deshabilitado} value={h.cierre} aria-label={`Cierre ${NOMBRE_DIA[h.dia]}`} onChange={(e) => setHorario((hs) => hs.map((x, j) => (j === i ? { ...x, cierre: e.target.value } : x)))} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-base font-semibold text-gray-900">Personal mínimo por puesto y franja</h2>
        <p className="mt-1 text-sm text-gray-500">
          Defina el mínimo en horas valle para todo el horario y súmele franjas pico (p. ej. almuerzo 11:30–14:00 con 2 cajeros). Si dos franjas se
          pisan, manda la mayor. Incluya el tiempo de preparación antes de abrir y de cierre después de cerrar.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Puesto</th><th>Días</th><th>Desde</th><th>Hasta</th><th>Mínimo</th><th>Etiqueta</th><th /></tr></thead>
            <tbody>
              {franjas.length === 0 && <tr><td colSpan={7} className="text-gray-500">Sin franjas. Sin ellas el generador no programa a nadie de esta sucursal.</td></tr>}
              {franjas.map((f, i) => (
                <tr key={i}>
                  <td>
                    <select className="input min-w-40" disabled={deshabilitado} value={f.puestoId} onChange={(e) => cambiar(i, { puestoId: e.target.value })} aria-label="Puesto">
                      <option value="">— Puesto —</option>
                      {puestos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.departamento})</option>)}
                    </select>
                  </td>
                  <td><SelectorDias valor={f.dias} onChange={(d) => cambiar(i, { dias: d })} deshabilitado={deshabilitado} /></td>
                  <td><input type="time" className="input w-28" disabled={deshabilitado} value={f.desde} onChange={(e) => cambiar(i, { desde: e.target.value })} aria-label="Desde" /></td>
                  <td><input type="time" className="input w-28" disabled={deshabilitado} value={f.hasta} onChange={(e) => cambiar(i, { hasta: e.target.value })} aria-label="Hasta" /></td>
                  <td><input type="number" min={1} max={50} className="input w-20" disabled={deshabilitado} value={f.minimo} onChange={(e) => cambiar(i, { minimo: Number(e.target.value) })} aria-label="Mínimo" /></td>
                  <td><input className="input w-40" disabled={deshabilitado} value={f.etiqueta} placeholder="Valle, pico…" onChange={(e) => cambiar(i, { etiqueta: e.target.value })} aria-label="Etiqueta" /></td>
                  <td>{puedeEditar && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFranjas((fs) => fs.filter((_, j) => j !== i))} aria-label={`Quitar franja de ${nombrePuesto(f.puestoId)}`}>Quitar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {puedeEditar && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setFranjas((fs) => [...fs, { puestoId: puestos[0]?.id ?? "", dias: [1, 2, 3, 4, 5, 6, 7], desde: "07:00", hasta: "21:00", minimo: 1, etiqueta: "" }])}>
              Agregar franja
            </button>
            <button type="button" className="btn btn-primary" onClick={guardar}>Guardar cobertura</button>
          </div>
        )}
        <div className="mt-3"><Aviso aviso={aviso} /></div>
      </section>
    </div>
  );
}

// ─── Disponibilidad del personal ────────────────────────────────────────────

interface Pref {
  permiteTraslado: boolean; sucursalesTraslado: string[]; noAntesDe: string | null; noDespuesDe: string | null;
  diasRestriccion: string; soloDiurna: boolean; diasNoDisponible: string; diaDescansoPreferido: number | null; motivo: string | null;
}
interface EmpPref {
  id: string; codigo: string; primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null;
  fechaNacimiento: string; sucursal: Sucursal; puesto: { id: string; nombre: string } | null; preferenciaHorario: Pref | null;
}
const listaDias = (s: string) => s.split(",").map(Number).filter(Boolean);
const textoDias = (d: number[]) => d.map((n) => NOMBRE_DIA[n].slice(0, 3)).join(", ");

function Personal({ puedeEditar, sucursales }: { puedeEditar: boolean; sucursales: Sucursal[] }) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [empleados, setEmpleados] = useState<EmpPref[] | null>(null);
  const [edicion, setEdicion] = useState<{ id: string; nombre: string; d: Pref } | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const ultimaCarga = useRef(0);

  const cargar = useCallback(async () => {
    const n = ++ultimaCarga.current;
    const r = await fetch(`/api/horarios/preferencias?sucursalId=${sucursalId}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    if (n === ultimaCarga.current) setEmpleados(d);
  }, [sucursalId]);
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const nombre = (e: EmpPref) => [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");
  const vacia: Pref = { permiteTraslado: false, sucursalesTraslado: [], noAntesDe: null, noDespuesDe: null, diasRestriccion: "", soloDiurna: false, diasNoDisponible: "", diaDescansoPreferido: null, motivo: null };

  const resumen = (p: Pref | null): string[] => {
    if (!p) return [];
    const r: string[] = [];
    if (p.permiteTraslado) r.push(p.sucursalesTraslado.length ? `Traslado a ${p.sucursalesTraslado.map((id) => sucursales.find((s) => s.id === id)?.nombre ?? "").join(", ")}` : "Acepta traslados");
    const dr = listaDias(p.diasRestriccion);
    const cuando = dr.length ? ` (${textoDias(dr)})` : "";
    if (p.noAntesDe) r.push(`Entra desde ${p.noAntesDe}${cuando}`);
    if (p.noDespuesDe) r.push(`Sale a más tardar ${p.noDespuesDe}${cuando}`);
    if (p.soloDiurna) r.push("Sólo jornada diurna");
    const nd = listaDias(p.diasNoDisponible);
    if (nd.length) r.push(`No disponible: ${textoDias(nd)}`);
    if (p.diaDescansoPreferido) r.push(`Prefiere descansar el ${NOMBRE_DIA[p.diaDescansoPreferido]}`);
    return r;
  };

  async function guardar() {
    if (!edicion) return;
    const d = edicion.d;
    const r = await fetch("/api/horarios/preferencias", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId: edicion.id, permiteTraslado: d.permiteTraslado, sucursalesTraslado: d.sucursalesTraslado,
        noAntesDe: d.noAntesDe || null, noDespuesDe: d.noDespuesDe || null, diasRestriccion: listaDias(d.diasRestriccion),
        soloDiurna: d.soloDiurna, diasNoDisponible: listaDias(d.diasNoDisponible), diaDescansoPreferido: d.diaDescansoPreferido, motivo: d.motivo || null,
      }),
    });
    if (!r.ok) {
      setAviso({ ok: false, texto: await textoError(r) });
      return;
    }
    setAviso({ ok: true, texto: `Disponibilidad de ${edicion.nombre} guardada.` });
    setEdicion(null);
    await cargar();
  }

  const set = (v: Partial<Pref>) => edicion && setEdicion({ ...edicion, d: { ...edicion.d, ...v } });

  return (
    <div className="space-y-4">
      <label className="block max-w-sm text-sm"><span className="font-medium text-gray-800">Sucursal</span>
        <select className="input mt-1" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </label>
      <Aviso aviso={aviso} />

      {edicion && (
        <section className="panel space-y-4 p-5">
          <h2 className="text-base font-semibold text-gray-900">Disponibilidad de {edicion.nombre}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.d.permiteTraslado} onChange={(e) => set({ permiteTraslado: e.target.checked })} /> Acepta trasladarse a otra sucursal</label>
              {edicion.d.permiteTraslado && (
                <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                  {sucursales.filter((s) => s.id !== sucursalId).map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={edicion.d.sucursalesTraslado.includes(s.id)}
                        onChange={(e) => set({ sucursalesTraslado: e.target.checked ? [...edicion.d.sucursalesTraslado, s.id] : edicion.d.sucursalesTraslado.filter((x) => x !== s.id) })} />
                      {s.nombre}
                    </label>
                  ))}
                  <span className="text-xs text-gray-500">Sin marcar ninguna: a cualquiera.</span>
                </div>
              )}
              <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.d.soloDiurna} onChange={(e) => set({ soloDiurna: e.target.checked })} /> Sólo jornada diurna (nada después de las 7:00 p. m.)</label>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label><span className="font-medium text-gray-800">No entrar antes de</span><input type="time" className="input mt-1" value={edicion.d.noAntesDe ?? ""} onChange={(e) => set({ noAntesDe: e.target.value || null })} /></label>
              <label><span className="font-medium text-gray-800">Salir a más tardar</span><input type="time" className="input mt-1" value={edicion.d.noDespuesDe ?? ""} onChange={(e) => set({ noDespuesDe: e.target.value || null })} /></label>
              <div className="col-span-2">
                <span className="font-medium text-gray-800">Esas horas rigen los días</span>
                <div className="mt-1"><SelectorDias valor={listaDias(edicion.d.diasRestriccion)} onChange={(d) => set({ diasRestriccion: d.join(",") })} /></div>
                <span className="text-xs text-gray-500">Sin marcar: todos los días.</span>
              </div>
            </div>
            <div className="text-sm">
              <span className="font-medium text-gray-800">No puede trabajar los</span>
              <div className="mt-1"><SelectorDias valor={listaDias(edicion.d.diasNoDisponible)} onChange={(d) => set({ diasNoDisponible: d.join(",") })} /></div>
            </div>
            <label className="text-sm"><span className="font-medium text-gray-800">Día de descanso preferido</span>
              <select className="input mt-1" value={edicion.d.diaDescansoPreferido ?? ""} onChange={(e) => set({ diaDescansoPreferido: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Sin preferencia</option>
                {DIAS.map(([n]) => <option key={n} value={n}>{NOMBRE_DIA[n]}</option>)}
              </select>
            </label>
            <label className="text-sm sm:col-span-2"><span className="font-medium text-gray-800">Motivo (se muestra en las alertas)</span>
              <input className="input mt-1" maxLength={200} value={edicion.d.motivo ?? ""} placeholder="Estudios universitarios, indicación médica…" onChange={(e) => set({ motivo: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={guardar}>Guardar</button>
            <button type="button" className="btn btn-secondary" onClick={() => setEdicion(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <section className="panel overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Persona</th><th>Puesto</th><th>Disponibilidad</th><th /></tr></thead>
          <tbody>
            {empleados === null && <tr><td colSpan={4} className="text-gray-500">Cargando…</td></tr>}
            {empleados?.map((e) => {
              const notas = resumen(e.preferenciaHorario);
              return (
                <tr key={e.id}>
                  <td><span className="font-medium text-gray-900">{nombre(e)}</span> <span className="text-xs text-gray-500">{e.codigo}</span></td>
                  <td>{e.puesto?.nombre ?? <span className="text-amber-700">Sin puesto: no se programa</span>}</td>
                  <td className="text-sm">{notas.length ? notas.join("; ") :<span className="text-gray-400">Sin restricciones</span>}</td>
                  <td>{puedeEditar && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ id: e.id, nombre: nombre(e), d: e.preferenciaHorario ?? vacia })}>Editar</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── Reglas ─────────────────────────────────────────────────────────────────

interface ReglasForm { descansoEntreJornadasH: number; vispera: ModoVispera; rotacion: PoliticaRotacion; permitirExtra: boolean; puestosExentos: string[] }

function Reglas({ puedeEditar }: { puedeEditar: boolean }) {
  const [reglas, setReglas] = useState<ReglasForm | null>(null);
  const [puestos, setPuestos] = useState<{ id: string; nombre: string }[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await fetch("/api/horarios/reglas", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setReglas(d.reglas);
      setPuestos(d.puestos);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function guardar() {
    if (!reglas) return;
    const r = await fetch("/api/horarios/reglas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reglas) });
    setAviso(r.ok ? { ok: true, texto: "Reglas guardadas. Se aplican a los planes que se generen desde ahora." } : { ok: false, texto: await textoError(r) });
  }

  if (!reglas) return <p className="text-sm text-gray-500">Cargando…</p>;
  const des = !puedeEditar;
  return (
    <section className="panel max-w-3xl space-y-5 p-5 text-sm">
      <label className="block"><span className="font-medium text-gray-800">Descanso mínimo entre jornadas (horas)</span>
        <input type="number" min={10} max={24} className="input mt-1 w-28" disabled={des} value={reglas.descansoEntreJornadasH} onChange={(e) => setReglas({ ...reglas, descansoEntreJornadasH: Number(e.target.value) })} />
        <span className="mt-1 block text-xs text-gray-500">El Código exige 10 h (Art. 327); por encima es política de la empresa. Con menos de 10 h el plan da error; entre 10 h y su política, aviso.</span>
      </label>
      <label className="block"><span className="font-medium text-gray-800">Víspera del descanso semanal</span>
        <select className="input mt-1" disabled={des} value={reglas.vispera} onChange={(e) => setReglas({ ...reglas, vispera: e.target.value as ModoVispera })}>
          {(Object.keys(ETIQUETA_VISPERA) as ModoVispera[]).map((k) => <option key={k} value={k}>{ETIQUETA_VISPERA[k]}</option>)}
        </select>
        <span className="mt-1 block text-xs text-gray-500">Art. 341: «Ningún trabajador podrá ser ocupado después de la hora trece (1:00 p. m.) de la víspera del día de descanso semanal». Con «Exigir», la víspera es media jornada de mañana (5 × 8 h + 4 h = 44 h).</span>
      </label>
      <label className="block"><span className="font-medium text-gray-800">Rotación de aperturas y cierres</span>
        <select className="input mt-1" disabled={des} value={reglas.rotacion} onChange={(e) => setReglas({ ...reglas, rotacion: e.target.value as PoliticaRotacion })}>
          {(Object.keys(ETIQUETA_ROTACION) as PoliticaRotacion[]).map((k) => <option key={k} value={k}>{ETIQUETA_ROTACION[k]}</option>)}
        </select>
        <span className="mt-1 block text-xs text-gray-500">El Art. 337 pide evitar cambios de turno que alteren las horas de descanso y comida: por eso la opción semanal es la predeterminada.</span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" disabled={des} checked={reglas.permitirExtra} onChange={(e) => setReglas({ ...reglas, permitirExtra: e.target.checked })} />
        <span><span className="font-medium text-gray-800">Permitir horas extra para cubrir faltantes</span>
          <span className="block text-xs text-gray-500">Desmarcado, el generador nunca programa extra: deja el hueco y lo avisa. Marcado, prolonga turnos (máximo 12 h con la ordinaria y 4 días por semana, Arts. 332 y 333) y clasifica cada hora: +25 % diurna, +50 % en período nocturno, +75 % si prolonga una jornada nocturna (Art. 330).</span>
        </span>
      </label>
      <fieldset>
        <legend className="font-medium text-gray-800">Puestos de dirección o de confianza (Art. 325)</legend>
        <p className="text-xs text-gray-500">Quedan fuera de la jornada máxima, pero no más de 12 h diarias y con 1 h 30 de descanso. Márquelos sólo si de verdad lo son: un gerente de turno que cumple horario normal no lo es.</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {puestos.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" disabled={des} checked={reglas.puestosExentos.includes(p.id)}
                onChange={(e) => setReglas({ ...reglas, puestosExentos: e.target.checked ? [...reglas.puestosExentos, p.id] : reglas.puestosExentos.filter((x) => x !== p.id) })} />
              {p.nombre}
            </label>
          ))}
        </div>
      </fieldset>
      <Aviso aviso={aviso} />
      {puedeEditar && <button type="button" className="btn btn-primary" onClick={guardar}>Guardar reglas</button>}
    </section>
  );
}
