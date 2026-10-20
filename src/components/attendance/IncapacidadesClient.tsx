"use client";

/**
 * Incapacidades del IHSS: registro del certificado y su efecto en planilla.
 *
 * Los primeros días los paga el patrono (3 por omisión, Art. 71 del Reglamento
 * de Incapacidad Temporal del IHSS de 2020); desde el siguiente, el IHSS paga
 * el subsidio directamente al trabajador y la planilla descuenta ese salario,
 * salvo el complemento patronal (maternidad, Art. 136 del Código del Trabajo).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ETIQUETA_TIPO_INCAPACIDAD,
  diasEntre,
  diasPatronoParaNueva,
  type ReglasIncapacidad,
  type TipoIncapacidad,
} from "@/lib/asistencia/incapacidades";

interface Empleado { id: string; codigo: string; nombre: string; femenino: boolean }

interface Incapacidad {
  id: string;
  empleadoId: string;
  tipo: TipoIncapacidad;
  emisor: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  numeroCertificado: string | null;
  prorrogaDeId: string | null;
  diasPatrono: number;
  porcentajeSubsidio: number;
  porcentajeComplemento: number;
  archivoUrl: string | null;
  observacion: string | null;
  anulada: boolean;
  reparto: { patrono: number; ihss: number };
  subsidioEstimado: number;
  empleado: { codigo: string; primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null };
}

const EMISORES = [
  { v: "IHSS", l: "IHSS" },
  { v: "MEDICO_PRIVADO", l: "Médico privado (refrendado)" },
  { v: "SISTEMA_MEDICO_EMPRESA", l: "Sistema médico de empresa" },
];

const TIPOS = Object.entries(ETIQUETA_TIPO_INCAPACIDAD) as [TipoIncapacidad, string][];
const nombreDe = (e: Incapacidad["empleado"]) => [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");
const f = (s: string) => new Date(`${s}T00:00:00Z`);
const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Tegucigalpa" }).slice(0, 7);

const formVacio = { empleadoId: "", tipo: "ENFERMEDAD_COMUN" as TipoIncapacidad, emisor: "IHSS", fechaInicio: "", fechaFin: "", numeroCertificado: "", prorrogaDeId: "", observacion: "" };

export default function IncapacidadesClient({ empleados, puedeReglas }: { empleados: Empleado[]; puedeReglas: boolean }) {
  const [lista, setLista] = useState<Incapacidad[] | null>(null);
  const [reglas, setReglas] = useState<ReglasIncapacidad | null>(null);
  const [filtro, setFiltro] = useState({ empleadoId: "", mes: mesActual() });
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(formVacio);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [historialEmp, setHistorialEmp] = useState<Incapacidad[]>([]);

  const cargar = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filtro.empleadoId) qs.set("empleadoId", filtro.empleadoId);
    if (filtro.mes) {
      const [a, m] = filtro.mes.split("-").map(Number);
      const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      qs.set("desde", `${filtro.mes}-01`);
      qs.set("hasta", `${filtro.mes}-${String(ultimo).padStart(2, "0")}`);
    }
    const res = await fetch(`/api/incapacidades?${qs}`, { cache: "no-store" });
    setLista(res.ok ? await res.json() : []);
  }, [filtro]);

  useEffect(() => {
    const t = setTimeout(() => {
      void cargar();
      void (async () => {
        const r = await fetch("/api/incapacidades/reglas", { cache: "no-store" });
        if (r.ok) setReglas((await r.json()).reglas);
      })();
    }, 0);
    return () => clearTimeout(t);
  }, [cargar]);

  // Para elegir de qué incapacidad es prórroga: el historial del empleado elegido.
  useEffect(() => {
    if (!form.empleadoId) return;
    let vivo = true;
    void (async () => {
      const r = await fetch(`/api/incapacidades?empleadoId=${form.empleadoId}`, { cache: "no-store" });
      if (vivo && r.ok) setHistorialEmp(((await r.json()) as Incapacidad[]).filter((i) => !i.anulada));
    })();
    return () => { vivo = false; };
  }, [form.empleadoId]);

  const previa = useMemo(() => {
    if (!reglas || !form.fechaInicio || !form.fechaFin || form.fechaFin < form.fechaInicio) return null;
    const dias = diasEntre(f(form.fechaInicio), f(form.fechaFin));
    let consumidos = 0;
    let id: string | null = form.prorrogaDeId || null;
    const vistos = new Set<string>();
    while (id && !vistos.has(id)) {
      vistos.add(id);
      const inc = historialEmp.find((i) => i.id === id);
      if (!inc) break;
      consumidos += inc.diasPatrono;
      id = inc.prorrogaDeId;
    }
    const regla = reglas[form.tipo];
    const patrono = Math.min(dias, diasPatronoParaNueva(regla, consumidos));
    return { dias, patrono, ihss: dias - patrono, regla };
  }, [reglas, form.fechaInicio, form.fechaFin, form.tipo, form.prorrogaDeId, historialEmp]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      let archivoUrl: string | null = null;
      if (archivo) {
        const fd = new FormData();
        fd.append("file", archivo);
        const up = await fetch("/api/uploads", { method: "POST", body: fd });
        const du = await up.json();
        if (!up.ok) throw new Error(du.error ?? "No se pudo subir el certificado");
        archivoUrl = du.url;
      }
      const res = await fetch("/api/incapacidades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, prorrogaDeId: form.prorrogaDeId || null, numeroCertificado: form.numeroCertificado || null, observacion: form.observacion || null, archivoUrl }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo registrar");
      setAviso({ ok: true, texto: `Incapacidad registrada: ${d.dias} días, ${d.diasPatrono} a cargo del patrono.${d.avisos?.length ? ` ${d.avisos.join(" ")}` : ""}` });
      setForm(formVacio);
      setArchivo(null);
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setAviso({ ok: false, texto: err instanceof Error ? err.message : "Error" });
    } finally {
      setEnviando(false);
    }
  }

  async function anular(i: Incapacidad) {
    const motivo = prompt(`Motivo para anular la incapacidad de ${nombreDe(i.empleado)} del ${formatDate(i.fechaInicio)}:`);
    if (!motivo?.trim()) return;
    const res = await fetch(`/api/incapacidades/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anulada: true, motivo: motivo.trim() }) });
    const d = await res.json();
    setAviso(res.ok ? { ok: true, texto: "Incapacidad anulada." } : { ok: false, texto: d.error ?? "No se pudo anular" });
    await cargar();
  }

  const empSel = empleados.find((e) => e.id === form.empleadoId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incapacidades"
        description="Certificados de incapacidad temporal. Los primeros días los paga el patrono; desde el siguiente, el IHSS paga el subsidio al trabajador y la planilla descuenta ese salario."
        actions={<button type="button" className="btn btn-primary" onClick={() => setMostrarForm((v) => !v)}>{mostrarForm ? "Cerrar" : "Registrar incapacidad"}</button>}
      />

      {aviso && (
        <div role="status" className={`rounded-md border px-3 py-2 text-sm ${aviso.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{aviso.texto}</div>
      )}

      {mostrarForm && (
        <form onSubmit={registrar} className="panel space-y-4 p-6" aria-labelledby="inc-nueva">
          <h2 id="inc-nueva" className="text-base font-semibold text-gray-900">Registrar incapacidad</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-emp">Empleado</label>
              <select id="inc-emp" className="input" value={form.empleadoId} onChange={(e) => setForm((x) => ({ ...x, empleadoId: e.target.value, prorrogaDeId: "" }))} required>
                <option value="">Elegir</option>
                {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre} ({e.codigo})</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-tipo">Tipo</label>
              <select id="inc-tipo" className="input" value={form.tipo} onChange={(e) => setForm((x) => ({ ...x, tipo: e.target.value as TipoIncapacidad }))}>
                {TIPOS.filter(([t]) => t !== "MATERNIDAD" || !empSel || empSel.femenino).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-ini">Desde</label>
              <input id="inc-ini" type="date" className="input" value={form.fechaInicio} onChange={(e) => setForm((x) => ({ ...x, fechaInicio: e.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-fin">Hasta</label>
              <input id="inc-fin" type="date" className="input" value={form.fechaFin} min={form.fechaInicio || undefined} onChange={(e) => setForm((x) => ({ ...x, fechaFin: e.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-emisor">Emitida por</label>
              <select id="inc-emisor" className="input" value={form.emisor} onChange={(e) => setForm((x) => ({ ...x, emisor: e.target.value }))}>
                {EMISORES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-num">Número de certificado</label>
              <input id="inc-num" className="input" value={form.numeroCertificado} onChange={(e) => setForm((x) => ({ ...x, numeroCertificado: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-prorroga">Es prórroga de</label>
              <select id="inc-prorroga" className="input" value={form.prorrogaDeId} onChange={(e) => setForm((x) => ({ ...x, prorrogaDeId: e.target.value }))} disabled={!form.empleadoId}>
                <option value="">No, es una incapacidad nueva</option>
                {historialEmp.map((i) => <option key={i.id} value={i.id}>{ETIQUETA_TIPO_INCAPACIDAD[i.tipo]}, {formatDate(i.fechaInicio)} al {formatDate(i.fechaFin)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-archivo">Certificado (PDF o imagen)</label>
              <input id="inc-archivo" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="input" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="inc-obs">Observación</label>
              <input id="inc-obs" className="input" value={form.observacion} onChange={(e) => setForm((x) => ({ ...x, observacion: e.target.value }))} placeholder="No anote el diagnóstico: basta el número de certificado." />
            </div>
          </div>
          {previa && (
            <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {previa.dias} días: {previa.patrono} a cargo del patrono y {previa.ihss} a cargo del IHSS.
              {previa.ihss > 0 && previa.regla.porcentajeComplemento > 0 && ` En esos días el patrono completa el ${previa.regla.porcentajeComplemento} % del salario.`}
              {form.prorrogaDeId && " Como es prórroga, no reinicia los días del patrono."}
            </p>
          )}
          <div className="flex justify-end"><button type="submit" className="btn btn-primary" disabled={enviando}>{enviando ? "Registrando…" : "Registrar"}</button></div>
        </form>
      )}

      <section className="panel flex flex-wrap items-end gap-3 p-4" aria-label="Filtros">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="flt-emp">Empleado</label>
          <select id="flt-emp" className="input" value={filtro.empleadoId} onChange={(e) => setFiltro((x) => ({ ...x, empleadoId: e.target.value }))}>
            <option value="">Todos</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="flt-mes">Mes</label>
          <input id="flt-mes" type="month" className="input" value={filtro.mes} onChange={(e) => setFiltro((x) => ({ ...x, mes: e.target.value }))} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiltro((x) => ({ ...x, mes: "" }))}>Ver todas</button>
      </section>

      <section className="panel overflow-hidden" aria-label="Incapacidades registradas">
        {lista === null ? (
          <p className="p-6 text-sm text-gray-400">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No hay incapacidades en ese período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th className="px-4">Empleado</th>
                  <th className="px-4">Tipo</th>
                  <th className="px-4">Fechas</th>
                  <th className="num px-4">Patrono</th>
                  <th className="num px-4">IHSS</th>
                  <th className="num px-4" title="Lo calcula y lo paga el IHSS con su propia base">Subsidio estimado</th>
                  <th className="px-4">Certificado</th>
                  <th className="px-4" />
                </tr>
              </thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id} className={i.anulada ? "text-gray-400" : ""}>
                    <td className="px-4 py-2.5">{nombreDe(i.empleado)}<span className="block text-xs text-gray-500">{i.empleado.codigo}</span></td>
                    <td className="px-4 py-2.5">{ETIQUETA_TIPO_INCAPACIDAD[i.tipo]}{i.prorrogaDeId && <span className="block text-xs text-gray-500">Prórroga</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDate(i.fechaInicio)} al {formatDate(i.fechaFin)}<span className="block text-xs text-gray-500">{i.dias} días</span></td>
                    <td className="num px-4 py-2.5">{i.reparto.patrono}</td>
                    <td className="num px-4 py-2.5">{i.reparto.ihss}</td>
                    <td className="num px-4 py-2.5">{formatCurrency(i.subsidioEstimado)}</td>
                    <td className="px-4 py-2.5">
                      {i.numeroCertificado ?? <span className="text-gray-400">Sin número</span>}
                      {i.archivoUrl && <a className="ml-2 text-xs text-blue-700 hover:underline" href={i.archivoUrl} target="_blank" rel="noopener noreferrer">Ver</a>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {i.anulada ? <span className="text-xs text-red-700">Anulada</span> : <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => void anular(i)}>Anular</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reglas && <PanelReglas reglas={reglas} puedeEditar={puedeReglas} onGuardado={setReglas} />}
    </div>
  );
}

function PanelReglas({ reglas, puedeEditar, onGuardado }: { reglas: ReglasIncapacidad; puedeEditar: boolean; onGuardado: (r: ReglasIncapacidad) => void }) {
  const [edicion, setEdicion] = useState(reglas);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function guardar() {
    const res = await fetch("/api/incapacidades/reglas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edicion) });
    const d = await res.json();
    setMsg(res.ok ? { ok: true, texto: "Reglas guardadas. Se aplican a las incapacidades que se registren desde ahora." } : { ok: false, texto: d.error ?? "No se pudo guardar" });
    if (res.ok) onGuardado(d.reglas);
  }

  const campo = (t: TipoIncapacidad, k: keyof ReglasIncapacidad[TipoIncapacidad]) => (
    <input
      type="number"
      className="input w-24 text-right"
      aria-label={`${ETIQUETA_TIPO_INCAPACIDAD[t]}: ${k}`}
      disabled={!puedeEditar}
      value={edicion[t][k]}
      onChange={(e) => setEdicion((x) => ({ ...x, [t]: { ...x[t], [k]: Number(e.target.value) } }))}
    />
  );

  return (
    <section className="panel space-y-3 p-5" aria-labelledby="inc-reglas">
      <div>
        <h2 id="inc-reglas" className="text-sm font-semibold text-gray-900">Reglas por tipo</h2>
        <p className="mt-1 text-xs text-gray-500">
          Verificado: los 3 días del patrono (Art. 71 del Reglamento de Incapacidad Temporal del IHSS, La Gaceta del 29 de mayo de 2020) y el complemento patronal en maternidad (Art. 136 del Código del Trabajo). Sin verificar: el 66 % del subsidio, que sólo se usa para el estimado y para fijar el complemento. Cada incapacidad guarda las reglas con que se registró.
          {!puedeEditar && " Las cambia quien edita los parámetros de ley."}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base text-sm">
          <thead><tr><th className="px-3">Tipo</th><th className="num px-3">Días del patrono</th><th className="num px-3">% subsidio IHSS</th><th className="num px-3">% complemento patronal</th></tr></thead>
          <tbody>
            {TIPOS.map(([t, l]) => (
              <tr key={t}>
                <td className="px-3 py-2">{l}</td>
                <td className="px-3 py-2 text-right">{campo(t, "diasPatrono")}</td>
                <td className="px-3 py-2 text-right">{campo(t, "porcentajeSubsidio")}</td>
                <td className="px-3 py-2 text-right">{campo(t, "porcentajeComplemento")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {puedeEditar && (
        <div className="flex items-center justify-end gap-3">
          {msg && <span className={`text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.texto}</span>}
          <button type="button" className="btn btn-primary" onClick={() => void guardar()}>Guardar reglas</button>
        </div>
      )}
    </section>
  );
}
