"use client";

import { useCallback, useEffect, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import { formatCurrency, formatDate } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge, { type Tono } from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import FranjaCifras from "@/components/ui/FranjaCifras";
import { Campo } from "@/components/ui/ModalForm";
import MaterialCapacitacionPanel from "./MaterialCapacitacionPanel";

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
  /** Sólo con permiso de datos personales. */
  identidad: string | null;
  asistio: boolean;
  aprobado: boolean | null;
  calificacion: string | number | null;
}

interface Props {
  empleados: { id: string; nombre: string }[];
  puedeGestionar: boolean;
}

const estadoBadge: Record<string, { etiqueta: string; tono: Tono }> = {
  PLANIFICADA: { etiqueta: "Planificada", tono: "marca" },
  EN_CURSO: { etiqueta: "En curso", tono: "aviso" },
  FINALIZADA: { etiqueta: "Finalizada", tono: "ok" },
  CANCELADA: { etiqueta: "Cancelada", tono: "neutro" },
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
  const { avisar } = useAvisos();
  const [lista, setLista] = useState<Capacitacion[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [msg, setMsg] = useState("");

  const [f, setF] = useState({ nombre: "", tipo: "INTERNA", proveedor: "", fechaInicio: "", fechaFin: "", costoPresupuestado: "", descripcion: "" });
  const [nuevoEmp, setNuevoEmp] = useState("");
  const [dni, setDni] = useState("");

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
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error ?? "Error al crear."); return; }
    setF({ nombre: "", tipo: "INTERNA", proveedor: "", fechaInicio: "", fechaFin: "", costoPresupuestado: "", descripcion: "" });
    setCreando(false); await cargar();
  }

  // Campos editables desde la tabla. `costoReal` viaja como string porque sale
  // directo de un <input type="number">; el schema del endpoint lo coacciona.
  async function actualizar(id: string, data: { estado?: string; costoReal?: string }) {
    await fetch(`/api/capacitaciones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    await cargar();
  }

  async function inscribir(porDni = false) {
    if (!sel || (porDni ? !dni.trim() : !nuevoEmp)) return;
    const cuerpo = porDni ? { identidad: dni.trim() } : { empleadoId: nuevoEmp };
    const res = await fetch(`/api/capacitaciones/${sel}/participantes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    if (!res.ok) { avisar.error((await res.json().catch(() => ({}))).error ?? "No se pudo inscribir."); return; }
    setNuevoEmp(""); setDni(""); await cargarDetalle(sel); await cargar();
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
  const empDisponibles = empleados.filter((e) => !participantes.some((p) => p.empleadoId === e.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capacitación"
        description="Programas de formación y control de presupuesto."
        actions={
          puedeGestionar && (
            <button onClick={() => setCreando((v) => !v)} className={creando ? "btn btn-secondary" : "btn btn-primary"}>
              {creando ? "Cancelar" : "Nueva capacitación"}
            </button>
          )
        }
      />

      <FranjaCifras
        etiqueta="Resumen del presupuesto"
        cifras={[
          { label: "Presupuestado (total)", valor: formatCurrency(totPresup) },
          { label: "Ejecutado (total)", valor: formatCurrency(totReal) },
          { label: "Disponible", valor: formatCurrency(totPresup - totReal), destacada: true },
        ]}
      />

      {msg && <p className="text-sm text-red-700" role="alert">{msg}</p>}

      {creando && puedeGestionar && (
        <form onSubmit={crear} className="panel grid gap-4 p-5 md:grid-cols-2">
          <Campo etiqueta="Nombre"><input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Tipo">
            <select className="input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="INTERNA">Interna</option><option value="EXTERNA">Externa</option>
            </select>
          </Campo>
          <Campo etiqueta="Proveedor"><input className="input" value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /></Campo>
          <Campo etiqueta="Costo presupuestado"><input type="number" className="input" value={f.costoPresupuestado} onChange={(e) => setF({ ...f, costoPresupuestado: e.target.value })} /></Campo>
          <Campo etiqueta="Fecha de inicio"><input type="date" className="input" value={f.fechaInicio} onChange={(e) => setF({ ...f, fechaInicio: e.target.value })} /></Campo>
          <Campo etiqueta="Fecha de fin"><input type="date" className="input" value={f.fechaFin} onChange={(e) => setF({ ...f, fechaFin: e.target.value })} /></Campo>
          <div className="md:col-span-2"><Campo etiqueta="Descripción"><textarea rows={2} className="input" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo></div>
          <div className="md:col-span-2"><button type="submit" className="btn btn-primary">Guardar</button></div>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">Programas</div>
          {loading ? <p className="p-5 text-sm text-gray-500">Cargando…</p> : lista.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay capacitaciones."
              detalle={puedeGestionar ? "Registre el primer programa de formación con su presupuesto." : "Cuando Recursos Humanos registre una, aparecerá aquí."}
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {lista.map((c) => {
                const real = Number(c.costoReal ?? 0), pres = Number(c.costoPresupuestado);
                const est = estadoBadge[c.estado];
                return (
                  <li key={c.id} className={`cursor-pointer px-5 py-3 hover:bg-gray-50 ${sel === c.id ? "bg-blue-50" : ""}`} onClick={() => setSel(c.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{c.nombre}</p>
                        <p className="text-xs text-gray-500">
                          {c.tipo === "INTERNA" ? "Interna" : "Externa"}, {formatDate(c.fechaInicio)}, {c._count.participantes} participante(s)
                          {c.proveedor ? `, ${c.proveedor}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          Presupuesto {formatCurrency(pres)}
                          {c.costoReal != null && `, real ${formatCurrency(real)}`}
                        </p>
                      </div>
                      {est ? <EstadoBadge valor={c.estado} etiqueta={est.etiqueta} tono={est.tono} /> : <EstadoBadge valor={c.estado} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">
            {capSel ? `Detalle: ${capSel.nombre}` : "Seleccione un programa"}
          </div>
          {!sel || !capSel ? (
            <EstadoVacio titulo="Ningún programa elegido." detalle="Elija un programa de la lista para gestionar participantes y costo." />
          ) : (
            <div className="space-y-3 p-4">
              {puedeGestionar && (
                <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 pb-3">
                  <select aria-label="Estado del programa" className="input w-auto!" value={capSel.estado} onChange={(e) => actualizar(sel, { estado: e.target.value })}>
                    {ESTADOS.map((es) => <option key={es} value={es}>{estadoBadge[es]?.etiqueta ?? es}</option>)}
                  </select>
                  <label className="block text-xs text-gray-500">
                    Costo real
                    <input type="number" defaultValue={capSel.costoReal ?? ""} onBlur={(e) => actualizar(sel, { costoReal: e.target.value })} className="input mt-1 w-32!" placeholder="ejecutado" />
                  </label>
                </div>
              )}
              {puedeGestionar && (
                <div className="flex gap-2 border-b border-gray-100 pb-3">
                  <select aria-label="Inscribir empleado" className="input flex-1" value={nuevoEmp} onChange={(e) => setNuevoEmp(e.target.value)}>
                    <option value="">Inscribir empleado…</option>
                    {empDisponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                  <button onClick={() => void inscribir()} className="btn btn-secondary">Inscribir</button>
                </div>
              )}
              {puedeGestionar && (
                <div className="flex gap-2 border-b border-gray-100 pb-3">
                  <input
                    aria-label="DNI a inscribir"
                    className="input flex-1"
                    placeholder="O inscriba por DNI: 0801-1990-12345"
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void inscribir(true)}
                  />
                  <button onClick={() => void inscribir(true)} className="btn btn-secondary" disabled={!dni.trim()}>Inscribir por DNI</button>
                </div>
              )}
              <MaterialCapacitacionPanel key={sel} capacitacionId={sel} puedeGestionar={puedeGestionar} />
              {participantes.length === 0 ? <p className="text-sm text-gray-500">Este programa todavía no tiene participantes.</p> : (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Empleado</th>
                        <th>Asistió</th>
                        <th>Nota</th>
                        <th>Aprobó</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participantes.map((p) => (
                        <tr key={p.id}>
                          <td>{p.nombre}<div className="text-xs text-gray-500">{p.codigo}{p.identidad ? ` · DNI ${p.identidad}` : ""}</div></td>
                          <td>
                            <input type="checkbox" aria-label={`Asistió: ${p.nombre}`} checked={p.asistio} disabled={!puedeGestionar} onChange={(e) => actualizarParticipante(p.id, { asistio: e.target.checked })} />
                          </td>
                          <td>
                            {puedeGestionar ? (
                              <input type="number" step="0.01" aria-label={`Nota: ${p.nombre}`} defaultValue={p.calificacion ?? ""} onBlur={(e) => actualizarParticipante(p.id, { calificacion: e.target.value })} className="input h-8! w-20! text-center" />
                            ) : (p.calificacion ?? "—")}
                          </td>
                          <td>
                            {puedeGestionar ? (
                              <input type="checkbox" aria-label={`Aprobó: ${p.nombre}`} checked={!!p.aprobado} onChange={(e) => actualizarParticipante(p.id, { aprobado: e.target.checked })} />
                            ) : (p.aprobado ? "Sí" : "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
