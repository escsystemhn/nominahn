"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { nombreCompleto } from "@/lib/utils";

// Date cuando lo pasa el server component; string ISO cuando viene del JSON de
// /api/marcajes. Ambas fuentes son reales, así que el tipo las admite.
type FechaSerializable = Date | string;

interface Marcaje {
  id: string;
  empleadoId: string;
  fecha: FechaSerializable;
  horaEntrada: FechaSerializable | null;
  horaSalida: FechaSerializable | null;
  horasNormales: number;
  horasExtra: number;
  /** Almuerzo descontado: explica por qué 9 h en la empresa son 8 pagadas. */
  minutosDescanso: number;
  esAusencia: boolean;
  observacion: string | null;
  fuente: string;
  empleado: {
    id: string;
    codigo: string;
    primerNombre: string;
    segundoNombre?: string | null;
    primerApellido: string;
    segundoApellido?: string | null;
    sucursal: { nombre: string };
    departamento: { nombre: string };
  };
}

interface Props {
  marcajes: Marcaje[];
  empleados: Array<{
    id: string;
    codigo: string;
    primerNombre: string;
    segundoNombre?: string | null;
    primerApellido: string;
    segundoApellido?: string | null;
  }>;
  sucursales: Array<{ id: string; nombre: string }>;
  fecha: string;
  sucursalId: string;
}

export default function AsistenciaClient({ marcajes, empleados, sucursales, fecha, sucursalId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<null | "registro">(null);
  const [form, setForm] = useState({
    empleadoId: "",
    horaEntrada: "",
    horaSalida: "",
    /** Vacío = el almuerzo fijo del turno, que decide el servidor. */
    minutosDescanso: "",
    esAusencia: false,
    observacion: "",
  });

  function goFilter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const f = fd.get("fecha") as string;
    const s = fd.get("sucursalId") as string;
    if (f) params.set("fecha", f);
    if (s) params.set("sucursalId", s);
    router.push(`/asistencia?${params.toString()}`);
  }

  async function registrarMarcaje() {
    setLoading(true);
    try {
      const fechaDate = new Date(fecha + "T00:00:00");
      const horaEntrada = form.horaEntrada
        ? new Date(fecha + "T" + form.horaEntrada + ":00")
        : null;
      const horaSalida = form.horaSalida
        ? new Date(fecha + "T" + form.horaSalida + ":00")
        : null;
      const res = await fetch("/api/marcajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleadoId: form.empleadoId,
          fecha: fechaDate.toISOString(),
          horaEntrada: horaEntrada?.toISOString(),
          horaSalida: horaSalida?.toISOString(),
          esAusencia: form.esAusencia,
          observacion: form.observacion,
          fuente: "MANUAL",
          ...(form.minutosDescanso.trim() !== ""
            ? { minutosDescanso: Number(form.minutosDescanso) }
            : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? "No se pudo registrar el marcaje.");
      }
      setModal(null);
      router.refresh();
    } catch (e) {
      // El servidor dice qué falló (salida antes que entrada, descanso mayor
      // que la jornada…); un mensaje genérico dejaba al supervisor adivinando.
      alert(e instanceof Error ? e.message : "No se pudo registrar el marcaje. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  function formatHora(hora: FechaSerializable | null) {
    if (!hora) return "—";
    return new Date(hora).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <form onSubmit={goFilter} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex gap-3 flex-wrap">
        <input
          name="fecha"
          type="date"
          defaultValue={fecha}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          name="sucursalId"
          defaultValue={sucursalId}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todas las sucursales</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
        <button type="submit" className="px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900">
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setModal("registro")}
          className="ml-auto px-4 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800"
        >
          Registrar marcaje
        </button>
      </form>

      {/* Tabla de marcajes */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Empleado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Sucursal</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Entrada</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Salida</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600" title="Almuerzo descontado: no es tiempo de trabajo">Almuerzo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">H. Normales</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">H. Extra</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fuente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {marcajes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-400">
                    No hay marcajes para esta fecha
                  </td>
                </tr>
              ) : (
                marcajes.map((m) => (
                  <tr key={m.id} className={m.esAusencia ? "bg-red-50" : "hover:bg-gray-50"}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{nombreCompleto(m.empleado)}</div>
                      <div className="text-xs text-gray-400">{m.empleado.codigo}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{m.empleado.sucursal.nombre}</td>
                    <td className="px-4 py-3">{formatHora(m.horaEntrada)}</td>
                    <td className="px-4 py-3">{formatHora(m.horaSalida)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {m.minutosDescanso > 0 ? `−${m.minutosDescanso} min` : "—"}
                    </td>
                    <td className="px-4 py-3">{Number(m.horasNormales).toFixed(1)}</td>
                    <td className="px-4 py-3">
                      {Number(m.horasExtra) > 0 ? (
                        <span className="text-amber-700 font-medium">{Number(m.horasExtra).toFixed(1)}</span>
                      ) : "0.0"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        m.esAusencia ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                      }`}>
                        {m.esAusencia ? "Ausente" : "Presente"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{m.fuente}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal registro manual */}
      {modal === "registro" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900">Registrar marcaje manual</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Empleado</label>
              <select
                value={form.empleadoId}
                onChange={(e) => setForm((f) => ({ ...f, empleadoId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Seleccione...</option>
                {empleados.map((emp) => (
                  <option key={emp.id} value={emp.id}>{nombreCompleto(emp)} ({emp.codigo})</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ausencia"
                checked={form.esAusencia}
                onChange={(e) => setForm((f) => ({ ...f, esAusencia: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="ausencia" className="text-sm font-medium text-gray-700">Marcar como Ausencia</label>
            </div>

            {!form.esAusencia && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora Entrada</label>
                  <input
                    type="time"
                    value={form.horaEntrada}
                    onChange={(e) => setForm((f) => ({ ...f, horaEntrada: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hora Salida</label>
                  <input
                    type="time"
                    value={form.horaSalida}
                    onChange={(e) => setForm((f) => ({ ...f, horaSalida: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Almuerzo (minutos)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.minutosDescanso}
                    onChange={(e) => setForm((f) => ({ ...f, minutosDescanso: e.target.value }))}
                    placeholder="Vacío = 60 min del turno"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    El almuerzo no es tiempo de trabajo y se descuenta de la jornada. Escriba 0
                    si ese día no hubo almuerzo.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observación</label>
              <input
                value={form.observacion}
                onChange={(e) => setForm((f) => ({ ...f, observacion: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Opcional..."
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="flex-1 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={registrarMarcaje}
                disabled={loading || !form.empleadoId}
                className="flex-1 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg hover:bg-blue-800 disabled:bg-blue-400"
              >
                {loading ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
