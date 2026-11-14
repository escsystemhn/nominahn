"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { nombreCompleto } from "@/lib/utils";
import PageHeader from "@/components/ui/PageHeader";
import EstadoVacio from "@/components/ui/EstadoVacio";
import EstadoBadge, { type Tono } from "@/components/ui/EstadoBadge";
import { Campo } from "@/components/ui/ModalForm";
import { calificacionPonderada, estanTodosCalificados } from "@/lib/evaluaciones/calificacion";
import { ETIQUETA_ORIGEN, type Aspecto, type AspectosEvaluacion } from "@/lib/evaluaciones/aspectos";

// Date cuando lo pasa el server component; string ISO cuando viene del JSON de
// /api/evaluaciones. Ambas fuentes son reales, así que el tipo las admite.
type FechaSerializable = Date | string;

interface CriterioGuardado {
  competenciaId: string | null;
  criterio: string;
  calificacion: number;
  peso: number;
}

interface Evaluacion {
  id: string;
  tipo: string;
  periodo: string;
  calificacion: number;
  estado: string;
  comentarios: string | null;
  fortalezas: string | null;
  mejoras: string | null;
  objetivos: string | null;
  potencial: number | null;
  bonoMonto: number | null;
  createdAt: FechaSerializable;
  criterios: CriterioGuardado[];
  /** Evaluadores con enlace (360°). Con evaluadores, las notas las dan ellos. */
  evaluadores: number;
  empleado: {
    id: string;
    codigo: string;
    primerNombre: string;
    primerApellido: string;
    sucursal: { nombre: string };
    departamento: { nombre: string };
    puesto: { nombre: string } | null;
  };
}

interface Props {
  evaluaciones: Evaluacion[];
  empleados: Array<{ id: string; codigo: string; primerNombre: string; segundoNombre?: string | null; primerApellido: string; segundoApellido?: string | null }>;
  permisos: { gestionar: boolean; cerrar: boolean; competencias: boolean };
}

const ESTADO: Record<string, { etiqueta: string; tono: Tono }> = {
  BORRADOR: { etiqueta: "Borrador", tono: "aviso" },
  EN_PROGRESO: { etiqueta: "En progreso", tono: "marca" },
  PENDIENTE_FIRMA: { etiqueta: "Lista para finalizar", tono: "marca" },
  FINALIZADA: { etiqueta: "Finalizada", tono: "ok" },
  CANCELADA: { etiqueta: "Cancelada", tono: "neutro" },
};
const EDITABLE = new Set(["BORRADOR", "EN_PROGRESO", "PENDIENTE_FIRMA"]);

/** Una fila del formulario: el aspecto y lo que se le pone. "" = sin calificar. */
interface Fila extends Aspecto {
  valor: string;
}

const claveDe = (a: { competenciaId: string | null; nombre?: string; criterio?: string }) =>
  a.competenciaId ?? `libre:${(a.nombre ?? a.criterio ?? "").trim().toLowerCase()}`;

/**
 * Las filas al editar: los aspectos que hoy le tocan al empleado, con lo que ya se les
 * había puesto; y al final, lo calificado que ya no está en la configuración (para no
 * perderlo al guardar).
 */
function filasDe(aspectos: Aspecto[], guardados: CriterioGuardado[]): Fila[] {
  const porClave = new Map(guardados.map((c) => [claveDe(c), c]));
  const filas: Fila[] = aspectos.map((a) => {
    const g = porClave.get(claveDe(a));
    porClave.delete(claveDe(a));
    return { ...a, valor: g ? String(g.calificacion) : "" };
  });
  for (const g of porClave.values()) {
    filas.push({ competenciaId: g.competenciaId, nombre: g.criterio, descripcion: null, peso: g.peso, nivelRequerido: null, valor: String(g.calificacion) });
  }
  return filas;
}

const numero = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};

export default function EvaluacionesClient({ evaluaciones, empleados, permisos }: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [tipoFiltro, setTipoFiltro] = useState("TODOS");

  // Formulario: null = cerrado; editando = id de la evaluación (o null si es nueva).
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<Evaluacion | null>(null);
  const [form, setForm] = useState({ empleadoId: "", tipo: "DESEMPENO_MENSUAL", periodo: "", comentarios: "", fortalezas: "", mejoras: "", objetivos: "", potencial: "" });
  const [filas, setFilas] = useState<Fila[]>([]);
  const [origen, setOrigen] = useState<AspectosEvaluacion["origen"] | null>(null);
  const [cargandoAspectos, setCargandoAspectos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accionando, setAccionando] = useState<string | null>(null);

  const visibles = tipoFiltro === "TODOS" ? evaluaciones : evaluaciones.filter((e) => e.tipo === tipoFiltro);
  const puntuados = filas.map((f) => ({ calificacion: numero(f.valor), peso: f.peso }));
  const nota = calificacionPonderada(puntuados);
  const completa = estanTodosCalificados(puntuados);

  async function cargarAspectos(empleadoId: string, tipo: string, guardados: CriterioGuardado[]) {
    if (!empleadoId) {
      setFilas([]);
      setOrigen(null);
      return;
    }
    setCargandoAspectos(true);
    try {
      const r = await fetch(`/api/evaluaciones/aspectos?empleadoId=${encodeURIComponent(empleadoId)}&tipo=${tipo}`);
      if (!r.ok) throw new Error();
      const d = (await r.json()) as AspectosEvaluacion;
      setFilas(filasDe(d.aspectos, guardados));
      setOrigen(d.origen);
    } catch {
      setError("No se pudieron cargar los aspectos a evaluar.");
    } finally {
      setCargandoAspectos(false);
    }
  }

  function nueva() {
    setEditando(null);
    setForm({ empleadoId: "", tipo: "DESEMPENO_MENSUAL", periodo: "", comentarios: "", fortalezas: "", mejoras: "", objetivos: "", potencial: "" });
    setFilas([]);
    setOrigen(null);
    setError(null);
    setAbierto(true);
  }

  function editar(ev: Evaluacion) {
    setEditando(ev);
    setForm({
      empleadoId: ev.empleado.id,
      tipo: ev.tipo,
      periodo: ev.periodo,
      comentarios: ev.comentarios ?? "",
      fortalezas: ev.fortalezas ?? "",
      mejoras: ev.mejoras ?? "",
      objetivos: ev.objetivos ?? "",
      potencial: ev.potencial === null ? "" : String(ev.potencial),
    });
    setError(null);
    setAbierto(true);
    void cargarAspectos(ev.empleado.id, ev.tipo, ev.criterios);
  }

  async function guardar() {
    setError(null);
    const criterios = filas.map((f) => ({ criterio: f.nombre, competenciaId: f.competenciaId, peso: f.peso, calificacion: numero(f.valor) }));
    const potencial = form.potencial.trim() === "" ? undefined : Number(form.potencial);
    const textos = { comentarios: form.comentarios, fortalezas: form.fortalezas, mejoras: form.mejoras, objetivos: form.objetivos };
    setGuardando(true);
    try {
      const res = editando
        ? await fetch(`/api/evaluaciones/${editando.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...textos, ...(potencial !== undefined ? { potencial } : {}), ...(editando.evaluadores === 0 ? { criterios } : {}) }),
          })
        : await fetch("/api/evaluaciones", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modo: "DIRECTA", empleadoId: form.empleadoId, tipo: form.tipo, periodo: form.periodo.trim(), ...textos, potencial, criterios }),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : "No se pudo guardar la evaluación. Revise los datos.");
        return;
      }
      setAbierto(false);
      avisar.exito(completa ? "Evaluación guardada: lista para finalizar." : "Evaluación guardada como borrador.");
      router.refresh();
    } catch {
      setError("No se pudo guardar la evaluación. Intente nuevamente.");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(ev: Evaluacion, nuevoEstado: "FINALIZADA" | "CANCELADA") {
    const pregunta =
      nuevoEstado === "FINALIZADA"
        ? `¿Finalizar la evaluación de ${ev.empleado.primerNombre} ${ev.empleado.primerApellido}? Ya no se podrá editar, y su calificación cuenta para el bono.`
        : `¿Cancelar la evaluación de ${ev.empleado.primerNombre} ${ev.empleado.primerApellido}?`;
    if (!window.confirm(pregunta)) return;
    setAccionando(ev.id);
    try {
      const res = await fetch(`/api/evaluaciones/${ev.id}/estado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nuevoEstado }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        avisar.error(typeof d.error === "string" ? d.error : "No se pudo cambiar el estado.");
        return;
      }
      avisar.exito(nuevoEstado === "FINALIZADA" ? `Evaluación finalizada con ${Number(d.calificacion).toFixed(1)}.` : "Evaluación cancelada.");
      router.refresh();
    } finally {
      setAccionando(null);
    }
  }

  function colorCalif(n: number) {
    if (n >= 80) return "text-green-700";
    if (n >= 60) return "text-amber-700";
    return "text-red-600";
  }

  const evaluables = (ev: Evaluacion) => permisos.gestionar && EDITABLE.has(ev.estado);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evaluaciones"
        description="Desempeño mensual y competencias trimestrales. La calificación es el promedio de los aspectos, cada uno con su peso."
        actions={
          <div className="flex gap-2">
            {permisos.competencias && (
              <Link href="/talento/competencias" className="btn btn-secondary">
                Aspectos a evaluar
              </Link>
            )}
            {permisos.gestionar && (
              <button onClick={nueva} className="btn btn-primary">
                Nueva evaluación
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de evaluación">
        {["TODOS", "DESEMPENO_MENSUAL", "COMPETENCIA_TRIMESTRAL"].map((t) => (
          <button
            key={t}
            onClick={() => setTipoFiltro(t)}
            aria-pressed={tipoFiltro === t}
            className={`btn btn-sm btn-secondary ${tipoFiltro === t ? "border-blue-500 bg-blue-50 text-blue-800" : ""}`}
          >
            {t === "TODOS" ? "Todas" : t === "DESEMPENO_MENSUAL" ? "Desempeño mensual" : "Competencias trimestrales"}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="panel">
          <EstadoVacio
            titulo="Todavía no hay evaluaciones."
            detalle="Registre la primera con el botón «Nueva evaluación», o cambie el filtro para ver las de otro tipo."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibles.map((ev) => {
            const estado = ESTADO[ev.estado] ?? { etiqueta: ev.estado, tono: "neutro" as Tono };
            const sinNota = ev.criterios.length === 0 && ev.calificacion === 0 && ev.estado !== "FINALIZADA";
            return (
              <div key={ev.id} className="panel p-5" data-evaluacion={ev.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{ev.empleado.primerNombre} {ev.empleado.primerApellido}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {ev.empleado.puesto ? `${ev.empleado.puesto.nombre} · ` : ""}{ev.empleado.sucursal.nombre}, {ev.empleado.departamento.nombre}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                      <span>{ev.tipo === "DESEMPENO_MENSUAL" ? "Desempeño" : "Competencia"}, {ev.periodo}</span>
                      <EstadoBadge valor={ev.estado} etiqueta={estado.etiqueta} tono={estado.tono} />
                    </p>
                  </div>
                  <div className="text-right">
                    {sinNota ? (
                      <p className="text-sm text-gray-500">{ev.evaluadores > 0 ? "Esperando a los evaluadores" : "Sin calificar"}</p>
                    ) : (
                      <>
                        <p className={`tnum text-3xl font-semibold ${colorCalif(ev.calificacion)}`} data-calificacion>
                          {ev.calificacion.toFixed(1)}
                        </p>
                        <p className="text-xs text-gray-500">de 100</p>
                      </>
                    )}
                  </div>
                </div>

                {ev.criterios.length > 0 && (
                  <ul className="mt-3 space-y-0.5 text-xs text-gray-600">
                    {ev.criterios.map((c) => (
                      <li key={claveDe(c)} className="flex justify-between gap-2">
                        <span>{c.criterio}{c.peso !== 1 ? ` (peso ${c.peso})` : ""}</span>
                        <span className="tnum">{c.calificacion.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {ev.comentarios && <p className="mt-3 line-clamp-2 text-sm text-gray-600">{ev.comentarios}</p>}
                {ev.fortalezas && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-gray-700">Fortalezas:</p>
                    <p className="text-xs text-gray-500">{ev.fortalezas}</p>
                  </div>
                )}
                {ev.mejoras && (
                  <div className="mt-1">
                    <p className="text-xs font-medium text-gray-700">Áreas de mejora:</p>
                    <p className="text-xs text-gray-500">{ev.mejoras}</p>
                  </div>
                )}
                {ev.estado === "FINALIZADA" && ev.bonoMonto !== null && (
                  <p className="mt-2 text-xs text-green-800">Bono por desempeño: L {ev.bonoMonto.toLocaleString("es-HN", { minimumFractionDigits: 2 })} (se paga en la próxima planilla).</p>
                )}

                {(evaluables(ev) || (permisos.cerrar && ev.estado !== "FINALIZADA" && ev.estado !== "CANCELADA")) && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                    {evaluables(ev) && (
                      <button className="btn btn-sm btn-secondary" onClick={() => editar(ev)} disabled={accionando === ev.id}>
                        {ev.evaluadores > 0 ? "Editar comentarios" : "Editar"}
                      </button>
                    )}
                    {permisos.cerrar && ev.estado === "PENDIENTE_FIRMA" && (
                      <button className="btn btn-sm btn-primary" onClick={() => cambiarEstado(ev, "FINALIZADA")} disabled={accionando === ev.id}>
                        Finalizar
                      </button>
                    )}
                    {permisos.cerrar && (ev.estado === "BORRADOR" || ev.estado === "EN_PROGRESO") && (
                      <button className="btn btn-sm btn-ghost text-red-700" onClick={() => cambiarEstado(ev, "CANCELADA")} disabled={accionando === ev.id}>
                        Cancelar evaluación
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={editando ? "Editar evaluación" : "Nueva evaluación"}>
          <div className="panel max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">{editando ? "Editar evaluación" : "Nueva evaluación"}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Campo etiqueta="Empleado">
                  <select
                    value={form.empleadoId}
                    disabled={!!editando}
                    onChange={(e) => {
                      const empleadoId = e.target.value;
                      setForm((f) => ({ ...f, empleadoId }));
                      void cargarAspectos(empleadoId, form.tipo, []);
                    }}
                    className="input"
                  >
                    <option value="">Seleccione…</option>
                    {editando && !empleados.some((e) => e.id === editando.empleado.id) && (
                      <option value={editando.empleado.id}>{editando.empleado.primerNombre} {editando.empleado.primerApellido}</option>
                    )}
                    {empleados.map((emp) => (
                      <option key={emp.id} value={emp.id}>{nombreCompleto(emp)}</option>
                    ))}
                  </select>
                </Campo>
              </div>
              <Campo etiqueta="Tipo">
                <select
                  value={form.tipo}
                  disabled={!!editando}
                  onChange={(e) => {
                    const tipo = e.target.value;
                    setForm((f) => ({ ...f, tipo }));
                    void cargarAspectos(form.empleadoId, tipo, []);
                  }}
                  className="input"
                >
                  <option value="DESEMPENO_MENSUAL">Desempeño mensual</option>
                  <option value="COMPETENCIA_TRIMESTRAL">Competencia trimestral</option>
                </select>
              </Campo>
              <Campo etiqueta="Período">
                <input value={form.periodo} disabled={!!editando} onChange={(e) => setForm((f) => ({ ...f, periodo: e.target.value }))} placeholder="Ej: 2026-11 o 2026-T4" className="input" />
              </Campo>
            </div>

            {editando && editando.evaluadores > 0 ? (
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                Esta evaluación la califican {editando.evaluadores} evaluador{editando.evaluadores === 1 ? "" : "es"} por su enlace; aquí se corrigen los comentarios.
              </p>
            ) : (
              <div>
                <p className="mb-1 text-sm font-medium text-gray-800">Aspectos a evaluar (0 a 100)</p>
                {origen && (
                  <p className="mb-2 text-xs text-gray-500">
                    Se evalúa con {ETIQUETA_ORIGEN[origen]}.{" "}
                    {permisos.competencias && <Link href="/talento/competencias" className="underline">Configurarlos</Link>}
                  </p>
                )}
                {!form.empleadoId ? (
                  <p className="text-sm text-gray-500">Elija el empleado para ver sus aspectos.</p>
                ) : cargandoAspectos ? (
                  <p className="text-sm text-gray-500">Cargando aspectos…</p>
                ) : (
                  <div className="space-y-2">
                    {filas.map((f, i) => (
                      <label key={claveDe(f)} className="flex items-center gap-3">
                        <span className="flex-1 text-sm text-gray-700">
                          {f.nombre}
                          {filas.some((x) => x.peso !== f.peso) && <span className="ml-1 text-xs text-gray-500">peso {f.peso}</span>}
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          inputMode="decimal"
                          aria-label={`Calificación de ${f.nombre}`}
                          value={f.valor}
                          onChange={(e) => {
                            const valor = e.target.value;
                            setFilas((prev) => prev.map((x, j) => (j === i ? { ...x, valor } : x)));
                          }}
                          className="input w-20! text-right"
                        />
                      </label>
                    ))}
                    <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm font-medium">
                      <span>Calificación {completa ? "" : "(parcial)"}</span>
                      <span className={nota === null ? "text-gray-500" : colorCalif(nota)} data-nota-calculada>
                        {nota === null ? "—" : nota.toFixed(2)}
                      </span>
                    </div>
                    {!completa && filas.length > 0 && (
                      <p className="text-xs text-gray-500">Con aspectos sin calificar se guarda como borrador.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <Campo etiqueta="Comentarios generales">
              <textarea value={form.comentarios} onChange={(e) => setForm((f) => ({ ...f, comentarios: e.target.value }))} rows={2} className="input" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Fortalezas">
                <textarea value={form.fortalezas} onChange={(e) => setForm((f) => ({ ...f, fortalezas: e.target.value }))} rows={2} className="input" />
              </Campo>
              <Campo etiqueta="Áreas de mejora">
                <textarea value={form.mejoras} onChange={(e) => setForm((f) => ({ ...f, mejoras: e.target.value }))} rows={2} className="input" />
              </Campo>
            </div>
            <Campo etiqueta="Potencial (0 a 100, opcional: ubica al empleado en la matriz nine-box)">
              <input type="number" min="0" max="100" value={form.potencial} onChange={(e) => setForm((f) => ({ ...f, potencial: e.target.value }))} className="input w-28!" />
            </Campo>

            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setAbierto(false)} className="btn btn-ghost">Cancelar</button>
              <button
                onClick={guardar}
                disabled={guardando || cargandoAspectos || !form.empleadoId || !form.periodo.trim() || (!editando && nota === null)}
                className="btn btn-primary"
              >
                {guardando ? "Guardando…" : "Guardar evaluación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
