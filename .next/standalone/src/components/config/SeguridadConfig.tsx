"use client";

/** Configuración → Seguridad: minutos sin actividad tras los que se cierra la sesión. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { INACTIVIDAD_MAXIMA, INACTIVIDAD_MINIMA, leerMinutos, textoMinutos } from "@/lib/auth/inactividad";

const SUGERIDOS = [5, 10, 15, 30, 60];

export default function SeguridadConfig({ minutosInactividad }: { minutosInactividad: number }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [texto, setTexto] = useState(String(minutosInactividad));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lectura = leerMinutos(texto);
  const cambia = lectura.ok && lectura.valor !== minutosInactividad;

  async function guardar() {
    if (!lectura.ok) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/configuracion/seguridad", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutosInactividad: lectura.valor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar.");
      avisar.exito(`La sesión se cerrará después de ${textoMinutos(lectura.valor)} sin uso.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="panel max-w-2xl space-y-4 p-5" aria-labelledby="seguridad-inactividad" data-seguridad-inactividad>
      <div>
        <h2 id="seguridad-inactividad" className="text-base font-semibold text-gray-900">Cierre de sesión por inactividad</h2>
        <p className="mt-1 text-sm text-gray-600">
          Si nadie usa el teclado, el ratón ni la pantalla durante este tiempo, la sesión se cierra y hay que volver a
          ingresar con usuario y contraseña. Un minuto antes aparece un aviso para seguir trabajando. Rige para todas las
          cuentas y en todas las pestañas abiertas.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm" htmlFor="minutos-inactividad">
          <span className="block font-medium text-gray-800">Minutos sin actividad</span>
          <input id="minutos-inactividad" className="input mt-1 w-28" inputMode="numeric" value={texto}
            onChange={(e) => setTexto(e.target.value)} aria-describedby="minutos-inactividad-ayuda" />
        </label>
        <div className="flex flex-wrap gap-1.5 pb-0.5" role="group" aria-label="Valores comunes">
          {SUGERIDOS.map((m) => (
            <button key={m} type="button" onClick={() => setTexto(String(m))}
              className={`rounded-md border px-2.5 py-1.5 text-sm ${lectura.ok && lectura.valor === m ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
              {textoMinutos(m)}
            </button>
          ))}
        </div>
      </div>
      <p id="minutos-inactividad-ayuda" className={`text-xs ${lectura.ok ? "text-gray-500" : "text-red-700"}`}>
        {lectura.ok
          ? `Entre ${INACTIVIDAD_MINIMA} y ${INACTIVIDAD_MAXIMA} minutos. En equipos compartidos o en recepción conviene de 5 a 15. Las sesiones abiertas toman el cambio en menos de 5 minutos.`
          : lectura.error}
      </p>

      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <p className="text-sm text-gray-600">Ahora: <span className="font-medium text-gray-900">{textoMinutos(minutosInactividad)}</span></p>
        <button type="button" className="btn btn-primary" disabled={guardando || !cambia} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </section>
  );
}
