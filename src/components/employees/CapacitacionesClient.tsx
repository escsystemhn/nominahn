"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Capacitacion {
  id: string;
  nombre: string;
  tipo: string;
  proveedor: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  costoPresupuestado: string | number;
  costoReal: string | number | null;
  estado: string;
  _count: { participantes: number };
}

interface Participante {
  id: string;
  empleadoId: string;
  nombre: string;
  codigo: string;
  asistio: boolean;
  aprobado: boolean | null;
  calificacion: string | number | null;
}

interface Props {
  empleados: { id: string; nombre: string }[];
  puedeGestionar: boolean;
}

const estadoBadge: Record<string, string> = {
  PLANIFICADA: "bg-blue-100 text-blue-800",
  EN_CURSO: "bg-amber-100 text-amber-800",
  FINALIZADA: "bg-green-100 text-green-800",
  CANCELADA: "bg-red-100 text-red-700",
};
const ESTADOS = ["PLANIFICADA", "EN_CURSO", "FINALIZADA", "CANCELADA"];

// Peticiones puras (no tocan estado de React). Al vivir fuera del componente se
// pueden usar igual desde los efectos y desde los manejadores de eventos, sin
// duplicar la lógica de fetch ni entrar en las dependencias de los hooks.
async function obtenerLista(): Promise<Capacitacion[]> {
  const res = await fetch("/api/capacitaciones");
  return res.ok ? await res.json() : [];
}

async function obtenerParticipantes(id: string): Promise<Participante[]> {
  const res = await fetch(`/api/capacitaciones/${id}`);
  if (!res.ok) return [];
  const c = await res.json();
  return c.participantes ?? [];
}

export default function CapacitacionesClient({ empleados, puedeGestionar }: Props) {
  const [lista, setLista] = useState<Capacitacion[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [msg, setMsg] = useState("");

  const [f, setF] = useState({ nombre: "", tipo: "INTERNA", proveedor: "", fechaInicio: "", fechaFin: "", costoPresupuestado: "", descripcion: "" });
  const [nuevoEmp, setNuevoEmp] = useState("");

  // Refresco manual tras una mutación: se invoca desde manejadores de eventos,
  // donde sí es correcto llamar a setState de forma síncrona.
  const cargar = useCallback(async () => {
    setLoading(true);
    try { setLista(await obtenerLista()); } finally { setLoading(false); }
  }, []);

  const cargarDetalle = useCallback(async (id: string) => {
    setParticipantes(await obtenerParticipantes(id));
  }, []);

  // Carga inicial. La bandera `vivo` descarta la respuesta si el componente se
  // desmontó o el efecto se relanzó, para que una petición lenta no pise datos
  // más nuevos.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const datos = await obtenerLista();
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
      const ps = await obtenerParticipantes(sel);
      if (vivo) setParticipantes(ps);
    })();
    return () => { vivo = false; };
  }, [sel]);

  const totPresup = lista.reduce((s, c) => s + Number(c.costoPresupuestado), 0);
  const totReal = lista.reduce((s, c) => s + Number(c.costoReal ?? 0), 0);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    if (!f.nombre.trim() || !f.fechaInicio) { setMsg("Nombre y fecha de inicio son obligatorios."); return; }
    const res = await fetch("/api/capacitaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    if (!res.ok) { setMsg((await res.json()).error ?? "Error al crear."); return; }
    setF({ nombre: "", tipo: "INTERNA", proveedor: "", fechaInicio: "", fechaFin: "", costoPresupuestado: "", descripcion: "" });
    setCreando(false); await cargar();
  }

  // Campos editables desde la tabla. `costoReal` viaja como string porque sale
  // directo de un <input type="number">; el schema del endpoint lo coacciona.
  async function actualizar(id: string, data: { estado?: string; costoReal?: string }) {
    await fetch(`/api/capacitaciones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    await cargar();
  }

  async function inscribir() {
    if (!sel || !nuevoEmp) return;
    const res = await fetch(`/api/capacitaciones/${sel}/participantes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empleadoId: nuevoEmp }) });
    if (!res.ok) { alert((await res.json()).error ?? "No se pudo inscribir."); return; }
    setNuevoEmp(""); await cargarDetalle(sel); await cargar();
  }

  // Se corresponde con `schemaCalificar` del endpoint: los tres campos son
  // opcionales y `calificacion` llega como string desde el <input type="number">.
  async function actualizarParticipante(
    participanteId: string,
    data: { asistio?: boolean; aprobado?: boolean; calificacion?: string }
  ) {
    await fetch(`/api/capacitaciones/${sel}/participantes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ participanteId, ...data }) });
    if (sel) await cargarDetalle(sel);
  }

  const capSel = lista.find((c) => c.id === sel);
  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm";
  const empDisponibles = empleados.filter((e) => !participantes.some((p) => p.empleadoId === e.id));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Capacitación</h1>
          <p className="text-sm text-gray-500">Programas de formación y control de presupuesto</p>
        </div>
        {puedeGestionar && (
          <button onClick={() => setCreando((v) => !v)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            {creando ? "Cancelar" : "Nueva capacitación"}
          </button>
        )}
      </div>

      {/* Resumen presupuesto */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Presupuestado (total)</p>
          <p className="text-lg font-bold mt-1 text-gray-900">{formatCurrency(totPresup)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Ejecutado (total)</p>
          <p className="text-lg font-bold mt-1 text-blue-700">{formatCurrency(totReal)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Disponible</p>
          <p className={`text-lg font-bold mt-1 ${totPresup - totReal < 0 ? "text-red-700" : "text-green-700"}`}>{formatCurrency(totPresup - totReal)}</p>
        </div>
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {creando && puedeGestionar && (
        <form onSubmit={crear} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 grid md:grid-cols-2 gap-4">
          <div><label className="block text-xs text-gray-600 mb-1">Nombre</label><input className={inputCls} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Tipo</label>
            <select className={inputCls} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="INTERNA">Interna</option><option value="EXTERNA">Externa</option>
            </select>
          </div>
          <div><label className="block text-xs text-gray-600 mb-1">Proveedor</label><input className={inputCls} value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Costo presupuestado</label><input type="number" className={inputCls} value={f.costoPresupuestado} onChange={(e) => setF({ ...f, costoPresupuestado: e.target.value })} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Fecha inicio</label><input type="date" className={inputCls} value={f.fechaInicio} onChange={(e) => setF({ ...f, fechaInicio: e.target.value })} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Fecha fin</label><input type="date" className={inputCls} value={f.fechaFin} onChange={(e) => setF({ ...f, fechaFin: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="block text-xs text-gray-600 mb-1">Descripción</label><textarea rows={2} className={inputCls} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></div>
          <div className="md:col-span-2"><button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Guardar</button></div>
        </form>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Programas</div>
          {loading ? <p className="p-5 text-sm text-gray-400">Cargando…</p> : lista.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">Sin capacitaciones.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {lista.map((c) => {
                const real = Number(c.costoReal ?? 0), pres = Number(c.costoPresupuestado);
                const sobre = real > pres;
                return (
                  <li key={c.id} className={`px-5 py-3 cursor-pointer hover:bg-gray-50 ${sel === c.id ? "bg-blue-50" : ""}`} onClick={() => setSel(c.id)}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{c.nombre}</p>
                        <p className="text-xs text-gray-500">
                          {c.tipo} · {formatDate(c.fechaInicio)} · {c._count.participantes} participante(s)
                          {c.proveedor ? ` · ${c.proveedor}` : ""}
                        </p>
                        <p className="text-xs mt-0.5">
                          <span className="text-gray-500">Ppto {formatCurrency(pres)}</span>
                          {c.costoReal != null && <span className={sobre ? "text-red-600" : "text-green-700"}> · Real {formatCurrency(real)}</span>}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${estadoBadge[c.estado]}`}>{c.estado}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">
            {capSel ? `Detalle · ${capSel.nombre}` : "Seleccione un programa"}
          </div>
          {!sel || !capSel ? (
            <p className="p-5 text-sm text-gray-400">Elija un programa para gestionar participantes y costo.</p>
          ) : (
            <div className="p-4 space-y-3">
              {puedeGestionar && (
                <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-gray-100">
                  <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs" value={capSel.estado} onChange={(e) => actualizar(sel, { estado: e.target.value })}>
                    {ESTADOS.map((es) => <option key={es} value={es}>{es}</option>)}
                  </select>
                  <div className="flex items-end gap-1">
                    <div>
                      <label className="block text-[10px] text-gray-500">Costo real</label>
                      <input type="number" defaultValue={capSel.costoReal ?? ""} onBlur={(e) => actualizar(sel, { costoReal: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-28" placeholder="ejecutado" />
                    </div>
                  </div>
                </div>
              )}
              {puedeGestionar && (
                <div className="flex gap-2 pb-3 border-b border-gray-100">
                  <select className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" value={nuevoEmp} onChange={(e) => setNuevoEmp(e.target.value)}>
                    <option value="">Inscribir empleado…</option>
                    {empDisponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                  <button onClick={inscribir} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">Inscribir</button>
                </div>
              )}
              {participantes.length === 0 ? <p className="text-sm text-gray-400">Sin participantes.</p> : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b">
                      <th className="text-left py-2 font-medium">Empleado</th>
                      <th className="text-center py-2 font-medium">Asistió</th>
                      <th className="text-center py-2 font-medium">Nota</th>
                      <th className="text-center py-2 font-medium">Aprobó</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {participantes.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2">{p.nombre}<div className="text-gray-400">{p.codigo}</div></td>
                        <td className="py-2 text-center">
                          <input type="checkbox" checked={p.asistio} disabled={!puedeGestionar} onChange={(e) => actualizarParticipante(p.id, { asistio: e.target.checked })} />
                        </td>
                        <td className="py-2 text-center">
                          {puedeGestionar ? (
                            <input type="number" step="0.01" defaultValue={p.calificacion ?? ""} onBlur={(e) => actualizarParticipante(p.id, { calificacion: e.target.value })} className="border border-gray-300 rounded px-1 py-0.5 w-16 text-center" />
                          ) : (p.calificacion ?? "—")}
                        </td>
                        <td className="py-2 text-center">
                          {puedeGestionar ? (
                            <input type="checkbox" checked={!!p.aprobado} onChange={(e) => actualizarParticipante(p.id, { aprobado: e.target.checked })} />
                          ) : (p.aprobado ? "Sí" : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
