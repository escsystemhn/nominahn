"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAvisos } from "@/components/ui/Avisos";
import { nombreCompleto } from "@/lib/utils";
import EstadoBadge from "@/components/ui/EstadoBadge";
import EstadoVacio from "@/components/ui/EstadoVacio";
import CampoEmpleado, { type EmpleadoBuscado } from "@/components/employees/CampoEmpleado";
import type { NivelesEstructura } from "@/lib/organizacion/estructura";

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
  sucursales: Array<{ id: string; nombre: string }>;
  fecha: string;
  sucursalId: string;
  niveles: NivelesEstructura;
}

/** De dónde salió cada marcaje. */
const FUENTE_MARCAJE: Record<string, string> = {
  BIOMETRICO: "Reloj biométrico",
  MANUAL: "Manual",
  PLANTILLA: "Plantilla de Excel",
};

export default function AsistenciaClient({ marcajes, sucursales, fecha, sucursalId, niveles }: Props) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<null | "registro">(null);
  // El elegido en el buscador (para su tarjeta); `form.empleadoId` es lo que se envía.
  const [empleado, setEmpleado] = useState<EmpleadoBuscado | null>(null);
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
      avisar.error(e instanceof Error ? e.message : "No se pudo registrar el marcaje. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  function formatHora(hora: FechaSerializable | null) {
    if (!hora) return "—";
    return new Date(hora).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <form onSubmit={goFilter} className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="block text-sm font-medium text-gray-800">
          <span className="mb-1 block">Fecha</span>
          <input name="fecha" type="date" defaultValue={fecha} className="input font-normal" />
        </label>
        <label className="block text-sm font-medium text-gray-800">
          <span className="mb-1 block">{niveles.sucursal}</span>
          <select name="sucursalId" defaultValue={sucursalId} className="input font-normal">
            <option value="">{niveles.todasSucursales}</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Buscar
        </button>
        <button type="button" onClick={() => setModal("registro")} className="btn btn-primary ml-auto">
          Registrar marcaje
        </button>
      </form>

      {/* Tabla de marcajes */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base tabla-tarjetas">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>{niveles.sucursal}</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th title="Almuerzo descontado: no es tiempo de trabajo">Almuerzo</th>
                <th className="num">H. normales</th>
                <th className="num">H. extra</th>
                <th>Estado</th>
                <th>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {marcajes.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EstadoVacio
                      titulo="No hay marcajes para esta fecha."
                      detalle={`Cambie de fecha o de ${niveles.sucursal.toLowerCase()}, o use el botón Registrar marcaje para anotar uno a mano.`}
                    />
                  </td>
                </tr>
              ) : (
                marcajes.map((m) => (
                  <tr key={m.id}>
                    <td data-titulo>
                      <div className="font-medium text-gray-900">{nombreCompleto(m.empleado)}</div>
                      <div className="text-xs text-gray-500">{m.empleado.codigo}</div>
                    </td>
                    <td data-etiqueta={niveles.sucursal} className="text-gray-600">{m.empleado.sucursal.nombre}</td>
                    <td data-etiqueta="Entrada" className="whitespace-nowrap">{formatHora(m.horaEntrada)}</td>
                    <td data-etiqueta="Salida" className="whitespace-nowrap">{formatHora(m.horaSalida)}</td>
                    <td data-etiqueta="Almuerzo" className="whitespace-nowrap text-gray-500">
                      {m.minutosDescanso > 0 ? `−${m.minutosDescanso} min` : "—"}
                    </td>
                    <td data-etiqueta="H. normales" className="num">{Number(m.horasNormales).toFixed(1)}</td>
                    <td data-etiqueta="H. extra" className="num">
                      {Number(m.horasExtra) > 0 ? (
                        <span className="font-medium text-gray-900">{Number(m.horasExtra).toFixed(1)}</span>
                      ) : "0.0"}
                    </td>
                    <td data-etiqueta="Estado">
                      {m.esAusencia ? (
                        <EstadoBadge valor="AUSENTE" etiqueta="Ausente" tono="error" />
                      ) : (
                        <EstadoBadge valor="PRESENTE" etiqueta="Presente" tono="ok" />
                      )}
                    </td>
                    <td data-etiqueta="Fuente" className="text-xs text-gray-500">{FUENTE_MARCAJE[m.fuente] ?? m.fuente}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal registro manual */}
      {modal === "registro" && (
        // Con desplazamiento propio: la lista de resultados del buscador va dentro de la
        // ventana y, en una pantalla baja, la alargaría por debajo del borde.
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="panel max-h-full w-full max-w-md space-y-4 overflow-y-auto p-6 shadow-2xl">
            <h3 className="font-semibold text-gray-900">Registrar marcaje manual</h3>

            {/* Buscar en vez de una lista con todos los activos: con cientos no se encontraba a
                nadie. El contexto «asistencia» ofrece los mismos (activos, de su alcance y de la
                sucursal que se está viendo, si hay filtro). */}
            <CampoEmpleado
              etiqueta="Empleado"
              para="asistencia"
              parametros={{ sucursalId }}
              valor={empleado}
              onCambio={(e) => {
                setEmpleado(e);
                setForm((f) => ({ ...f, empleadoId: e?.id ?? "" }));
              }}
            />

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ausencia"
                checked={form.esAusencia}
                onChange={(e) => setForm((f) => ({ ...f, esAusencia: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="ausencia" className="text-sm font-medium text-gray-800">Marcar como ausencia</label>
            </div>

            {!form.esAusencia && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="marcaje-entrada" className="mb-1 block text-sm font-medium text-gray-800">Hora de entrada</label>
                  <input
                    id="marcaje-entrada"
                    type="time"
                    value={form.horaEntrada}
                    onChange={(e) => setForm((f) => ({ ...f, horaEntrada: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="marcaje-salida" className="mb-1 block text-sm font-medium text-gray-800">Hora de salida</label>
                  <input
                    id="marcaje-salida"
                    type="time"
                    value={form.horaSalida}
                    onChange={(e) => setForm((f) => ({ ...f, horaSalida: e.target.value }))}
                    className="input"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="marcaje-almuerzo" className="mb-1 block text-sm font-medium text-gray-800">
                    Almuerzo (minutos)
                  </label>
                  <input
                    id="marcaje-almuerzo"
                    type="number"
                    min={0}
                    value={form.minutosDescanso}
                    onChange={(e) => setForm((f) => ({ ...f, minutosDescanso: e.target.value }))}
                    placeholder="Vacío = 60 min del turno"
                    className="input"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    El almuerzo no es tiempo de trabajo y se descuenta de la jornada. Escriba 0
                    si ese día no hubo almuerzo.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="marcaje-obs" className="mb-1 block text-sm font-medium text-gray-800">Observación</label>
              <input
                id="marcaje-obs"
                value={form.observacion}
                onChange={(e) => setForm((f) => ({ ...f, observacion: e.target.value }))}
                className="input"
                placeholder="Opcional…"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setModal(null)} className="btn btn-secondary flex-1">
                Cancelar
              </button>
              <button
                type="button"
                onClick={registrarMarcaje}
                disabled={loading || !form.empleadoId}
                className="btn btn-primary flex-1"
              >
                {loading ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
