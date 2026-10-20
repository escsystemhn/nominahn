"use client";

/**
 * Prestaciones: liquidaciones finales y décimos.
 *
 * El cálculo vive en el servidor (`/api/liquidaciones`, `/api/decimos`); aquí se
 * simula, se confirma y se mueve el estado. La matriz de quién puede qué es la
 * misma del servidor (`estado-prestaciones.ts`): la pantalla sólo muestra los
 * botones que la API va a aceptar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import ArchivoBanco from "@/components/payroll/ArchivoBanco";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { tienePermiso } from "@/lib/auth/permisos";
import {
  accionesLiquidacion,
  accionesDecimo,
  type EstadoLiquidacion,
  type EstadoDecimo,
} from "@/lib/payroll/estado-prestaciones";
import { CAUSAS_TERMINACION, TIPOS_DECIMO, etiquetaCausa } from "@/lib/payroll/etiquetas-prestaciones";

interface EmpleadoOpcion {
  id: string;
  codigo: string;
  nombre: string;
  fechaIngreso: string;
  salarioBase: number;
}

interface Props {
  tabInicial: "liquidaciones" | "decimos";
  permisos: string[];
  empleados: EmpleadoOpcion[];
  sucursales: { id: string; nombre: string }[];
}

interface Liquidacion {
  id: string;
  causa: string;
  fechaSalida: string;
  totalAPagar: string | number;
  estado: EstadoLiquidacion;
  fechaPago: string | null;
  empleado: { codigo: string; primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null };
}

interface Simulacion {
  esMicroempresa: boolean;
  salarioPromedio: number;
  salarioDiario: number;
  tiempoServicio: { dias: number; aniosCompletos: number; mesesCompletos: number };
  conceptos: { concepto: string; dias: number | null; monto: number; base: string }[];
  totalPrestaciones: number;
  deducciones: number;
  totalAPagar: number;
  observaciones: string[];
  saldoDeduccionesPendientes: number;
  deudasVigentes: { id: string; nombre: string; saldo: number }[];
}

interface Decimo {
  id: string;
  tipo: string;
  anio: number;
  diasComputados: number;
  salarioPromedio: string | number;
  montoDevengado: string | number;
  montoExento: string | number;
  montoGravado: string | number;
  isrRetenido: string | number;
  montoPagado: string | number;
  estado: EstadoDecimo;
  esProporcional: boolean;
  fechaPago: string | null;
  empleado: { codigo: string; primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null };
}

type Dialogo =
  | { tipo: "pagar-liq"; id: string; nombre: string }
  | { tipo: "anular-liq"; id: string; nombre: string; estado: EstadoLiquidacion }
  | { tipo: "pagar-dec"; ids: string[] }
  | { tipo: "anular-dec"; ids: string[]; estado: EstadoDecimo; nombre: string }
  | null;

const nombreDe = (e: Liquidacion["empleado"]) =>
  [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Tegucigalpa" });

const formVacio = {
  empleadoId: "",
  causa: "DESPIDO_INJUSTIFICADO",
  fechaSalida: "",
  preavisoOtorgado: false,
  diasVacacionesGozados: "",
  salariosPendientes: "",
  otrosAdeudos: "",
  deducciones: "",
  liquidarPrestamos: false,
};

export default function PrestacionesClient({ tabInicial, permisos, empleados, sucursales }: Props) {
  const [tab, setTab] = useState<"liquidaciones" | "decimos">(tabInicial);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);

  const puedeGenerar = tienePermiso(permisos, "prestaciones.generar");
  const puedePagar = tienePermiso(permisos, "prestaciones.pagar");

  // ─── Liquidaciones ──────────────────────────────────────────────────────────
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[] | null>(null);
  const [form, setForm] = useState(formVacio);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [simulacion, setSimulacion] = useState<Simulacion | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargarLiquidaciones = useCallback(async () => {
    const res = await fetch("/api/liquidaciones", { cache: "no-store" });
    setLiquidaciones(res.ok ? await res.json() : []);
  }, []);

  // ─── Décimos ────────────────────────────────────────────────────────────────
  const anioActual = new Date().getFullYear();
  const [filtroDec, setFiltroDec] = useState({ tipo: "DECIMO_TERCERO", anio: String(anioActual), sucursalId: "" });
  const [decimos, setDecimos] = useState<Decimo[] | null>(null);

  const cargarDecimos = useCallback(async () => {
    const qs = new URLSearchParams({ tipo: filtroDec.tipo, anio: filtroDec.anio });
    const res = await fetch(`/api/decimos?${qs}`, { cache: "no-store" });
    setDecimos(res.ok ? await res.json() : []);
  }, [filtroDec.tipo, filtroDec.anio]);

  useEffect(() => {
    const t = setTimeout(() => void (tab === "liquidaciones" ? cargarLiquidaciones() : cargarDecimos()), 0);
    return () => clearTimeout(t);
  }, [tab, cargarLiquidaciones, cargarDecimos]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSimulacion(null);
  }

  const cuerpoLiquidacion = (guardar: boolean) => ({
    empleadoId: form.empleadoId,
    causa: form.causa,
    fechaSalida: form.fechaSalida,
    preavisoOtorgado: form.preavisoOtorgado,
    ...(form.diasVacacionesGozados !== "" ? { diasVacacionesGozados: Number(form.diasVacacionesGozados) } : {}),
    salariosPendientes: Number(form.salariosPendientes || 0),
    otrosAdeudos: Number(form.otrosAdeudos || 0),
    deducciones: Number(form.deducciones || 0),
    liquidarPrestamos: form.liquidarPrestamos,
    guardar,
  });

  async function calcular() {
    if (!form.empleadoId || !form.fechaSalida) {
      setAviso({ ok: false, texto: "Elija el empleado y la fecha de salida." });
      return;
    }
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/liquidaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoLiquidacion(false)) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo calcular");
      setSimulacion(d);
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setOcupado(false);
    }
  }

  async function guardar() {
    const emp = empleados.find((e) => e.id === form.empleadoId);
    if (!confirm(`Al guardar la liquidación, ${emp?.nombre ?? "el empleado"} queda inactivo y deja de entrar en las planillas. ¿Continuar?`)) return;
    setOcupado(true);
    try {
      const res = await fetch("/api/liquidaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoLiquidacion(true)) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo guardar");
      setAviso({ ok: true, texto: `Liquidación guardada como borrador por ${formatCurrency(d.totalAPagar)}. Falta aprobarla.` });
      setForm(formVacio);
      setSimulacion(null);
      setMostrarForm(false);
      await cargarLiquidaciones();
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarEstadoLiquidacion(id: string, cuerpo: Record<string, unknown>) {
    const res = await fetch(`/api/liquidaciones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const d = await res.json();
    if (!res.ok) {
      setAviso({ ok: false, texto: d.error ?? "No se pudo actualizar" });
      return false;
    }
    setAviso({ ok: true, texto: `Liquidación ${String(cuerpo.estado).toLowerCase()}.` });
    await cargarLiquidaciones();
    return true;
  }

  async function calcularDecimos() {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch("/api/decimos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: filtroDec.tipo, anio: Number(filtroDec.anio), sucursalId: filtroDec.sucursalId || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo calcular");
      setAviso({ ok: true, texto: `Calculado para ${d.empleados} empleado(s): ${formatCurrency(d.totalDevengado)} devengado, ${formatCurrency(d.totalIsr)} de ISR.` });
      await cargarDecimos();
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarEstadoDecimos(ids: string[], cuerpo: Record<string, unknown>) {
    const res = await fetch("/api/decimos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, ...cuerpo }) });
    const d = await res.json();
    if (!res.ok) {
      setAviso({ ok: false, texto: d.error ?? "No se pudo actualizar" });
      return false;
    }
    setAviso({ ok: true, texto: `${d.actualizadas} liquidación(es) de décimo ${cuerpo.estado === "PAGADA" ? "registradas como pagadas" : "anuladas"}.` });
    await cargarDecimos();
    return true;
  }

  const resumenDec = useMemo(() => {
    const filas = decimos ?? [];
    const vigentes = filas.filter((d) => d.estado !== "ANULADA");
    const suma = (k: keyof Decimo) => vigentes.reduce((s, d) => s + Number(d[k]), 0);
    return {
      empleados: vigentes.length,
      devengado: suma("montoDevengado"),
      isr: suma("isrRetenido"),
      neto: suma("montoPagado"),
      calculadas: filas.filter((d) => d.estado === "CALCULADA").map((d) => d.id),
    };
  }, [decimos]);

  const empSel = empleados.find((e) => e.id === form.empleadoId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prestaciones"
        description="Liquidaciones finales y décimos tercer y cuarto mes. El cálculo sigue el Código del Trabajo; cada desglose lleva su fundamento."
        actions={
          tab === "liquidaciones" && puedeGenerar ? (
            <button type="button" className="btn btn-primary" onClick={() => { setMostrarForm((v) => !v); setSimulacion(null); }}>
              {mostrarForm ? "Cerrar" : "Nueva liquidación"}
            </button>
          ) : undefined
        }
      >
        <nav className="-mb-5 flex gap-1" aria-label="Secciones de prestaciones">
          {(
            [
              ["liquidaciones", "Liquidaciones"],
              ["decimos", "Décimos"],
            ] as const
          ).map(([k, l]) => (
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

      {/* ─── Liquidaciones ─────────────────────────────────────────────────── */}
      {tab === "liquidaciones" && (
        <>
          {mostrarForm && puedeGenerar && (
            <section className="panel space-y-4 p-6" aria-labelledby="nueva-liq">
              <h2 id="nueva-liq" className="text-base font-semibold text-gray-900">Nueva liquidación</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-emp">Empleado</label>
                  <select id="liq-emp" className="input" value={form.empleadoId} onChange={(e) => set("empleadoId", e.target.value)}>
                    <option value="">Elegir</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>{e.nombre} ({e.codigo})</option>
                    ))}
                  </select>
                  {empSel && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      Ingresó el {formatDate(empSel.fechaIngreso)}. Salario base {formatCurrency(empSel.salarioBase)}.
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-fecha">Fecha de salida</label>
                  <input id="liq-fecha" type="date" className="input" value={form.fechaSalida} max={hoy()} onChange={(e) => set("fechaSalida", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-causa">Causa</label>
                  <select id="liq-causa" className="input" value={form.causa} onChange={(e) => set("causa", e.target.value)}>
                    {CAUSAS_TERMINACION.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-vac">Días de vacaciones ya gozados</label>
                  <input id="liq-vac" type="number" min={0} step="0.5" className="input" placeholder="Del saldo registrado" value={form.diasVacacionesGozados} onChange={(e) => set("diasVacacionesGozados", e.target.value)} />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.preavisoOtorgado} onChange={(e) => set("preavisoOtorgado", e.target.checked)} />
                    Se dio y se laboró el preaviso
                  </label>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-sal">Salarios pendientes</label>
                  <input id="liq-sal" type="number" min={0} step="0.01" className="input" value={form.salariosPendientes} onChange={(e) => set("salariosPendientes", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-otros">Otros adeudos</label>
                  <input id="liq-otros" type="number" min={0} step="0.01" className="input" value={form.otrosAdeudos} onChange={(e) => set("otrosAdeudos", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="liq-ded">Deducciones (préstamos y anticipos)</label>
                  <input id="liq-ded" type="number" min={0} step="0.01" className="input" value={form.deducciones} onChange={(e) => { set("deducciones", e.target.value); set("liquidarPrestamos", false); }} />
                </div>
              </div>

              <div className="flex justify-end">
                <button type="button" className="btn btn-secondary" onClick={() => void calcular()} disabled={ocupado}>
                  {ocupado && !simulacion ? "Calculando…" : "Calcular"}
                </button>
              </div>

              {simulacion && (
                <div className="space-y-4 border-t border-gray-200 pt-4">
                  {simulacion.saldoDeduccionesPendientes > 0 && !form.liquidarPrestamos && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <span>
                        Tiene préstamos o anticipos vigentes por {formatCurrency(simulacion.saldoDeduccionesPendientes)} ({simulacion.deudasVigentes.map((d) => d.nombre).join(", ")}).
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setForm((f) => ({ ...f, deducciones: String(simulacion.saldoDeduccionesPendientes), liquidarPrestamos: true })); setSimulacion(null); }}
                      >
                        Descontarlos y saldarlos
                      </button>
                    </div>
                  )}
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-gray-500">Tiempo de servicio</dt><dd className="text-gray-900">{simulacion.tiempoServicio.aniosCompletos} años, {simulacion.tiempoServicio.mesesCompletos - simulacion.tiempoServicio.aniosCompletos * 12} meses</dd></div>
                    <div><dt className="text-xs text-gray-500">Salario promedio</dt><dd className="tnum text-gray-900">{formatCurrency(simulacion.salarioPromedio)}</dd></div>
                    <div><dt className="text-xs text-gray-500">Salario diario</dt><dd className="tnum text-gray-900">{formatCurrency(simulacion.salarioDiario)}</dd></div>
                    <div><dt className="text-xs text-gray-500">Tamaño de empresa</dt><dd className="text-gray-900">{simulacion.esMicroempresa ? "Hasta 10 trabajadores" : "Más de 10 trabajadores"}</dd></div>
                  </dl>
                  <div className="overflow-x-auto">
                    <table className="table-base text-sm">
                      <thead>
                        <tr><th className="px-3">Concepto</th><th className="px-3">Fundamento</th><th className="num px-3">Días</th><th className="num px-3">Monto</th></tr>
                      </thead>
                      <tbody>
                        {simulacion.conceptos.map((c) => (
                          <tr key={c.concepto}>
                            <td className="px-3 py-2">{c.concepto}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{c.base}</td>
                            <td className="num px-3 py-2">{c.dias ?? ""}</td>
                            <td className="num px-3 py-2">{formatCurrency(c.monto)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300"><td colSpan={3} className="px-3 py-2 font-medium">Total de prestaciones</td><td className="num px-3 py-2 font-medium">{formatCurrency(simulacion.totalPrestaciones)}</td></tr>
                        <tr><td colSpan={3} className="px-3 py-1.5 text-gray-600">Deducciones</td><td className="num px-3 py-1.5 text-gray-600">{simulacion.deducciones ? `− ${formatCurrency(simulacion.deducciones)}` : formatCurrency(0)}</td></tr>
                        <tr className="bg-gray-50"><td colSpan={3} className="px-3 py-2.5 text-base font-semibold text-gray-900">Total a pagar</td><td className="num px-3 py-2.5 text-base font-semibold text-blue-800">{formatCurrency(simulacion.totalAPagar)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                  {simulacion.observaciones.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
                      {simulacion.observaciones.map((o) => <li key={o}>{o}</li>)}
                    </ul>
                  )}
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={ocupado}>
                      {ocupado ? "Guardando…" : "Guardar liquidación"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="panel overflow-hidden" aria-label="Liquidaciones emitidas">
            {liquidaciones === null ? (
              <p className="p-6 text-sm text-gray-400">Cargando…</p>
            ) : liquidaciones.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">Todavía no hay liquidaciones. {puedeGenerar ? "Use «Nueva liquidación» para calcular la primera." : ""}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th className="px-4">Empleado</th>
                      <th className="px-4">Causa</th>
                      <th className="px-4">Salida</th>
                      <th className="num px-4">Total a pagar</th>
                      <th className="px-4">Estado</th>
                      <th className="px-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liquidaciones.map((l) => {
                      const acciones = accionesLiquidacion(l.estado, permisos);
                      const nombre = nombreDe(l.empleado);
                      return (
                        <tr key={l.id}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-900">{nombre}</div>
                            <div className="text-xs text-gray-500">{l.empleado.codigo}</div>
                          </td>
                          <td className="px-4 py-2.5">{etiquetaCausa(l.causa)}</td>
                          <td className="tnum px-4 py-2.5">{formatDate(l.fechaSalida)}</td>
                          <td className="num px-4 py-2.5 font-medium">{formatCurrency(Number(l.totalAPagar))}</td>
                          <td className="px-4 py-2.5">
                            <EstadoBadge valor={l.estado} />
                            {l.fechaPago && <span className="block text-[11px] text-gray-500">Pagada el {formatDate(l.fechaPago)}</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap justify-end gap-2">
                              <a className="btn btn-ghost btn-sm" href={`/api/liquidaciones/${l.id}/pdf?modo=ver`} target="_blank" rel="noopener noreferrer">PDF</a>
                              {acciones.includes("APROBADA") && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cambiarEstadoLiquidacion(l.id, { estado: "APROBADA" })}>Aprobar</button>
                              )}
                              {acciones.includes("PAGADA") && (
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialogo({ tipo: "pagar-liq", id: l.id, nombre })}>Registrar pago</button>
                              )}
                              {acciones.includes("ANULADA") && (
                                <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => setDialogo({ tipo: "anular-liq", id: l.id, nombre, estado: l.estado })}>Anular</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* ─── Décimos ───────────────────────────────────────────────────────── */}
      {tab === "decimos" && (
        <>
          <section className="panel flex flex-wrap items-end gap-3 p-5" aria-label="Filtros de décimos">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="dec-tipo">Décimo</label>
              <select id="dec-tipo" className="input" value={filtroDec.tipo} onChange={(e) => setFiltroDec((f) => ({ ...f, tipo: e.target.value }))}>
                {TIPOS_DECIMO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="dec-anio">Año</label>
              <input id="dec-anio" type="number" min={2000} max={2100} className="input w-28" value={filtroDec.anio} onChange={(e) => setFiltroDec((f) => ({ ...f, anio: e.target.value }))} />
            </div>
            {puedeGenerar && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="dec-suc">Sucursal</label>
                <select id="dec-suc" className="input" value={filtroDec.sucursalId} onChange={(e) => setFiltroDec((f) => ({ ...f, sucursalId: e.target.value }))}>
                  <option value="">Todas</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
            )}
            <p className="min-w-0 flex-1 text-xs text-gray-500">
              {filtroDec.tipo === "DECIMO_TERCERO"
                ? `Devenga de enero a diciembre de ${filtroDec.anio}; se paga en diciembre.`
                : `Devenga de julio de ${Number(filtroDec.anio) - 1} a junio de ${filtroDec.anio}; se paga en junio.`}
            </p>
            {puedeGenerar && (
              <button type="button" className="btn btn-primary" onClick={() => void calcularDecimos()} disabled={ocupado}>
                {ocupado ? "Calculando…" : "Calcular"}
              </button>
            )}
          </section>

          {decimos && decimos.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 border-b border-gray-200 pb-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-gray-500">Empleados</dt><dd className="tnum text-lg font-semibold text-gray-900">{resumenDec.empleados}</dd></div>
              <div><dt className="text-xs text-gray-500">Devengado</dt><dd className="tnum text-lg font-semibold text-gray-900">{formatCurrency(resumenDec.devengado)}</dd></div>
              <div><dt className="text-xs text-gray-500">ISR retenido</dt><dd className="tnum text-lg font-semibold text-gray-900">{formatCurrency(resumenDec.isr)}</dd></div>
              <div><dt className="text-xs text-gray-500">Neto a pagar</dt><dd className="tnum text-lg font-semibold text-blue-800">{formatCurrency(resumenDec.neto)}</dd></div>
            </dl>
          )}

          {puedePagar && decimos && decimos.some((d) => d.estado !== "ANULADA") && (
            <ArchivoBanco
              etiqueta="Archivo para el banco"
              base={`/api/decimos/archivo-banco?tipo=${filtroDec.tipo}&anio=${filtroDec.anio}`}
            />
          )}

          <section className="panel overflow-hidden" aria-label="Décimos calculados">
            {puedePagar && resumenDec.calculadas.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
                <p className="text-sm text-gray-600">{resumenDec.calculadas.length} calculada(s) pendientes de pago.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialogo({ tipo: "pagar-dec", ids: resumenDec.calculadas })}>
                  Registrar el pago de todas
                </button>
              </div>
            )}
            {decimos === null ? (
              <p className="p-6 text-sm text-gray-400">Cargando…</p>
            ) : decimos.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No hay décimos calculados para este año. {puedeGenerar ? "Use «Calcular»." : ""}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th className="px-3">Empleado</th>
                      <th className="num px-3">Días</th>
                      <th className="num px-3">Salario promedio</th>
                      <th className="num px-3">Devengado</th>
                      <th className="num px-3">Exento</th>
                      <th className="num px-3">ISR</th>
                      <th className="num px-3">Neto</th>
                      <th className="px-3">Estado</th>
                      <th className="px-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {decimos.map((d) => {
                      const acciones = accionesDecimo(d.estado, permisos);
                      return (
                        <tr key={d.id}>
                          <td className="px-3 py-2">
                            <div className="text-gray-900">{nombreDe(d.empleado)}</div>
                            <div className="text-xs text-gray-500">{d.empleado.codigo}{d.esProporcional ? ", proporcional" : ""}</div>
                          </td>
                          <td className="num px-3 py-2">{d.diasComputados}</td>
                          <td className="num px-3 py-2">{formatCurrency(Number(d.salarioPromedio))}</td>
                          <td className="num px-3 py-2">{formatCurrency(Number(d.montoDevengado))}</td>
                          <td className="num px-3 py-2 text-gray-500">{formatCurrency(Number(d.montoExento))}</td>
                          <td className="num px-3 py-2 text-gray-500">{formatCurrency(Number(d.isrRetenido))}</td>
                          <td className="num px-3 py-2 font-medium">{formatCurrency(Number(d.montoPagado))}</td>
                          <td className="px-3 py-2">
                            <EstadoBadge valor={d.estado} />
                            {d.fechaPago && <span className="block text-[11px] text-gray-500">{formatDate(d.fechaPago)}</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {acciones.includes("ANULADA") && (
                              <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => setDialogo({ tipo: "anular-dec", ids: [d.id], estado: d.estado, nombre: nombreDe(d.empleado) })}>Anular</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {dialogo && (
        <DialogoEstado
          dialogo={dialogo}
          onCerrar={() => setDialogo(null)}
          onConfirmar={async (datos) => {
            let ok = false;
            if (dialogo.tipo === "pagar-liq") ok = await cambiarEstadoLiquidacion(dialogo.id, { estado: "PAGADA", fechaPago: datos.fecha });
            if (dialogo.tipo === "anular-liq") ok = await cambiarEstadoLiquidacion(dialogo.id, { estado: "ANULADA", motivo: datos.motivo || undefined, reactivarEmpleado: datos.reactivar });
            if (dialogo.tipo === "pagar-dec") ok = await cambiarEstadoDecimos(dialogo.ids, { estado: "PAGADA", fechaPago: datos.fecha });
            if (dialogo.tipo === "anular-dec") ok = await cambiarEstadoDecimos(dialogo.ids, { estado: "ANULADA", motivo: datos.motivo || undefined });
            if (ok) setDialogo(null);
          }}
        />
      )}
    </div>
  );
}

function DialogoEstado({
  dialogo,
  onCerrar,
  onConfirmar,
}: {
  dialogo: NonNullable<Dialogo>;
  onCerrar: () => void;
  onConfirmar: (d: { fecha: string; motivo: string; reactivar: boolean }) => Promise<void>;
}) {
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState("");
  const [reactivar, setReactivar] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const esPago = dialogo.tipo === "pagar-liq" || dialogo.tipo === "pagar-dec";
  const exigeMotivo = (dialogo.tipo === "anular-liq" && dialogo.estado !== "BORRADOR") || (dialogo.tipo === "anular-dec" && dialogo.estado === "PAGADA");
  const titulo =
    dialogo.tipo === "pagar-liq" ? `Registrar el pago de la liquidación de ${dialogo.nombre}`
    : dialogo.tipo === "pagar-dec" ? `Registrar el pago de ${dialogo.ids.length} décimo(s)`
    : dialogo.tipo === "anular-liq" ? `Anular la liquidación de ${dialogo.nombre}`
    : `Anular el décimo de ${dialogo.nombre}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dlg-titulo">
      <form
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          if (exigeMotivo && !motivo.trim()) return;
          setEnviando(true);
          try {
            await onConfirmar({ fecha, motivo, reactivar });
          } finally {
            setEnviando(false);
          }
        }}
      >
        <h2 id="dlg-titulo" className="text-base font-semibold text-gray-900">{titulo}</h2>
        {esPago ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="dlg-fecha">Fecha de pago</label>
            <input id="dlg-fecha" type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="dlg-motivo">Motivo{exigeMotivo ? "" : " (opcional)"}</label>
              <textarea id="dlg-motivo" className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required={exigeMotivo} />
            </div>
            {dialogo.tipo === "anular-liq" && (
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5" checked={reactivar} onChange={(e) => setReactivar(e.target.checked)} />
                Devolver al empleado a activo. Márquelo sólo si la salida no llegó a ocurrir.
              </label>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className={`btn ${esPago ? "btn-primary" : "btn-secondary text-red-700"}`} disabled={enviando}>
            {enviando ? "Guardando…" : esPago ? "Registrar pago" : "Anular"}
          </button>
        </div>
      </form>
    </div>
  );
}
