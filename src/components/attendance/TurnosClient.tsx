"use client";

/**
 * Horarios y turnos: catálogo de turnos y asignación.
 *
 * El turno decide cuántas horas ordinarias tiene cada día (por encima empieza
 * la extra), cuánto almuerzo se descuenta si nadie lo marcó, desde qué hora es
 * una llegada tarde y si la jornada termina al día siguiente. Quien no tiene
 * turno asignado usa el turno por omisión; sin él, el diurno de 8 horas.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/utils";
import {
  validarTurno,
  describirTurno,
  MAX_HORAS_JORNADA,
  ETIQUETA_JORNADA,
  parseDias,
  type TipoJornada,
} from "@/lib/asistencia/turnos-reglas";

interface Turno {
  id: string;
  codigo: string;
  nombre: string;
  tipoJornada: TipoJornada;
  horaEntrada: string;
  horaSalida: string;
  jornadaHoras: number;
  almuerzoMinutos: number;
  almuerzoDesdeHoras: number;
  toleranciaMinutos: number;
  diasLaborales: string;
  esPorDefecto: boolean;
  activo: boolean;
  empleadosHoy: number;
}

interface EmpleadoTurno {
  id: string;
  codigo: string;
  primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null;
  departamento: { id: string; nombre: string };
  sucursal: { id: string; nombre: string };
  turno: { id: string; nombre: string; codigo: string } | null;
  desde: string | null;
  origen: "ASIGNADO" | "POR_DEFECTO" | "DIURNO_IMPLICITO";
}

const DIAS = [
  [1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [7, "Dom"],
] as const;

const vacio = {
  codigo: "", nombre: "", tipoJornada: "DIURNA" as TipoJornada, horaEntrada: "08:00", horaSalida: "17:00",
  jornadaHoras: 8, almuerzoMinutos: 60, almuerzoDesdeHoras: 6, toleranciaMinutos: 5, diasLaborales: "1,2,3,4,5",
  esPorDefecto: false, activo: true,
};

const nombreEmp = (e: EmpleadoTurno) => [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Tegucigalpa" });

export default function TurnosClient({ puedeEditar, departamentos, sucursales }: { puedeEditar: boolean; departamentos: { id: string; nombre: string }[]; sucursales: { id: string; nombre: string }[] }) {
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [empleados, setEmpleados] = useState<EmpleadoTurno[]>([]);
  const [porDefecto, setPorDefecto] = useState<{ nombre: string } | null>(null);
  const [edicion, setEdicion] = useState<(typeof vacio & { id?: string }) | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [asig, setAsig] = useState({ turnoId: "", desde: hoy(), alcance: "seleccion" as "seleccion" | "departamento" | "sucursal", departamentoId: "", sucursalId: "" });
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [buscar, setBuscar] = useState("");

  const cargar = useCallback(async () => {
    const [rt, ra] = await Promise.all([fetch("/api/turnos", { cache: "no-store" }), fetch("/api/turnos/asignaciones", { cache: "no-store" })]);
    if (rt.ok) setTurnos(await rt.json());
    if (ra.ok) {
      const d = await ra.json();
      setEmpleados(d.empleados);
      setPorDefecto(d.porDefecto);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const validacion = useMemo(() => (edicion ? validarTurno(edicion) : null), [edicion]);

  async function guardar() {
    if (!edicion || !validacion || validacion.errores.length) return;
    const { id, ...cuerpo } = edicion;
    const res = await fetch(id ? `/api/turnos/${id}` : "/api/turnos", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await res.json();
    if (!res.ok) {
      const campos = d.detalles ? Object.entries(d.detalles).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`) : [];
      setAviso({ ok: false, texto: [d.error ?? "No se pudo guardar", ...campos].join(" ") });
      return;
    }
    setAviso({ ok: true, texto: `Turno ${cuerpo.nombre} guardado.${d.avisos?.length ? ` ${d.avisos.join(" ")}` : ""}` });
    setEdicion(null);
    await cargar();
  }

  async function borrar(t: Turno) {
    if (!confirm(`¿Borrar el turno ${t.nombre}?`)) return;
    const res = await fetch(`/api/turnos/${t.id}`, { method: "DELETE" });
    const d = await res.json();
    setAviso(res.ok ? { ok: true, texto: "Turno borrado." } : { ok: false, texto: d.error ?? "No se pudo borrar" });
    await cargar();
  }

  async function asignar() {
    const cuerpo: Record<string, unknown> = { turnoId: asig.turnoId, desde: asig.desde };
    if (asig.alcance === "seleccion") cuerpo.empleadoIds = [...seleccion];
    if (asig.alcance === "departamento") cuerpo.departamentoId = asig.departamentoId;
    if (asig.alcance === "sucursal") cuerpo.sucursalId = asig.sucursalId;
    const res = await fetch("/api/turnos/asignaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await res.json();
    setAviso(res.ok ? { ok: true, texto: `Turno asignado a ${d.asignados} empleado(s) desde el ${formatDate(asig.desde)}.` } : { ok: false, texto: d.error ?? "No se pudo asignar" });
    if (res.ok) {
      setSeleccion(new Set());
      await cargar();
    }
  }

  const filtrados = empleados.filter((e) => !buscar.trim() || `${nombreEmp(e)} ${e.codigo} ${e.departamento.nombre}`.toLowerCase().includes(buscar.trim().toLowerCase()));
  const activos = (turnos ?? []).filter((t) => t.activo);
  const puedeAsignar = puedeEditar && asig.turnoId && asig.desde && (asig.alcance === "seleccion" ? seleccion.size > 0 : asig.alcance === "departamento" ? !!asig.departamentoId : !!asig.sucursalId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Horarios y turnos"
        description={`El turno decide desde qué hora se paga la hora extra, el almuerzo que se descuenta y la puntualidad. Sin asignación se usa ${porDefecto ? `el turno por omisión (${porDefecto.nombre})` : "el diurno de 8 horas"}.`}
        actions={puedeEditar ? <button type="button" className="btn btn-primary" onClick={() => setEdicion({ ...vacio })}>Nuevo turno</button> : undefined}
      />

      {aviso && <div role="status" className={`rounded-md border px-3 py-2 text-sm ${aviso.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>{aviso.texto}</div>}

      {edicion && (
        <section className="panel space-y-4 p-6" aria-labelledby="turno-edicion">
          <h2 id="turno-edicion" className="text-base font-semibold text-gray-900">{edicion.id ? `Editar ${edicion.nombre}` : "Nuevo turno"}</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-codigo">Código</label><input id="t-codigo" className="input" value={edicion.codigo} onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value.toUpperCase() })} /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-nombre">Nombre</label><input id="t-nombre" className="input" value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} /></div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-jornada">Jornada</label>
              <select id="t-jornada" className="input" value={edicion.tipoJornada} onChange={(e) => { const tipo = e.target.value as TipoJornada; setEdicion({ ...edicion, tipoJornada: tipo, jornadaHoras: Math.min(edicion.jornadaHoras, MAX_HORAS_JORNADA[tipo]) }); }}>
                {(Object.keys(MAX_HORAS_JORNADA) as TipoJornada[]).map((t) => <option key={t} value={t}>{ETIQUETA_JORNADA[t]} (hasta {MAX_HORAS_JORNADA[t]} h)</option>)}
              </select>
            </div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-entrada">Entrada</label><input id="t-entrada" type="time" className="input" value={edicion.horaEntrada} onChange={(e) => setEdicion({ ...edicion, horaEntrada: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-salida">Salida</label><input id="t-salida" type="time" className="input" value={edicion.horaSalida} onChange={(e) => setEdicion({ ...edicion, horaSalida: e.target.value })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-horas">Horas ordinarias</label><input id="t-horas" type="number" step="0.5" min={0.5} max={MAX_HORAS_JORNADA[edicion.tipoJornada]} className="input" value={edicion.jornadaHoras} onChange={(e) => setEdicion({ ...edicion, jornadaHoras: Number(e.target.value) })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-tol">Tolerancia de llegada (min)</label><input id="t-tol" type="number" min={0} max={60} className="input" value={edicion.toleranciaMinutos} onChange={(e) => setEdicion({ ...edicion, toleranciaMinutos: Number(e.target.value) })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-alm">Almuerzo (min)</label><input id="t-alm" type="number" min={0} max={180} className="input" value={edicion.almuerzoMinutos} onChange={(e) => setEdicion({ ...edicion, almuerzoMinutos: Number(e.target.value) })} /></div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="t-almdesde">Almuerzo si la jornada pasa de (h)</label><input id="t-almdesde" type="number" step="0.5" min={0} max={12} className="input" value={edicion.almuerzoDesdeHoras} onChange={(e) => setEdicion({ ...edicion, almuerzoDesdeHoras: Number(e.target.value) })} /></div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 block text-xs font-medium text-gray-700">Días laborales</legend>
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map(([n, l]) => {
                  const dias = parseDias(edicion.diasLaborales);
                  const on = dias.includes(n);
                  return (
                    <button key={n} type="button" aria-pressed={on} onClick={() => setEdicion({ ...edicion, diasLaborales: (on ? dias.filter((d) => d !== n) : [...dias, n]).sort().join(",") })}
                      className={`rounded-md border px-2.5 py-1 text-sm ${on ? "border-blue-600 bg-blue-50 text-blue-900" : "border-gray-300 text-gray-600"}`}>{l}</button>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-gray-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.esPorDefecto} onChange={(e) => setEdicion({ ...edicion, esPorDefecto: e.target.checked })} />Turno por omisión (para quien no tenga asignación)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edicion.activo} onChange={(e) => setEdicion({ ...edicion, activo: e.target.checked })} />Activo</label>
          </div>
          {validacion && (
            <div className="space-y-1 text-sm">
              {validacion.errores.length === 0 && <p className="text-gray-600">Horario: jornada {describirTurno(edicion).jornada}, {describirTurno(edicion).horario}.</p>}
              {validacion.errores.map((e) => <p key={e} className="text-red-700">{e}</p>)}
              {validacion.avisos.map((a) => <p key={a} className="text-amber-800">{a}</p>)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setEdicion(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!validacion || validacion.errores.length > 0 || !edicion.codigo || !edicion.nombre}>Guardar turno</button>
          </div>
        </section>
      )}

      <section className="panel overflow-hidden" aria-label="Turnos">
        {turnos === null ? (
          <p className="p-6 text-sm text-gray-400">Cargando…</p>
        ) : turnos.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No hay turnos definidos: todos usan el diurno de 8 horas, de 08:00 a 17:00 con una hora de almuerzo. {puedeEditar ? "Cree turnos si hay horarios distintos o jornadas nocturnas." : ""}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr><th className="px-4">Turno</th><th className="px-4">Horario</th><th className="num px-4">Ordinarias</th><th className="num px-4">Almuerzo</th><th className="num px-4">Tolerancia</th><th className="num px-4">Empleados hoy</th><th className="px-4" /></tr>
              </thead>
              <tbody>
                {turnos.map((t) => (
                  <tr key={t.id} className={t.activo ? "" : "text-gray-400"}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-900">{t.nombre}</span> <span className="font-mono text-xs text-gray-500">{t.codigo}</span>
                      <span className="block text-xs text-gray-500">Jornada {ETIQUETA_JORNADA[t.tipoJornada]}{t.esPorDefecto ? ", por omisión" : ""}{t.activo ? "" : ", inactivo"}</span>
                    </td>
                    <td className="px-4 py-2.5">{describirTurno(t).horario}</td>
                    <td className="num px-4 py-2.5">{t.jornadaHoras} h</td>
                    <td className="num px-4 py-2.5">{t.almuerzoMinutos} min</td>
                    <td className="num px-4 py-2.5">{t.toleranciaMinutos} min</td>
                    <td className="num px-4 py-2.5">{t.empleadosHoy}</td>
                    <td className="px-4 py-2.5 text-right">
                      {puedeEditar && (
                        <div className="flex justify-end gap-2">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion({ ...t })}>Editar</button>
                          {t.empleadosHoy === 0 && <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => void borrar(t)}>Borrar</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel space-y-4 p-5" aria-labelledby="turno-asignar">
        <div>
          <h2 id="turno-asignar" className="text-base font-semibold text-gray-900">Turno de cada empleado</h2>
          <p className="text-xs text-gray-500">Asignar cierra la asignación anterior el día antes de la fecha elegida, para que cada día se calcule con el turno que le tocaba.</p>
        </div>
        {puedeEditar && activos.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="a-turno">Turno</label>
              <select id="a-turno" className="input" value={asig.turnoId} onChange={(e) => setAsig({ ...asig, turnoId: e.target.value })}>
                <option value="">Elegir</option>
                {activos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="a-desde">Desde</label><input id="a-desde" type="date" className="input" value={asig.desde} onChange={(e) => setAsig({ ...asig, desde: e.target.value })} /></div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="a-alcance">A quiénes</label>
              <select id="a-alcance" className="input" value={asig.alcance} onChange={(e) => setAsig({ ...asig, alcance: e.target.value as typeof asig.alcance })}>
                <option value="seleccion">Los marcados en la lista ({seleccion.size})</option>
                <option value="departamento">Todo un departamento</option>
                <option value="sucursal">Toda una sucursal</option>
              </select>
            </div>
            {asig.alcance === "departamento" && (
              <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="a-depto">Departamento</label>
                <select id="a-depto" className="input" value={asig.departamentoId} onChange={(e) => setAsig({ ...asig, departamentoId: e.target.value })}><option value="">Elegir</option>{departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select></div>
            )}
            {asig.alcance === "sucursal" && (
              <div><label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="a-suc">Sucursal</label>
                <select id="a-suc" className="input" value={asig.sucursalId} onChange={(e) => setAsig({ ...asig, sucursalId: e.target.value })}><option value="">Elegir</option>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></div>
            )}
            <button type="button" className="btn btn-primary" onClick={() => void asignar()} disabled={!puedeAsignar}>Asignar turno</button>
          </div>
        )}
        <input className="input max-w-sm" placeholder="Buscar por nombre, código o departamento" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar empleado" />
        <div className="max-h-[28rem] overflow-auto">
          <table className="table-base text-sm">
            <thead>
              <tr>
                {puedeEditar && <th className="w-8 px-3"><input type="checkbox" aria-label="Marcar todos" checked={filtrados.length > 0 && filtrados.every((e) => seleccion.has(e.id))} onChange={(e) => setSeleccion(e.target.checked ? new Set(filtrados.map((x) => x.id)) : new Set())} /></th>}
                <th className="px-3">Empleado</th><th className="px-3">Departamento</th><th className="px-3">Turno hoy</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => (
                <tr key={e.id}>
                  {puedeEditar && <td className="px-3"><input type="checkbox" aria-label={`Marcar a ${nombreEmp(e)}`} checked={seleccion.has(e.id)} onChange={(ev) => setSeleccion((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} /></td>}
                  <td className="px-3 py-2">{nombreEmp(e)}<span className="block text-xs text-gray-500">{e.codigo}</span></td>
                  <td className="px-3 py-2">{e.departamento.nombre}<span className="block text-xs text-gray-500">{e.sucursal.nombre}</span></td>
                  <td className="px-3 py-2">
                    {e.turno ? `${e.turno.nombre}` : e.origen === "POR_DEFECTO" ? `${porDefecto?.nombre ?? ""} (por omisión)` : "Diurno 8 h (sin turno)"}
                    {e.desde && <span className="block text-xs text-gray-500">desde el {formatDate(e.desde)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
