"use client";

/**
 * Configuración → Parámetros de ley → RAP y Reserva Laboral: sobre el mes en curso o a
 * mes vencido. Ver `lib/payroll/rap-mes-vencido.ts`.
 */

import { useEffect, useState } from "react";
import { nombreMes, type BaseRapConfig, type ModoBaseRap } from "@/lib/payroll/rap-mes-vencido";

/** El mes siguiente al de hoy, «AAAA-MM»: lo habitual es empezar con el próximo. */
function mesSiguiente(): string {
  const hoy = new Date();
  const y = hoy.getMonth() === 11 ? hoy.getFullYear() + 1 : hoy.getFullYear();
  const m = hoy.getMonth() === 11 ? 1 : hoy.getMonth() + 2;
  return `${y}-${String(m).padStart(2, "0")}`;
}

const OPCIONES: Array<[ModoBaseRap, string, string]> = [
  ["EN_CURSO", "Sobre el mes en curso", "El RAP de noviembre sale del salario de noviembre (Art. 43 de la Ley del RAP)."],
  ["ANTERIOR", "A mes vencido", "El RAP que se descuenta en noviembre sale de lo devengado en octubre, comisiones incluidas."],
];

export default function RapMesVencidoConfig() {
  const [guardado, setGuardado] = useState<BaseRapConfig | null>(null);
  const [form, setForm] = useState<BaseRapConfig | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch("/api/configuracion/parametros/rap-base", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (r.ok) { setGuardado(d); setForm(d); }
      else setAviso({ ok: false, texto: d.error ?? "No se pudo cargar la configuración del RAP." });
    })();
    return () => { vivo = false; };
  }, []);

  const cambia = !!form && !!guardado && (form.modo !== guardado.modo || (form.modo === "ANTERIOR" && form.desde !== guardado.desde));

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setAviso(null);
    const r = await fetch("/api/configuracion/parametros/rap-base", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const d = await r.json().catch(() => ({}));
    setGuardando(false);
    if (r.ok) { setGuardado(d); setForm(d); }
    setAviso(r.ok
      ? { ok: true, texto: "Guardado. Se aplica al calcular o recalcular las planillas de esos meses." }
      : { ok: false, texto: d.error ?? "No se pudo guardar." });
  }

  return (
    <section id="rap-mes-vencido" className="panel scroll-mt-4 space-y-4 p-5" aria-labelledby="rap-base-titulo" data-rap-mes-vencido>
      <div>
        <h2 id="rap-base-titulo" className="font-semibold text-gray-800">RAP y Reserva Laboral: sobre qué mes se calculan</h2>
        <p className="mt-1 text-sm text-gray-600">
          Vale para el RAP del trabajador, el del patrono y la Reserva Laboral del 4 %. En la planilla quincenal se descuentan
          en la quincena que diga la opción de arriba.
        </p>
      </div>

      {!form ? (
        <p className="text-sm text-gray-500">{aviso?.texto ?? "Cargando…"}</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-labelledby="rap-base-titulo">
            {OPCIONES.map(([valor, titulo, detalle]) => (
              <label key={valor} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${form.modo === valor ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}>
                <input
                  type="radio"
                  name="rap-base-modo"
                  className="mt-1"
                  checked={form.modo === valor}
                  onChange={() => { setAviso(null); setForm(valor === "ANTERIOR" ? { modo: "ANTERIOR", desde: form.desde ?? guardado?.desde ?? mesSiguiente() } : { modo: "EN_CURSO", desde: null }); }}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{titulo}</span>
                  <span className="block text-xs text-gray-600">{detalle}</span>
                </span>
              </label>
            ))}
          </div>

          {form.modo === "ANTERIOR" && (
            <div className="space-y-3">
              <label className="block text-sm" htmlFor="rap-base-desde">
                <span className="block font-medium text-gray-800">Desde el mes</span>
                <input
                  id="rap-base-desde"
                  type="month"
                  className="input mt-1 w-48"
                  value={form.desde ?? ""}
                  onChange={(e) => { setAviso(null); setForm({ modo: "ANTERIOR", desde: e.target.value || null }); }}
                />
              </label>
              {form.desde && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700" data-rap-reglas>
                  <li>
                    <strong>{nombreMes(form.desde)} es de transición:</strong> lo del mes anterior ya se cotizó en su mes, así
                    que sólo se descuenta a quien tenga una base importada para {nombreMes(form.desde)}.
                  </li>
                  <li>
                    Después, la base es el salario ordinario de las planillas confirmadas del mes anterior. Para sumar las
                    comisiones o corregirla, use la columna «Base RAP (mes anterior)» de la plantilla de Deducciones → Montos
                    del período.
                  </li>
                  <li>Quien entra en un mes empieza a cotizar el mes siguiente, sobre lo que devengó en el mes de ingreso.</li>
                  <li>
                    Quien sale: su liquidación descuenta el RAP de su mes de salida y, si sus planillas no alcanzaron, el del
                    mes anterior. Con la liquidación guardada, sus planillas de ese mes ya no lo descuentan.
                  </li>
                  <li>
                    Lo descontado en el mes se paga al RAP del 1 al 10 del mes siguiente, dentro de los 15 días del Art. 43
                    de la Ley del RAP: use la Planilla RAP (histórica) de ese mes, que incluye los finiquitos. Al cierre del
                    año, provisione el aporte patronal de diciembre, que se descuenta en enero.
                  </li>
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {aviso && <span role="status" className={`text-sm ${aviso.ok ? "text-green-800" : "text-red-700"}`}>{aviso.texto}</span>}
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || !cambia || (form.modo === "ANTERIOR" && !form.desde)}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
