"use client";

/**
 * Un plan de horarios: matriz por sucursal (editable mientras es borrador),
 * resumen por persona, alertas y cobertura. Cada edición vuelve a validar el
 * plan entero en el servidor con las mismas reglas que el generador.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { horaDeMinutos, ETIQUETA_EXTRA, type ClaseExtra } from "@/lib/horarios/ley";
import { rango, fechaCorta, diaIso, periodoTexto, enumerar } from "@/lib/horarios/fechas";
import type { Alerta, DiaCalculado, EmpleadoPlan, Faltante, ResumenEmpleado } from "@/lib/horarios/tipos";

interface Datos {
  plan: { id: string; nombre: string; desde: string; hasta: string; estado: string; sucursalesIds: string[]; publicadoPor: string | null; publicadoAt: string | null };
  empleados: (EmpleadoPlan & { puestoNombre: string })[];
  sucursales: { id: string; nombre: string }[];
  puestos: Record<string, string>;
  turnos: { id: string; codigo: string; nombre: string; entrada: number; salida: number; pausa: number }[];
  feriados: { fecha: string; sucursalId: string | null; nombre: string }[];
  validacion: { dias: DiaCalculado[]; resumen: ResumenEmpleado[]; alertas: Alerta[]; faltantes: Faltante[] };
  notas: Alerta[];
}

type Pestana = "matriz" | "resumen" | "alertas" | "cobertura";
const LETRA = { DIURNA: "D", MIXTA: "M", NOCTURNA: "N" } as const;
const ESTILO: Record<string, string> = {
  APERTURA: "bg-sky-50 text-sky-900",
  INTERMEDIO: "bg-emerald-50 text-emerald-900",
  CIERRE: "bg-indigo-50 text-indigo-900",
  MEDIA: "bg-amber-50 text-amber-900",
  DESCANSO: "bg-gray-50 text-gray-500",
  AUSENCIA: "bg-pink-50 text-pink-800",
};

interface Edicion {
  empleado: EmpleadoPlan & { puestoNombre: string };
  fecha: string;
  estado: "TURNO" | "DESCANSO" | "AUSENCIA";
  turnoId: string;
  entrada: string;
  salida: string;
  pausa: number;
  sucursalId: string;
  motivo: string;
}

export default function PlanHorarioClient({ id, puedeEditar }: { id: string; puedeEditar: boolean }) {
  const router = useRouter();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useState<Pestana>("matriz");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string; detalle?: string[] } | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [filtroNivel, setFiltroNivel] = useState<"" | Alerta["nivel"]>("");
  const [filtroTipo, setFiltroTipo] = useState<"" | Alerta["tipo"]>("");

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/horarios/planes/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "No se pudo cargar el plan");
      return;
    }
    setDatos(await r.json());
  }, [id]);
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const indice = useMemo(() => {
    const dias = new Map<string, DiaCalculado>();
    const alertas = new Map<string, Alerta[]>();
    if (datos) {
      for (const d of datos.validacion.dias) dias.set(`${d.empleadoId}|${d.fecha}`, d);
      for (const a of datos.validacion.alertas) {
        if (!a.empleadoId || !a.fecha) continue;
        const k = `${a.empleadoId}|${a.fecha}`;
        alertas.set(k, [...(alertas.get(k) ?? []), a]);
      }
    }
    return { dias, alertas };
  }, [datos]);

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!datos) return <p className="text-sm text-gray-500">Cargando el plan…</p>;

  const { plan, validacion } = datos;
  const editable = puedeEditar && plan.estado === "BORRADOR";
  const fechas = rango(plan.desde, plan.hasta);
  const nombreSuc = (s: string | null) => datos.sucursales.find((x) => x.id === s)?.nombre ?? "";
  const errores = validacion.alertas.filter((a) => a.nivel === "ERROR");
  const errLegales = errores.filter((a) => a.tipo === "LEGAL");
  const extraTotal = validacion.resumen.reduce((s, r) => s + r.extraH, 0);
  const traslados = validacion.dias.filter((d) => d.esTraslado).length;
  const feriado = (f: string) => datos.feriados.find((x) => x.fecha === f);

  async function accion(a: "publicar" | "archivar" | "borrador") {
    const textos = {
      publicar: "Al publicar, este horario pasa a ser el turno de cada día para el reloj y la planilla. ¿Publicar?",
      archivar: "¿Archivar el plan? Deja de regir para el reloj y la planilla.",
      borrador: "¿Volver el plan a borrador para editarlo? Mientras tanto deja de regir.",
    };
    if (!confirm(textos[a])) return;
    const r = await fetch(`/api/horarios/planes/${id}/estado`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: a }) });
    const d = await r.json().catch(() => ({}));
    setAviso(r.ok ? { ok: true, texto: a === "publicar" ? "Plan publicado." : a === "archivar" ? "Plan archivado." : "El plan volvió a borrador." } : { ok: false, texto: d.error ?? "No se pudo", detalle: d.detalle });
    await cargar();
  }

  async function eliminar() {
    if (!confirm("¿Eliminar este plan? No se puede deshacer.")) return;
    const r = await fetch(`/api/horarios/planes/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/horarios");
    else setAviso({ ok: false, texto: (await r.json().catch(() => ({}))).error ?? "No se pudo eliminar" });
  }

  function abrir(e: EmpleadoPlan & { puestoNombre: string }, fecha: string) {
    if (!editable) return;
    const d = indice.dias.get(`${e.id}|${fecha}`);
    setEdicion({
      empleado: e, fecha, estado: d?.estado ?? "DESCANSO", turnoId: d?.turnoId ?? "",
      entrada: d?.entrada != null ? horaDeMinutos(d.entrada) : "", salida: d?.salida != null ? horaDeMinutos(d.salida) : "",
      pausa: d?.pausa ?? 0, sucursalId: d?.sucursalId ?? e.sucursalId, motivo: d?.motivo ?? "",
    });
  }

  async function guardarEdicion() {
    if (!edicion) return;
    setGuardando(true);
    const c = edicion;
    const r = await fetch(`/api/horarios/planes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cambios: [{
        empleadoId: c.empleado.id, fecha: c.fecha, estado: c.estado,
        ...(c.estado === "TURNO" ? { turnoId: c.turnoId || null, entrada: c.entrada || null, salida: c.salida || null, pausa: c.pausa, sucursalId: c.sucursalId } : { motivo: c.motivo || null }),
      }] }),
    });
    setGuardando(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setAviso({ ok: false, texto: d.error ?? "No se pudo guardar" });
      return;
    }
    setDatos(d);
    setEdicion(null);
    setAviso(null);
  }

  const celda = (d: DiaCalculado | undefined) => {
    if (!d) return "";
    if (d.estado === "AUSENCIA") return d.motivo ?? "Ausencia";
    if (d.estado === "DESCANSO") return d.motivo ? (d.motivo.startsWith("Descanso adicional") ? "Descanso adic." : d.motivo) : "Descanso";
    return `${horaDeMinutos(d.entrada!)}–${horaDeMinutos(d.salida!)}`;
  };

  const alertasFiltradas = validacion.alertas.filter((a) => (!filtroNivel || a.nivel === filtroNivel) && (!filtroTipo || a.tipo === filtroTipo));

  return (
    <div className="space-y-5">
      <PageHeader
        title={plan.nombre}
        description={<>
          {plan.nombre.includes(periodoTexto(plan.desde, plan.hasta)) ? "" : `Del ${periodoTexto(plan.desde, plan.hasta)}. `}
          {enumerar(datos.sucursales.map((s) => s.nombre))}, {datos.empleados.length} personas.{" "}
          <EstadoBadge valor={plan.estado} className="align-middle" />
          {plan.publicadoAt && <span className="text-gray-500"> por {plan.publicadoPor}</span>}
        </>}
        actions={<>
          <Link href="/horarios" className="btn btn-ghost">Volver</Link>
          <a className="btn btn-secondary" href={`/api/horarios/planes/${id}/exportar?formato=xlsx`}>Excel</a>
          <a className="btn btn-secondary" href={`/api/horarios/planes/${id}/exportar?formato=pdf`}>PDF</a>
          <a className="btn btn-secondary" href={`/api/horarios/planes/${id}/exportar?formato=json`}>JSON</a>
          {puedeEditar && plan.estado === "BORRADOR" && <button type="button" className="btn btn-primary" disabled={errLegales.length > 0} title={errLegales.length ? "Corrija los errores legales antes de publicar" : undefined} onClick={() => accion("publicar")}>Publicar</button>}
          {puedeEditar && plan.estado !== "BORRADOR" && <button type="button" className="btn btn-secondary" onClick={() => accion("borrador")}>Volver a borrador</button>}
          {puedeEditar && plan.estado !== "ARCHIVADO" && <button type="button" className="btn btn-ghost" onClick={() => accion("archivar")}>Archivar</button>}
          {puedeEditar && plan.estado !== "PUBLICADO" && <button type="button" className="btn btn-ghost text-red-700" onClick={eliminar}>Eliminar</button>}
        </>}
      >
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-gray-200">
          {([["matriz", "Horario"], ["resumen", "Resumen por persona"], ["alertas", `Alertas (${validacion.alertas.length})`], ["cobertura", `Cobertura (${validacion.faltantes.length})`]] as [Pestana, string][]).map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={pestana === k} onClick={() => setPestana(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === k ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {l}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-5">
        {[
          { t: "Errores legales", v: errLegales.length, c: errLegales.length ? "text-red-700" : "text-emerald-700", n: errLegales.length ? "Impiden publicar" : "Cumple el Código del Trabajo" },
          { t: "Avisos", v: validacion.alertas.filter((a) => a.nivel === "AVISO").length, c: "text-gray-900", n: "Revise antes de publicar" },
          { t: "Huecos de cobertura", v: validacion.faltantes.length, c: validacion.faltantes.length ? "text-amber-700" : "text-gray-900", n: "Franjas bajo el mínimo" },
          { t: "Horas extra", v: Math.round(extraTotal * 100) / 100, c: extraTotal ? "text-amber-700" : "text-gray-900", n: extraTotal ? "Marcadas y clasificadas" : "Ninguna programada" },
          { t: "Traslados", v: traslados, c: "text-gray-900", n: "Días en otra sucursal" },
        ].map((k) => (
          <div key={k.t} className="bg-white px-4 py-3">
            <p className="text-xs text-gray-500">{k.t}</p>
            <p className={`text-2xl font-semibold ${k.c}`}>{k.v}</p>
            <p className="text-xs text-gray-500">{k.n}</p>
          </div>
        ))}
      </div>

      {aviso && (
        <div role={aviso.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${aviso.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}>
          {aviso.texto}
          {aviso.detalle?.length ? <ul className="mt-1 list-disc pl-5">{aviso.detalle.map((t) => <li key={t}>{t}</li>)}</ul> : null}
        </div>
      )}

      {pestana === "matriz" && (
        <div className="space-y-6">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            {[["APERTURA", "Apertura"], ["INTERMEDIO", "Intermedio"], ["CIERRE", "Cierre"], ["MEDIA", "Media jornada (víspera)"], ["DESCANSO", "Descanso"], ["AUSENCIA", "Ausencia"]].map(([k, l]) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded-sm border border-gray-200 ${ESTILO[k]}`} />{l}</span>
            ))}
            <span>D diurna, M mixta, N nocturna</span>
            <span>→ traslado</span>
            <span><span className="font-semibold text-red-700">Borde rojo:</span> incumplimiento legal</span>
            {editable && <span className="text-blue-800">Toque una celda para cambiarla.</span>}
          </p>
          {datos.sucursales.map((s) => {
            const gente = datos.empleados.filter((e) => e.sucursalId === s.id).sort((a, b) => a.puestoNombre.localeCompare(b.puestoNombre) || a.nombre.localeCompare(b.nombre));
            const porPuesto = [...new Set(gente.map((e) => e.puestoNombre))];
            return (
              <section key={s.id} className="panel overflow-hidden">
                <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">{s.nombre}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 min-w-44 border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600">Persona</th>
                        {fechas.map((f) => (
                          <th key={f} className={`min-w-22 border-b border-gray-200 px-1 py-2 text-center font-medium ${diaIso(f) >= 6 ? "bg-gray-100 text-gray-700" : "bg-gray-50 text-gray-600"} ${diaIso(f) === 1 ? "border-l-2 border-l-gray-300" : ""}`}
                            title={feriado(f)?.nombre}>
                            {fechaCorta(f)}{feriado(f) ? " ★" : ""}
                          </th>
                        ))}
                        <th className="border-b border-gray-200 bg-gray-50 px-2 py-2 text-right font-medium text-gray-600">Horas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porPuesto.map((puesto) => filasPuesto(puesto))}
                    </tbody>
                  </table>
                </div>
              </section>
            );

            function filasPuesto(puesto: string) {
              return (
                <Fragment key={puesto}>
                  <tr><td colSpan={fechas.length + 2} className="bg-white px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{puesto}</td></tr>
                  {gente.filter((e) => e.puestoNombre === puesto).map((e) => {
                    const r = validacion.resumen.find((x) => x.empleadoId === e.id);
                    return (
                      <tr key={e.id} className="border-t border-gray-100">
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                          <span className="font-medium text-gray-900">{e.nombre}</span>
                          {e.edad < 18 && <span className="ml-1 text-[10px] text-pink-700" title="Menor de edad">{e.edad} años</span>}
                          {e.exento && <span className="ml-1 text-[10px] text-gray-500" title="Cargo de dirección o confianza (Art. 325)">Art. 325</span>}
                        </td>
                        {fechas.map((f) => {
                          const d = indice.dias.get(`${e.id}|${f}`);
                          const al = indice.alertas.get(`${e.id}|${f}`) ?? [];
                          const err = al.some((a) => a.nivel === "ERROR");
                          const av = al.some((a) => a.nivel === "AVISO");
                          const clave = d ? (d.estado === "TURNO" ? d.categoria ?? "" : d.estado) : "";
                          return (
                            <td key={f} className={`p-0.5 ${diaIso(f) === 1 ? "border-l-2 border-l-gray-300" : ""}`}>
                              <button
                                type="button"
                                onClick={() => abrir(e, f)}
                                disabled={!editable}
                                title={[d?.estado === "TURNO" ? `Jornada ${d.tipo?.toLowerCase()}, ${(d.efectivosMin / 60).toFixed(2)} h${d.pausa ? `, pausa de ${d.pausa} min` : ""}` : d?.motivo, ...al.map((a) => a.mensaje)].filter(Boolean).join("\n")}
                                className={`flex h-11 w-full flex-col items-center justify-center rounded px-1 leading-tight ${ESTILO[clave] ?? ""} ${err ? "ring-2 ring-red-500" : av ? "ring-1 ring-amber-400" : ""} ${editable ? "hover:brightness-95" : "cursor-default"}`}
                              >
                                <span className="whitespace-nowrap font-medium">{celda(d)}</span>
                                {d?.estado === "TURNO" && (
                                  <span className="text-[10px] opacity-75">
                                    {d.tipo ? LETRA[d.tipo] : ""}{d.esTraslado ? ` → ${nombreSuc(d.sucursalId)}` : ""}{d.extraTotalMin ? ` +${(d.extraTotalMin / 60).toFixed(1)} h` : ""}
                                  </span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                        <td className="whitespace-nowrap px-2 text-right text-gray-700">
                          {r?.ordinariasH ?? 0}
                          {r?.extraH ? <span className="block text-amber-700">+{r.extraH}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            }
          })}
        </div>
      )}

      {pestana === "resumen" && (
        <section className="panel overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Persona</th><th>Puesto</th><th className="num">Días</th><th className="num">Horas ord.</th><th className="num">Horas extra</th><th>Por semana (ord. / tope)</th><th className="num">Máx. seguidos</th><th className="num">Descansos</th><th className="num">Fines de semana</th><th className="num">Aperturas</th><th className="num">Cierres</th><th className="num">Traslados</th></tr>
            </thead>
            <tbody>
              {datos.empleados.map((e) => {
                const r = validacion.resumen.find((x) => x.empleadoId === e.id);
                if (!r) return null;
                const clases = (Object.keys(r.extraPorClaseH) as ClaseExtra[]).filter((k) => r.extraPorClaseH[k] > 0).map((k) => `${r.extraPorClaseH[k]} h ${ETIQUETA_EXTRA[k]}`).join("; ");
                return (
                  <tr key={e.id}>
                    <td className="font-medium text-gray-900">{e.nombre}</td>
                    <td>{e.puestoNombre}</td>
                    <td className="num">{r.diasTrabajados}</td>
                    <td className="num">{r.ordinariasH}</td>
                    <td className={`num ${r.extraH ? "font-semibold text-amber-700" : ""}`} title={clases}>{r.extraH}</td>
                    <td className="text-xs text-gray-600">{r.semanas.map((s) => `${s.ordinariasH}/${s.topeH}`).join(", ")}</td>
                    <td className={`num ${r.maxConsecutivos > 6 ? "font-semibold text-red-700" : ""}`}>{r.maxConsecutivos}</td>
                    <td className="num">{r.descansos}</td>
                    <td className={`num ${r.descansosFinDeSemana === 0 ? "text-amber-700" : ""}`}>{r.descansosFinDeSemana}</td>
                    <td className="num">{r.aperturas}</td>
                    <td className="num">{r.cierres}</td>
                    <td className="num">{r.traslados}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {pestana === "alertas" && (
        <section className="panel space-y-3 p-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <select className="input w-44" value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as typeof filtroNivel)} aria-label="Nivel">
              <option value="">Todos los niveles</option><option value="ERROR">Errores</option><option value="AVISO">Avisos</option><option value="INFO">Información</option>
            </select>
            <select className="input w-44" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)} aria-label="Tipo">
              <option value="">Legales y operativas</option><option value="LEGAL">Legales</option><option value="OPERATIVA">Operativas</option>
            </select>
          </div>
          {alertasFiltradas.length === 0 && <p className="text-sm text-gray-500">Sin alertas con esos filtros.</p>}
          <ul className="divide-y divide-gray-100">
            {alertasFiltradas.map((a, i) => (
              <li key={i} className="flex gap-3 py-2 text-sm">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold ${a.nivel === "ERROR" ? "bg-red-100 text-red-800" : a.nivel === "AVISO" ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-600"}`}>
                  {a.nivel === "ERROR" ? "Error" : a.nivel === "AVISO" ? "Aviso" : "Info"}
                </span>
                <span className="text-gray-800">{a.mensaje}{a.articulo && <span className="ml-1 text-xs text-gray-500">({a.articulo})</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pestana === "cobertura" && (
        <div className="space-y-4">
          {datos.notas.length > 0 && (
            <section className="panel space-y-2 p-4 text-sm">
              <h2 className="font-semibold text-gray-900">Notas del generador</h2>
              {datos.notas.map((n, i) => <p key={i} className={n.nivel === "ERROR" ? "text-red-800" : n.nivel === "AVISO" ? "text-amber-900" : "text-gray-700"}>{n.mensaje}</p>)}
            </section>
          )}
          <section className="panel overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Sucursal</th><th>Puesto</th><th>Fecha</th><th>Franja</th><th className="num">Requeridos</th><th className="num">Programados</th></tr></thead>
              <tbody>
                {validacion.faltantes.length === 0 && <tr><td colSpan={6} className="text-emerald-700">Todas las franjas tienen el personal mínimo.</td></tr>}
                {validacion.faltantes.map((f, i) => (
                  <tr key={i}>
                    <td>{nombreSuc(f.sucursalId)}</td><td>{datos.puestos[f.puestoId] ?? ""}</td><td>{fechaCorta(f.fecha)}</td>
                    <td>{horaDeMinutos(f.desde)}–{horaDeMinutos(f.hasta)}</td><td className="num">{f.requeridos}</td><td className="num text-amber-700">{f.programados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {edicion && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="titulo-edicion">
          <div className="panel w-full max-w-lg space-y-4 p-5 shadow-xl">
            <div>
              <h2 id="titulo-edicion" className="text-base font-semibold text-gray-900">{edicion.empleado.nombre}</h2>
              <p className="text-sm text-gray-500">{edicion.empleado.puestoNombre}, {fechaCorta(edicion.fecha)}</p>
            </div>
            <div className="flex gap-2 text-sm">
              {(["TURNO", "DESCANSO", "AUSENCIA"] as const).map((e) => (
                <label key={e} className="flex items-center gap-1.5">
                  <input type="radio" name="estado" checked={edicion.estado === e} onChange={() => setEdicion({ ...edicion, estado: e })} />
                  {e === "TURNO" ? "Turno" : e === "DESCANSO" ? "Descanso" : "Ausencia"}
                </label>
              ))}
            </div>
            {edicion.estado === "TURNO" ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="font-medium text-gray-800">Turno</span>
                  <select className="input mt-1" value={edicion.turnoId} onChange={(e) => {
                    const t = datos.turnos.find((x) => x.id === e.target.value);
                    setEdicion({ ...edicion, turnoId: e.target.value, ...(t ? { entrada: horaDeMinutos(t.entrada), salida: horaDeMinutos(t.salida), pausa: t.pausa } : {}) });
                  }}>
                    <option value="">Horario personalizado</option>
                    {datos.turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({horaDeMinutos(t.entrada)}–{horaDeMinutos(t.salida)})</option>)}
                  </select>
                </label>
                <label><span className="font-medium text-gray-800">Entrada</span><input type="time" className="input mt-1" value={edicion.entrada} onChange={(e) => setEdicion({ ...edicion, entrada: e.target.value })} /></label>
                <label><span className="font-medium text-gray-800">Salida</span><input type="time" className="input mt-1" value={edicion.salida} onChange={(e) => setEdicion({ ...edicion, salida: e.target.value })} /></label>
                <label><span className="font-medium text-gray-800">Almuerzo / pausa (min)</span><input type="number" min={0} max={240} className="input mt-1" value={edicion.pausa} onChange={(e) => setEdicion({ ...edicion, pausa: Number(e.target.value) })} /></label>
                <label><span className="font-medium text-gray-800">Sucursal</span>
                  <select className="input mt-1" value={edicion.sucursalId} onChange={(e) => setEdicion({ ...edicion, sucursalId: e.target.value })}>
                    {datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.id !== edicion.empleado.sucursalId ? " (traslado)" : ""}</option>)}
                  </select>
                </label>
                <p className="text-xs text-gray-500 sm:col-span-2">Una salida anterior a la entrada termina al día siguiente. Una pausa de hasta 30 min en jornada continua cuenta como trabajo (Art. 326).</p>
              </div>
            ) : (
              <label className="block text-sm"><span className="font-medium text-gray-800">{edicion.estado === "DESCANSO" ? "Motivo (vacío = descanso semanal)" : "Motivo"}</span>
                <input className="input mt-1" value={edicion.motivo} maxLength={200} onChange={(e) => setEdicion({ ...edicion, motivo: e.target.value })} />
              </label>
            )}
            {(indice.alertas.get(`${edicion.empleado.id}|${edicion.fecha}`) ?? []).length > 0 && (
              <ul className="space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                {indice.alertas.get(`${edicion.empleado.id}|${edicion.fecha}`)!.map((a, i) => <li key={i}>{a.mensaje}</li>)}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setEdicion(null)}>Cancelar</button>
              <button type="button" className="btn btn-primary" disabled={guardando} onClick={guardarEdicion}>{guardando ? "Guardando…" : "Guardar y validar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
