"use client";

/**
 * Conciliación de los PIN que el reloj reporta y que no tienen dueño.
 *
 * POR QUÉ ES LA PANTALLA MÁS IMPORTANTE DEL MÓDULO. Los equipos numeran a sus
 * usuarios con un correlativo propio (1, 2, 3…) que no es `Empleado.codigo`, así
 * que la PRIMERA sincronización deja aquí a la plantilla entera. Se mapea una
 * vez y, al asignar, las marcas anteriores de ese PIN se procesan hacia atrás
 * solas: nadie tiene que teclear la semana que ya pasó.
 *
 * Después queda como red de seguridad. Un alta nueva en el reloj aparece aquí en
 * vez de perderse en silencio, que es exactamente lo que convierte un descuadre
 * de planilla en algo que se ve antes de pagar.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PinEnCuarentena {
  dispositivoId: string;
  pin: string;
  marcas: number;
  primera: string | null;
  ultima: string | null;
}

export interface OpcionEmpleado {
  id: string;
  etiqueta: string;
}

export interface PinAsignado {
  pin: string;
  dispositivoId: string;
  empleado: string;
}

interface Props {
  cuarentena: PinEnCuarentena[];
  empleados: OpcionEmpleado[];
  asignados: PinAsignado[];
  nombreDispositivo: (id: string) => string;
}

function fecha(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" });
}

export default function CuarentenaPines({ cuarentena, empleados, asignados, nombreDispositivo }: Props) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);

  const clave = (p: PinEnCuarentena) => `${p.dispositivoId}|${p.pin}`;

  async function asignar(p: PinEnCuarentena) {
    const empleadoId = seleccion[clave(p)];
    if (!empleadoId) return;

    setGuardando(clave(p));
    try {
      const res = await fetch("/api/biometrico/pines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispositivoId: p.dispositivoId, pin: p.pin, empleadoId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo asignar");

      alert(
        `PIN ${p.pin} asignado.\n\n` +
          `Marcas recuperadas: ${data.eventosAdoptados}\n` +
          `Días registrados: ${data.agregacion.diasProcesados}`
      );
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo asignar el PIN.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">
            PIN sin asignar
            {cuarentena.length > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                {cuarentena.length}
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Marcas que el reloj reportó y que todavía no corresponden a ningún empleado. No se
            descartan: al asignar el PIN se procesan hacia atrás.
          </p>
        </div>

        {cuarentena.length === 0 ? (
          <p className="text-center py-10 text-gray-400 text-sm">
            Ningún PIN pendiente. Todas las marcas tienen dueño.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600">PIN</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Dispositivo</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Marcas</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Primera</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Última</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Asignar a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cuarentena.map((p) => (
                <tr key={clave(p)} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium text-blue-700">{p.pin}</td>
                  <td className="px-4 py-3 text-gray-600">{nombreDispositivo(p.dispositivoId)}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{p.marcas}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fecha(p.primera)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fecha(p.ultima)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <select
                        value={seleccion[clave(p)] ?? ""}
                        onChange={(e) =>
                          setSeleccion((s) => ({ ...s, [clave(p)]: e.target.value }))
                        }
                        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Seleccione empleado…</option>
                        {empleados.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.etiqueta}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => asignar(p)}
                        disabled={!seleccion[clave(p)] || guardando === clave(p)}
                        className="px-3 py-1.5 bg-blue-700 text-white text-xs font-medium rounded-lg hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      >
                        {guardando === clave(p) ? "Asignando…" : "Asignar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {asignados.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">PIN ya vinculados</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600">PIN</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Dispositivo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Empleado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {asignados.map((a) => (
                <tr key={`${a.dispositivoId}|${a.pin}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium text-blue-700">{a.pin}</td>
                  <td className="px-4 py-3 text-gray-600">{nombreDispositivo(a.dispositivoId)}</td>
                  <td className="px-4 py-3 text-gray-900">{a.empleado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
