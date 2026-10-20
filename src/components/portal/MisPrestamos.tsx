"use client";

/**
 * Mi espacio → Préstamos: lo que se le descuenta hoy, con su saldo, y la
 * solicitud de un préstamo o anticipo con la cuota calculada al momento.
 */

import { useCallback, useEffect, useState } from "react";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { evaluarSolicitud, CUOTAS_MINIMAS_ADELANTO, type LimiteDescuento } from "@/lib/payroll/prestamos";

interface Vigente {
  id: string;
  monto: string | number;
  saldo: string | number | null;
  cuotasMeses: number | null;
  cuotasPagadas: number;
  fechaInicio: string;
  tipoDeduccion: { nombre: string; tipo: string };
}

interface Solicitud {
  id: string;
  tipo: "PRESTAMO" | "ADELANTO";
  monto: string | number;
  cuotas: number;
  cuotaPeriodo: string | number;
  estado: string;
  excedeLimite: boolean;
  motivo: string | null;
  observacion: string | null;
  createdAt: string;
}

interface Datos {
  vigentes: Vigente[];
  solicitudes: Solicitud[];
  limite: LimiteDescuento | null;
  tipoPlanilla?: string;
  tipos: { PRESTAMO: boolean; ADELANTO: boolean };
}

const PERIODO: Record<string, string> = { MENSUAL: "mes", QUINCENAL: "quincena", SEMANAL: "semana" };

export default function MisPrestamos() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [form, setForm] = useState({ tipo: "PRESTAMO" as "PRESTAMO" | "ADELANTO", monto: "", cuotas: "6", motivo: "" });
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/mi-espacio/prestamos", { cache: "no-store" });
    if (res.ok) setDatos(await res.json());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  if (!datos) return <p className="text-sm text-gray-400">Cargando…</p>;

  const monto = Number(form.monto);
  const cuotas = Number(form.cuotas);
  const ev = form.monto ? evaluarSolicitud({ tipo: form.tipo, monto, cuotas, limite: datos.limite }) : null;
  const periodo = PERIODO[datos.tipoPlanilla ?? "MENSUAL"] ?? "período";
  const hayTipo = datos.tipos.PRESTAMO || datos.tipos.ADELANTO;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/mi-espacio/prestamos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: form.tipo, monto, cuotas, motivo: form.motivo || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo enviar");
      setAviso({ ok: true, texto: d.aviso ? `Solicitud enviada. ${d.aviso}` : "Solicitud enviada a Recursos Humanos." });
      setForm((f) => ({ ...f, monto: "", motivo: "" }));
      await cargar();
    } catch (err) {
      setAviso({ ok: false, texto: err instanceof Error ? err.message : "Error" });
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(id: string) {
    if (!confirm("¿Cancelar esta solicitud?")) return;
    await fetch(`/api/mi-espacio/prestamos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "cancelar" }) });
    await cargar();
  }

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden" aria-labelledby="mis-descuentos">
        <h2 id="mis-descuentos" className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">Lo que se me descuenta</h2>
        {datos.vigentes.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No tiene préstamos, anticipos ni cooperativa vigentes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead><tr><th className="px-4">Concepto</th><th className="num px-4">Cuota por {periodo}</th><th className="px-4">Avance</th><th className="num px-4">Saldo</th><th className="px-4">Desde</th></tr></thead>
              <tbody>
                {datos.vigentes.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-2.5">{v.tipoDeduccion.nombre}</td>
                    <td className="num px-4 py-2.5">{formatCurrency(Number(v.monto))}</td>
                    <td className="px-4 py-2.5 text-gray-600">{v.cuotasMeses ? `${v.cuotasPagadas} de ${v.cuotasMeses} cuotas` : `${v.cuotasPagadas} cuotas pagadas`}</td>
                    <td className="num px-4 py-2.5 font-medium">{v.saldo !== null ? formatCurrency(Number(v.saldo)) : "Recurrente"}</td>
                    <td className="tnum px-4 py-2.5">{formatDate(v.fechaInicio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={enviar} className="panel h-fit space-y-3 p-5" aria-labelledby="pedir-prestamo">
          <h2 id="pedir-prestamo" className="text-sm font-semibold text-gray-900">Pedir un préstamo o un anticipo</h2>
          {!hayTipo ? (
            <p className="text-sm text-gray-500">La empresa todavía no ofrece préstamos por esta vía. Consulte a Recursos Humanos.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pr-tipo">Tipo</label>
                  <select id="pr-tipo" className="input" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as "PRESTAMO" | "ADELANTO", cuotas: e.target.value === "ADELANTO" && Number(f.cuotas) < CUOTAS_MINIMAS_ADELANTO ? String(CUOTAS_MINIMAS_ADELANTO) : f.cuotas }))}>
                    {datos.tipos.PRESTAMO && <option value="PRESTAMO">Préstamo</option>}
                    {datos.tipos.ADELANTO && <option value="ADELANTO">Anticipo de salario</option>}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pr-monto">Monto</label>
                  <input id="pr-monto" type="number" min={1} step="0.01" className="input" value={form.monto} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pr-cuotas">Cuotas</label>
                  <input id="pr-cuotas" type="number" min={form.tipo === "ADELANTO" ? CUOTAS_MINIMAS_ADELANTO : 1} max={60} className="input" value={form.cuotas} onChange={(e) => setForm((f) => ({ ...f, cuotas: e.target.value }))} required />
                </div>
                <div className="flex flex-col justify-end">
                  <p className="text-xs text-gray-500">Cuota por {periodo}</p>
                  <p className="tnum text-lg font-semibold text-gray-900">{ev ? formatCurrency(ev.cuotaPeriodo) : "—"}</p>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor="pr-motivo">Motivo (opcional)</label>
                <textarea id="pr-motivo" rows={2} className="input" value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))} />
              </div>
              {datos.limite && (
                <p className="text-xs text-gray-500">
                  Lo máximo que se le puede descontar en préstamos es {formatCurrency(datos.limite.embargablePeriodo)} por {periodo}; ya tiene comprometidos {formatCurrency(datos.limite.comprometidoPeriodo)}.
                </p>
              )}
              {ev?.errores.length ? <p className="text-xs text-red-700">{ev.errores.join(" ")}</p> : null}
              {ev?.aviso && <p className="text-xs text-amber-800">{ev.aviso} Recursos Humanos tendrá que confirmarlo.</p>}
              {aviso && <p className={`text-sm ${aviso.ok ? "text-green-800" : "text-red-700"}`}>{aviso.texto}</p>}
              <button type="submit" className="btn btn-primary" disabled={enviando || !ev || ev.errores.length > 0}>
                {enviando ? "Enviando…" : "Enviar solicitud"}
              </button>
            </>
          )}
        </form>

        <section className="panel overflow-hidden" aria-labelledby="mis-solicitudes">
          <h2 id="mis-solicitudes" className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">Mis solicitudes</h2>
          {datos.solicitudes.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">No ha hecho solicitudes.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {datos.solicitudes.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm text-gray-900">{s.tipo === "PRESTAMO" ? "Préstamo" : "Anticipo"} de {formatCurrency(Number(s.monto))} en {s.cuotas} cuotas</p>
                    <p className="text-xs text-gray-500">{formatDate(s.createdAt)}{s.observacion ? `. ${s.observacion}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <EstadoBadge valor={s.estado} tono={s.estado === "APROBADA" ? "ok" : undefined} />
                    {s.estado === "PENDIENTE" && <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => void cancelar(s.id)}>Cancelar</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
