"use client";

/**
 * Asistencia → Carga rápida: la jornada de todo un departamento en una tabla, como una
 * hoja de cálculo. Enter o ↓ bajan a la misma columna de la fila siguiente, ↑ sube,
 * Tab avanza; Ctrl+S guarda. Sólo se envían las filas que cambiaron, en un lote, y cada
 * una muestra su resultado (horas normales y extra) o el motivo por el que no se guardó.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import { useAvisos } from "@/components/ui/Avisos";

export interface FilaCarga {
  empleadoId: string;
  codigo: string;
  nombre: string;
  departamento: string;
  /** "HH:MM" o "" */
  entrada: string;
  salida: string;
  /** Minutos de almuerzo; "" = el del turno. */
  almuerzo: string;
  ausente: boolean;
  observacion: string;
  horasNormales: number | null;
  horasExtra: number | null;
  /** De dónde salió lo guardado: BIOMETRICO, MANUAL o PLANTILLA; null = sin marcaje. */
  fuente: string | null;
}

type Editable = Pick<FilaCarga, "entrada" | "salida" | "almuerzo" | "ausente" | "observacion">;
const COLUMNAS = ["entrada", "salida", "almuerzo", "ausente", "observacion"] as const;
type Columna = (typeof COLUMNAS)[number];

interface Resultado {
  ok: boolean;
  error?: string;
  horasNormales?: number;
  horasExtra?: number;
}

interface Props {
  fecha: string;
  hoy: string;
  sucursalId: string;
  departamentoId: string;
  sucursales: { id: string; nombre: string }[];
  departamentos: { id: string; nombre: string }[];
  filas: FilaCarga[];
}

const editable = (f: FilaCarga): Editable => ({ entrada: f.entrada, salida: f.salida, almuerzo: f.almuerzo, ausente: f.ausente, observacion: f.observacion });
const igual = (a: Editable, b: Editable) => COLUMNAS.every((c) => a[c] === b[c]);
const FUENTE: Record<string, string> = { BIOMETRICO: "Reloj", MANUAL: "Manual", PLANTILLA: "Excel" };

function moverDia(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export default function CargaRapidaClient({ fecha, hoy, sucursalId, departamentoId, sucursales, departamentos, filas }: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [originales, setOriginales] = useState<Record<string, Editable>>(() => Object.fromEntries(filas.map((f) => [f.empleadoId, editable(f)])));
  const [valores, setValores] = useState<Record<string, Editable>>(() => Object.fromEntries(filas.map((f) => [f.empleadoId, editable(f)])));
  const [horas, setHoras] = useState<Record<string, { normales: number | null; extra: number | null }>>(() =>
    Object.fromEntries(filas.map((f) => [f.empleadoId, { normales: f.horasNormales, extra: f.horasExtra }]))
  );
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [buscar, setBuscar] = useState("");
  const [relleno, setRelleno] = useState({ entrada: "", salida: "", almuerzo: "" });
  const [guardando, setGuardando] = useState(false);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return q ? filas.filter((f) => f.nombre.toLowerCase().includes(q) || f.codigo.toLowerCase().includes(q)) : filas;
  }, [filas, buscar]);
  const cambiadas = useMemo(() => filas.filter((f) => !igual(valores[f.empleadoId], originales[f.empleadoId])).map((f) => f.empleadoId), [filas, valores, originales]);

  // Al salir con cambios sin guardar, el navegador pregunta.
  useEffect(() => {
    if (cambiadas.length === 0) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [cambiadas.length]);

  const cambiar = (id: string, col: Columna, valor: string | boolean) => {
    setValores((v) => ({ ...v, [id]: { ...v[id], [col]: valor, ...(col === "ausente" && valor === true ? { entrada: "", salida: "", almuerzo: "" } : {}) } }));
    setResultados((r) => {
      if (!r[id]) return r;
      const { [id]: _quitado, ...resto } = r;
      void _quitado;
      return resto;
    });
  };

  const guardar = useCallback(async () => {
    if (cambiadas.length === 0 || guardando) return;
    const lote = cambiadas.map((id) => {
      const v = valores[id];
      const instante = (hhmm: string) => (hhmm ? new Date(`${fecha}T${hhmm}:00`).toISOString() : null);
      return {
        empleadoId: id,
        fecha,
        horaEntrada: v.ausente ? null : instante(v.entrada),
        horaSalida: v.ausente ? null : instante(v.salida),
        esAusencia: v.ausente,
        observacion: v.observacion.trim() || null,
        ...(v.almuerzo.trim() !== "" && !v.ausente ? { minutosDescanso: Number(v.almuerzo) } : {}),
      };
    });
    setGuardando(true);
    try {
      const r = await fetch("/api/marcajes/lote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filas: lote }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        avisar.error(typeof d.error === "string" ? d.error : "No se pudo guardar. Revise los datos.");
        return;
      }
      const porId: Record<string, Resultado> = {};
      for (const x of d.resultados as (Resultado & { empleadoId: string })[]) porId[x.empleadoId] = x;
      setResultados(porId);
      // Lo guardado pasa a ser el punto de partida; lo que falló sigue marcado.
      setOriginales((o) => {
        const n = { ...o };
        for (const id of cambiadas) if (porId[id]?.ok) n[id] = valores[id];
        return n;
      });
      setHoras((h) => {
        const n = { ...h };
        for (const id of cambiadas) if (porId[id]?.ok) n[id] = { normales: porId[id].horasNormales ?? null, extra: porId[id].horasExtra ?? null };
        return n;
      });
      if (d.conError > 0) avisar.error(`Se guardaron ${d.guardadas}; ${d.conError} con error, marcadas en rojo.`);
      else avisar.exito(`${d.guardadas} ${d.guardadas === 1 ? "jornada guardada" : "jornadas guardadas"}.`);
    } finally {
      setGuardando(false);
    }
  }, [cambiadas, guardando, valores, fecha, avisar]);

  // Ctrl+S (o Cmd+S) guarda sin buscar el botón.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void guardar();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [guardar]);

  /** Enter y ↓ bajan; ↑ sube, en la misma columna. */
  function navegar(e: React.KeyboardEvent<HTMLInputElement>, fila: number, col: Columna) {
    const destino = e.key === "Enter" || e.key === "ArrowDown" ? fila + 1 : e.key === "ArrowUp" ? fila - 1 : null;
    if (destino === null) return;
    const celda = document.querySelector<HTMLInputElement>(`[data-celda="${destino}-${col}"]`);
    if (celda) {
      e.preventDefault();
      celda.focus();
      if (celda.type !== "checkbox") celda.select?.();
    }
  }

  function rellenarVacias() {
    // Se calcula aquí y no dentro del actualizador de estado: React lo ejecuta después,
    // y el aviso decía «no hay filas vacías» aunque sí las llenara.
    const vacias = visibles.filter((f) => {
      const x = valores[f.empleadoId];
      return !x.ausente && !x.entrada && !x.salida;
    });
    const n = vacias.length;
    setValores((v) => {
      const copia = { ...v };
      for (const f of vacias) {
        copia[f.empleadoId] = { ...copia[f.empleadoId], entrada: relleno.entrada, salida: relleno.salida, almuerzo: relleno.almuerzo };
      }
      return copia;
    });
    avisar.exito(n > 0 ? `Horario puesto en ${n} ${n === 1 ? "fila vacía" : "filas vacías"}: revise y guarde.` : "No hay filas vacías visibles.");
  }

  function ir(params: { fecha?: string; sucursalId?: string; departamentoId?: string }) {
    if (cambiadas.length > 0 && !window.confirm(`Hay ${cambiadas.length} ${cambiadas.length === 1 ? "fila sin guardar" : "filas sin guardar"}. ¿Salir sin guardarlas?`)) return;
    const q = new URLSearchParams({ fecha, sucursalId, ...(departamentoId ? { departamentoId } : {}), ...params });
    if (params.sucursalId !== undefined) q.delete("departamentoId");
    if (q.get("departamentoId") === "") q.delete("departamentoId");
    router.push(`/asistencia/carga-rapida?${q}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Carga rápida de horas"
        description="La jornada de cada persona en una tabla: escriba entrada y salida (o marque la ausencia) y guarde todo junto. El sistema calcula las horas normales y extra con el turno de cada quien."
        actions={
          <div className="flex gap-2">
            <Link href={`/asistencia?fecha=${fecha}&sucursalId=${sucursalId}`} className="btn btn-secondary">Volver a Asistencia</Link>
            <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || cambiadas.length === 0} data-guardar>
              {guardando ? "Guardando…" : cambiadas.length > 0 ? `Guardar ${cambiadas.length} ${cambiadas.length === 1 ? "cambio" : "cambios"}` : "Sin cambios"}
            </button>
          </div>
        }
      />

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Fecha</span>
          <div className="mt-1 flex items-center gap-1">
            <button className="btn btn-sm btn-ghost" onClick={() => ir({ fecha: moverDia(fecha, -1) })} aria-label="Día anterior">‹</button>
            <input type="date" className="input w-40!" value={fecha} max={hoy} onChange={(e) => e.target.value && ir({ fecha: e.target.value })} />
            <button className="btn btn-sm btn-ghost" onClick={() => ir({ fecha: moverDia(fecha, 1) })} disabled={fecha >= hoy} aria-label="Día siguiente">›</button>
          </div>
        </label>
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Sucursal</span>
          <select className="input mt-1 w-56!" value={sucursalId} onChange={(e) => ir({ sucursalId: e.target.value })}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Departamento</span>
          <select className="input mt-1 w-56!" value={departamentoId} onChange={(e) => ir({ departamentoId: e.target.value })}>
            <option value="">Todos</option>
            {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-medium text-gray-800">Buscar</span>
          <input className="input mt-1 w-48!" placeholder="Nombre o código" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </label>
      </div>

      <div className="panel flex flex-wrap items-end gap-3 p-4 text-sm" data-rellenar>
        <span className="w-full text-gray-700"><b>Rellenar las filas vacías</b> con el mismo horario (no toca las que ya tienen datos ni las ausencias):</span>
        <label>Entrada <input type="time" className="input mt-1 w-32!" value={relleno.entrada} onChange={(e) => setRelleno({ ...relleno, entrada: e.target.value })} aria-label="Entrada para rellenar" /></label>
        <label>Salida <input type="time" className="input mt-1 w-32!" value={relleno.salida} onChange={(e) => setRelleno({ ...relleno, salida: e.target.value })} aria-label="Salida para rellenar" /></label>
        <label>Almuerzo (min) <input type="number" min="0" className="input mt-1 w-24!" placeholder="turno" value={relleno.almuerzo} onChange={(e) => setRelleno({ ...relleno, almuerzo: e.target.value })} aria-label="Almuerzo para rellenar" /></label>
        <button className="btn btn-secondary" disabled={!relleno.entrada || !relleno.salida} onClick={rellenarVacias}>Aplicar a las vacías</button>
      </div>

      {visibles.length === 0 ? (
        <div className="panel">
          <EstadoVacio titulo="No hay empleados activos con este filtro." detalle="Cambie la sucursal o el departamento." />
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table-base" data-carga-rapida>
            <thead className="sticky top-0 bg-white">
              <tr>
                <th>Empleado</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th title="En blanco: el almuerzo del turno">Almuerzo (min)</th>
                <th>Ausente</th>
                <th>Observación</th>
                <th className="num">Normales</th>
                <th className="num">Extra</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f, i) => {
                const v = valores[f.empleadoId];
                const r = resultados[f.empleadoId];
                const sucia = !igual(v, originales[f.empleadoId]);
                const h = horas[f.empleadoId];
                const fondo = r && !r.ok ? "bg-red-50" : sucia ? "bg-amber-50" : r?.ok ? "bg-green-50" : "";
                const celda = (col: Columna) => ({ "data-celda": `${i}-${col}`, onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => navegar(e, i, col) });
                return (
                  <tr key={f.empleadoId} className={fondo} data-fila-empleado={f.codigo}>
                    <td className="whitespace-nowrap">
                      <div className="text-gray-900">{f.nombre}</div>
                      <div className="text-xs text-gray-500">{f.codigo} · {f.departamento}</div>
                    </td>
                    <td><input type="time" className="input w-28! py-1" value={v.entrada} disabled={v.ausente} onChange={(e) => cambiar(f.empleadoId, "entrada", e.target.value)} aria-label={`Entrada de ${f.nombre}`} {...celda("entrada")} /></td>
                    <td><input type="time" className="input w-28! py-1" value={v.salida} disabled={v.ausente} onChange={(e) => cambiar(f.empleadoId, "salida", e.target.value)} aria-label={`Salida de ${f.nombre}`} {...celda("salida")} /></td>
                    <td><input type="number" min="0" max="240" className="input w-20! py-1 text-right" placeholder="turno" value={v.almuerzo} disabled={v.ausente} onChange={(e) => cambiar(f.empleadoId, "almuerzo", e.target.value)} aria-label={`Almuerzo de ${f.nombre}`} {...celda("almuerzo")} /></td>
                    <td className="text-center"><input type="checkbox" checked={v.ausente} onChange={(e) => cambiar(f.empleadoId, "ausente", e.target.checked)} aria-label={`Ausente: ${f.nombre}`} {...celda("ausente")} /></td>
                    <td><input className="input w-48! py-1" value={v.observacion} maxLength={500} onChange={(e) => cambiar(f.empleadoId, "observacion", e.target.value)} aria-label={`Observación de ${f.nombre}`} {...celda("observacion")} /></td>
                    <td className="num tnum">{h.normales === null || sucia ? "" : h.normales.toFixed(2)}</td>
                    <td className="num tnum">{h.extra === null || sucia ? "" : h.extra > 0 ? h.extra.toFixed(2) : "—"}</td>
                    <td className="text-xs" data-estado-fila>
                      {r && !r.ok ? (
                        <span className="text-red-700">{r.error}</span>
                      ) : sucia ? (
                        <span className="text-amber-800">Sin guardar</span>
                      ) : r?.ok ? (
                        <span className="text-green-800">Guardado</span>
                      ) : f.fuente ? (
                        <span className="text-gray-500">{FUENTE[f.fuente] ?? f.fuente}</span>
                      ) : (
                        <span className="text-gray-400">Sin registro</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Enter o ↓ bajan a la misma columna; ↑ sube; Ctrl+S guarda. Corregir un día que vino del reloj lo deja como manual: la
        siguiente sincronización ya no lo pisa. Un día que ya está en una planilla aprobada o pagada no se puede cambiar.
      </p>
    </div>
  );
}
