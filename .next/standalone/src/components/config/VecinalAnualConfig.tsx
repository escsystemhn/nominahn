"use client";

/**
 * Configuración → Parámetros de ley → Impuesto vecinal: cuándo se cobra.
 *
 * Por omisión, UNA VEZ al año y confirmado: la planilla no lo descuenta; a inicios del año
 * siguiente se calcula con lo pagado a cada empleado, se revisa, se confirma y se descuenta
 * en la planilla que contiene la fecha de cobro. Ver `lib/payroll/vecinal-anual.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { useAvisos } from "@/components/ui/Avisos";
import { formatCurrency } from "@/lib/utils";
import { rangoPeriodo } from "@/lib/payroll/periodos-planilla";

type Cobro = "ANUAL" | "CADA_PLANILLA";
interface Fila {
  empleadoId: string; codigo: string; nombre: string; tipoPlanilla: string; meses: number;
  base: string; impuesto: string; confirmado: string | null; periodo: { desde: string; hasta: string };
}
interface Datos {
  cobro: Cobro; anio: number; fechaCobro: string; filas: Fila[];
  confirmacion: { fechaCobro: string; confirmadoPor: string; confirmadoEn: string; empleados: number; total: string } | null;
}

const API = "/api/configuracion/parametros/vecinal-anual";

export default function VecinalAnualConfig() {
  const { confirmar } = useAvisos();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cobro, setCobro] = useState<Cobro>("ANUAL");
  const [anio, setAnio] = useState("");
  const [fechaCobro, setFechaCobro] = useState("");
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function cargar(a?: string, f?: string) {
    setOcupado("cargar");
    const q = new URLSearchParams();
    if (a) q.set("anio", a);
    if (f) q.set("fechaCobro", f);
    const r = await fetch(`${API}?${q}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudo calcular." }); return; }
    const x = d as Datos;
    setDatos(x);
    setCobro(x.cobro);
    setAnio(String(x.anio));
    setFechaCobro(x.fechaCobro);
    // Lo confirmado antes, si lo hay; si no, lo que da la tabla.
    setMontos(Object.fromEntries(x.filas.map((f) => [f.empleadoId, f.confirmado ?? f.impuesto])));
  }

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await fetch(API, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudo cargar el impuesto vecinal." }); return; }
      const x = d as Datos;
      setDatos(x); setCobro(x.cobro); setAnio(String(x.anio)); setFechaCobro(x.fechaCobro);
      setMontos(Object.fromEntries(x.filas.map((f) => [f.empleadoId, f.confirmado ?? f.impuesto])));
    })();
    return () => { vivo = false; };
  }, []);

  const total = useMemo(() => Object.values(montos).reduce((s, v) => s + (Number(v) || 0), 0), [montos]);
  const conPocosMeses = datos?.filas.filter((f) => f.meses < 12).length ?? 0;

  async function guardarCobro() {
    setOcupado("cobro"); setAviso(null);
    const r = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cobro }) });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    setAviso(r.ok
      ? { ok: true, texto: cobro === "ANUAL" ? "Guardado: el vecinal ya no se descuenta en cada planilla; se cobra una vez, después de confirmarlo." : "Guardado: el vecinal se descuenta en cada planilla." }
      : { ok: false, texto: d.error ?? "No se pudo guardar." });
    if (r.ok && datos) setDatos({ ...datos, cobro });
  }

  async function confirmarAnio() {
    if (!datos) return;
    const conMonto = datos.filas.filter((f) => Number(montos[f.empleadoId]) > 0).length;
    if (!(await confirmar({
      titulo: `¿Confirmar el impuesto vecinal de ${datos.anio}?`,
      detalle: `${conMonto} empleado(s), ${formatCurrency(total)} en total. Se descuenta en la planilla de cada uno que contiene el ${fechaCobro.split("-").reverse().join("/")}. Reemplaza lo confirmado antes para ese año.`,
      accion: "Confirmar",
    }))) return;
    setOcupado("confirmar"); setAviso(null);
    const r = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anio: datos.anio, fechaCobro, montos: datos.filas.map((f) => ({ empleadoId: f.empleadoId, monto: Number(montos[f.empleadoId]) || 0 })) }),
    });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudo confirmar." }); return; }
    setAviso({ ok: true, texto: `Confirmado: ${d.empleados} empleado(s), ${formatCurrency(Number(d.total))}. Si la planilla de esa fecha ya existe en borrador, recalcúlela.` });
    await cargar(String(datos.anio), fechaCobro);
  }

  async function quitar() {
    if (!datos) return;
    if (!(await confirmar({ titulo: `¿Quitar lo confirmado del vecinal de ${datos.anio}?`, detalle: "La planilla de la fecha de cobro dejará de descontarlo.", accion: "Quitar", peligro: true }))) return;
    setOcupado("quitar"); setAviso(null);
    const r = await fetch(`${API}?anio=${datos.anio}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setOcupado(null);
    if (!r.ok) { setAviso({ ok: false, texto: d.error ?? "No se pudo quitar." }); return; }
    setAviso({ ok: true, texto: "Se quitó lo confirmado." });
    await cargar(String(datos.anio), fechaCobro);
  }

  if (!datos) return <section className="panel p-5 text-sm text-gray-500">Cargando el impuesto vecinal…</section>;
  const c = datos.confirmacion;
  return (
    <section className="panel space-y-5 p-5" data-seccion="vecinal-anual">
      <div>
        <h2 className="font-semibold text-gray-800">Impuesto vecinal: cuándo se cobra</h2>
        <p className="mt-1 text-sm text-gray-600">El impuesto personal se calcula sobre lo ganado en el año y se cobra a inicios del año siguiente.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Cuándo se cobra el impuesto vecinal">
        {([
          ["ANUAL", "Una vez al año, confirmado", "La planilla no lo descuenta. A inicios del año siguiente se calcula con lo pagado a cada empleado, se revisa, se confirma y se descuenta en la planilla que elija."],
          ["CADA_PLANILLA", "En cada planilla", "Un doceavo del impuesto anual en cada planilla, proyectado con el salario del período."],
        ] as const).map(([valor, titulo, texto]) => (
          <label key={valor} className={`cursor-pointer rounded-lg border-2 p-4 ${cobro === valor ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <input type="radio" name="cobro-vecinal" value={valor} checked={cobro === valor} onChange={() => setCobro(valor)} />
              {titulo}
            </span>
            <span className="mt-1 block text-xs text-gray-600">{texto}</span>
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-primary" disabled={ocupado !== null || cobro === datos.cobro} onClick={() => void guardarCobro()}>
        {ocupado === "cobro" ? "Guardando…" : "Guardar cuándo se cobra"}
      </button>

      <div className="space-y-3 border-t border-gray-200 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Calcular y confirmar el del año</h3>
          <p className="text-xs text-gray-500">
            La base es lo pagado a cada empleado en las planillas confirmadas, aprobadas o pagadas del año, más los meses importados para el ISR
            donde no hay planillas. Revise cada monto, corríjalo si hace falta y confirme: hasta entonces no se descuenta nada.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm" htmlFor="vecinal-anio">
            <span className="block font-medium text-gray-800">Ganado en el año</span>
            <input id="vecinal-anio" type="number" className="input mt-1 w-28" value={anio} onChange={(e) => setAnio(e.target.value)} />
          </label>
          <label className="block text-sm" htmlFor="vecinal-fecha">
            <span className="block font-medium text-gray-800">Se descuenta en la planilla del</span>
            <input id="vecinal-fecha" type="date" className="input mt-1" value={fechaCobro} onChange={(e) => setFechaCobro(e.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary" disabled={ocupado !== null || !anio || !fechaCobro} onClick={() => void cargar(anio, fechaCobro)}>
            {ocupado === "cargar" ? "Calculando…" : "Calcular"}
          </button>
        </div>

        {c && (
          <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900" data-vecinal-confirmado>
            Confirmado el {new Date(c.confirmadoEn).toLocaleDateString("es-HN")} por {c.confirmadoPor}: {c.empleados} empleado(s), {formatCurrency(Number(c.total))},
            en la planilla del {c.fechaCobro.split("-").reverse().join("/")}.{" "}
            <button type="button" className="font-medium underline underline-offset-2" disabled={ocupado !== null} onClick={() => void quitar()}>Quitar la confirmación</button>
          </p>
        )}

        {datos.filas.length === 0 ? (
          <p className="text-sm text-gray-600">No hay empleados activos.</p>
        ) : (
          <>
            {conPocosMeses > 0 && (
              <p className="text-xs text-amber-700">
                {conPocosMeses} empleado(s) tienen menos de 12 meses con datos en {datos.anio}: si trabajaron el año entero, importe los meses
                anteriores (Método de cálculo del ISR → Cálculo personalizado) o corrija su monto aquí.
              </p>
            )}
            <div className="max-h-96 overflow-auto rounded-lg border border-gray-200">
              <table className="table-base text-xs" data-vecinal-filas>
                <thead className="sticky top-0">
                  <tr><th>Código</th><th>Empleado</th><th className="num">Meses</th><th className="num">Ganado en el año</th><th className="num">Según la tabla</th><th className="num">A cobrar</th><th>Planilla</th></tr>
                </thead>
                <tbody>
                  {datos.filas.map((f) => (
                    <tr key={f.empleadoId}>
                      <td className="whitespace-nowrap font-mono">{f.codigo}</td>
                      <td>{f.nombre}</td>
                      <td className={`num ${f.meses < 12 ? "text-amber-700" : ""}`}>{f.meses}</td>
                      <td className="num">{formatCurrency(Number(f.base))}</td>
                      <td className="num">{formatCurrency(Number(f.impuesto))}</td>
                      <td className="num">
                        <input type="number" min={0} step="0.01" className="input w-28 text-right" aria-label={`A cobrar a ${f.nombre}`}
                          value={montos[f.empleadoId] ?? ""} onChange={(e) => setMontos({ ...montos, [f.empleadoId]: e.target.value })} />
                      </td>
                      <td className="whitespace-nowrap text-gray-500">{rangoPeriodo(f.periodo.desde, f.periodo.hasta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">Total a cobrar: <b>{formatCurrency(total)}</b></p>
              <button type="button" className="btn btn-primary" disabled={ocupado !== null || total <= 0} onClick={() => void confirmarAnio()}>
                {ocupado === "confirmar" ? "Confirmando…" : `Confirmar el vecinal de ${datos.anio}`}
              </button>
            </div>
          </>
        )}
      </div>

      {aviso && <p className={`text-sm ${aviso.ok ? "text-green-700" : "text-red-700"}`} role={aviso.ok ? "status" : "alert"}>{aviso.texto}</p>}
    </section>
  );
}
