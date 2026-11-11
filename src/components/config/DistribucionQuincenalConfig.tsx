"use client";

/**
 * Configuración → Parámetros de ley → Planilla quincenal: en qué quincena se
 * deducen IHSS, RAP e impuesto vecinal. Ver `lib/payroll/distribucion-quincenal.ts`.
 */

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { ETIQUETA_MODO_QUINCENAL, type DistribucionQuincenal, type ModoQuincenal } from "@/lib/payroll/distribucion-quincenal";

const CONCEPTOS: Array<[keyof DistribucionQuincenal, string, string]> = [
  ["ihss", "IHSS (EM e IVM)", "Del trabajador y del patrono, por porcentaje o monto fijo."],
  ["rap", "RAP", "Del trabajador y del patrono."],
  ["vecinal", "Impuesto vecinal", "Retención municipal del trabajador."],
];

const MODOS: ModoQuincenal[] = ["DIVIDIDO", "PRIMERA", "SEGUNDA"];

export default function DistribucionQuincenalConfig({ ihssMaximoMensual, onCambio }: {
  ihssMaximoMensual: number | null;
  /** Avisa el valor vigente (al cargar y al guardar) para que las tarjetas lo muestren. */
  onCambio?: (d: DistribucionQuincenal) => void;
}) {
  const [form, setForm] = useState<DistribucionQuincenal | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch("/api/configuracion/parametros/quincenal", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (r.ok) {
        setForm(d);
        onCambio?.(d);
      } else {
        setAviso({ ok: false, texto: d.error ?? "No se pudo cargar la configuración de la planilla quincenal." });
      }
    })();
    return () => { vivo = false; };
    // Se carga una vez; `onCambio` es un setter estable del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    setAviso(null);
    const r = await fetch("/api/configuracion/parametros/quincenal", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const d = await r.json().catch(() => ({}));
    setGuardando(false);
    if (r.ok) onCambio?.(form);
    setAviso(r.ok
      ? { ok: true, texto: "Guardado. Se aplica desde la próxima planilla quincenal que se calcule; un borrador toma el cambio al recalcularlo." }
      : { ok: false, texto: d.error ?? "No se pudo guardar." });
  }

  return (
    <section id="planilla-quincenal" className="panel scroll-mt-4 space-y-4 p-5" aria-labelledby="quincenal-titulo">
      <div>
        <h2 id="quincenal-titulo" className="font-semibold text-gray-800">Planilla quincenal: cuándo se deducen los aportes</h2>
        <p className="mt-1 text-sm text-gray-600">
          IHSS, RAP e impuesto vecinal son mensuales. Se pueden deducir la mitad en cada quincena, o completos en una sola
          (la primera o la segunda), calculados sobre lo ganado en el mes y con el techo mensual. El total del mes es el
          mismo. Quien no tiene días en la otra quincena (entra el 16 o sale antes del 16) paga el mes en la que sí está.
          La planilla mensual siempre descuenta el mes completo.
        </p>
        {ihssMaximoMensual !== null && (
          <p className="mt-1 text-sm text-gray-600">
            Con los valores de arriba, el IHSS del trabajador llega como máximo a{" "}
            <strong className="tnum">{formatCurrency(ihssMaximoMensual)}</strong> al mes.
          </p>
        )}
      </div>

      {!form ? (
        <p className="text-sm text-gray-500">{aviso?.texto ?? "Cargando…"}</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {CONCEPTOS.map(([clave, titulo, ayuda]) => (
              <div key={clave}>
                <label htmlFor={`quincenal-${clave}`} className="mb-1 block text-sm font-medium text-gray-800">{titulo}</label>
                <select
                  id={`quincenal-${clave}`}
                  className="input"
                  value={form[clave]}
                  aria-describedby={`quincenal-${clave}-ayuda`}
                  onChange={(e) => setForm({ ...form, [clave]: e.target.value as ModoQuincenal })}
                >
                  {MODOS.map((m) => <option key={m} value={m}>{ETIQUETA_MODO_QUINCENAL[m]}</option>)}
                </select>
                <p id={`quincenal-${clave}-ayuda`} className="mt-1 text-xs text-gray-500">{ayuda}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-3">
            {aviso && <span role="status" className={`text-sm ${aviso.ok ? "text-green-800" : "text-red-700"}`}>{aviso.texto}</span>}
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
