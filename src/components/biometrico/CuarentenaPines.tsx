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
import { useAvisos } from "@/components/ui/Avisos";
import EstadoVacio from "@/components/ui/EstadoVacio";

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
  const { avisar } = useAvisos();
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

      avisar.exito(
        `PIN ${p.pin} asignado.\n\n` +
          `Marcas recuperadas: ${data.eventosAdoptados}\n` +
          `Días registrados: ${data.agregacion.diasProcesados}`
      );
      router.refresh();
    } catch (e) {
      avisar.error(e instanceof Error ? e.message : "No se pudo asignar el PIN.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="panel overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">
            PIN sin asignar
            {cuarentena.length > 0 && (
              <span className="ml-2 text-sm font-medium text-amber-700">
                ({cuarentena.length})
              </span>
            )}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Marcas que el reloj reportó y que todavía no corresponden a ningún empleado. No se
            descartan: al asignar el PIN se procesan hacia atrás.
          </p>
        </div>

        {cuarentena.length === 0 ? (
          <EstadoVacio
            titulo="Ningún PIN pendiente."
            detalle="Todas las marcas tienen dueño. Si el reloj reporta un PIN nuevo, aparecerá aquí para que lo asigne."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base tabla-tarjetas">
              <thead>
                <tr>
                  <th>PIN</th>
                  <th>Dispositivo</th>
                  <th className="num">Marcas</th>
                  <th>Primera</th>
                  <th>Última</th>
                  <th>Asignar a</th>
                </tr>
              </thead>
              <tbody>
                {cuarentena.map((p) => (
                  <tr key={clave(p)}>
                    <td data-titulo className="font-mono font-medium text-blue-700">{p.pin}</td>
                    <td data-etiqueta="Dispositivo" className="text-gray-600">{nombreDispositivo(p.dispositivoId)}</td>
                    <td data-etiqueta="Marcas" className="num font-medium text-gray-900">{p.marcas}</td>
                    <td data-etiqueta="Primera" className="text-gray-500 text-xs">{fecha(p.primera)}</td>
                    <td data-etiqueta="Última" className="text-gray-500 text-xs">{fecha(p.ultima)}</td>
                    <td data-accion>
                      <div className="flex gap-2">
                        <select
                          value={seleccion[clave(p)] ?? ""}
                          onChange={(e) =>
                            setSeleccion((s) => ({ ...s, [clave(p)]: e.target.value }))
                          }
                          aria-label={`Empleado para el PIN ${p.pin}`}
                          className="input flex-1 min-w-0"
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
                          className="btn btn-secondary shrink-0"
                        >
                          {guardando === clave(p) ? "Asignando…" : "Asignar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {asignados.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">PIN ya vinculados</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>PIN</th>
                  <th>Dispositivo</th>
                  <th>Empleado</th>
                </tr>
              </thead>
              <tbody>
                {asignados.map((a) => (
                  <tr key={`${a.dispositivoId}|${a.pin}`}>
                    <td className="font-mono font-medium text-blue-700">{a.pin}</td>
                    <td className="text-gray-600">{nombreDispositivo(a.dispositivoId)}</td>
                    <td className="text-gray-900">{a.empleado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
