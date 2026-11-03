"use client";

/**
 * Pestaña «Contrato laboral» del expediente: el contrato vigente, el historial y
 * el registro de uno nuevo. Las reglas las aplica la API (lib/empleados/contratos.ts).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import EstadoBadge from "@/components/ui/EstadoBadge";
import { Modal, Campo } from "@/components/ui/ModalForm";
import { formatCurrency, formatDate } from "@/lib/utils";
import { situacionContrato } from "@/lib/empleados/contratos";

export interface ContratoFicha {
  id: string;
  tipoContrato: string;
  fechaInicio: string;
  fechaFin: string | null;
  salario: number;
  cargo: string;
  jornada: string | null;
  horario: string | null;
  observaciones: string | null;
  activo: boolean;
}

const TIPOS: Record<string, string> = {
  INDEFINIDO: "Indefinido",
  TEMPORAL: "Temporal",
  PRUEBA: "Período de prueba",
  SERVICIO: "Servicios",
};

const dia = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

async function enviar(url: string, method: string, body: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.error ?? "No se pudo guardar. Intente de nuevo.";
}

export default function ContratosEmpleado({ empleadoId, contratos, hoy, datosFicha, dadoDeBaja, puedeEditar }: {
  empleadoId: string;
  /** Del más reciente al más antiguo. */
  contratos: ContratoFicha[];
  hoy: string;
  /** Lo que propone el formulario de un contrato nuevo. */
  datosFicha: { tipoContrato: string; salario: number; cargo: string; fechaIngreso: string };
  dadoDeBaja: boolean;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [edicion, setEdicion] = useState<null | "nuevo" | ContratoFicha>(null);
  const vigente = contratos.find((c) => c.activo) ?? null;
  const hoyFecha = new Date(hoy);
  const cerrar = () => setEdicion(null);
  const listo = () => { setEdicion(null); router.refresh(); };

  return (
    <div className="panel p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">Historial de contratos</h2>
        {puedeEditar && !dadoDeBaja && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEdicion("nuevo")}>
            {contratos.length === 0 ? "Registrar contrato" : "Nuevo contrato o renovación"}
          </button>
        )}
      </div>

      {contratos.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no tiene contratos registrados.{puedeEditar && !dadoDeBaja ? " Registre el actual para empezar su historial." : ""}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Tipo</th><th>Cargo</th><th>Inicio</th><th>Fin</th><th className="num">Salario</th><th>Situación</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-gray-900">{TIPOS[c.tipoContrato] ?? c.tipoContrato}</td>
                  <td>
                    {c.cargo}
                    {c.observaciones && <span className="block text-xs text-gray-500">{c.observaciones}</span>}
                  </td>
                  <td className="whitespace-nowrap">{formatDate(c.fechaInicio)}</td>
                  <td className="whitespace-nowrap">{c.fechaFin ? formatDate(c.fechaFin) : "—"}</td>
                  <td className="num whitespace-nowrap">{formatCurrency(c.salario)}</td>
                  <td><EstadoBadge valor={situacionContrato(c, hoyFecha)} /></td>
                  <td className="text-right">
                    {puedeEditar && c.activo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdicion(c)}>Editar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dadoDeBaja && <p className="mt-3 text-xs text-gray-500">Está dado de baja. Para registrarle otro contrato, reincorpórelo primero en su ficha.</p>}

      {edicion === "nuevo" && (
        <FormNuevo empleadoId={empleadoId} vigente={vigente} hoy={hoy} datosFicha={datosFicha} primero={contratos.length === 0} onCerrar={cerrar} onListo={listo} />
      )}
      {edicion !== null && edicion !== "nuevo" && (
        <FormEditar empleadoId={empleadoId} contrato={edicion} onCerrar={cerrar} onListo={listo} />
      )}
    </div>
  );
}

function FormNuevo({ empleadoId, vigente, hoy, datosFicha, primero, onCerrar, onListo }: {
  empleadoId: string; vigente: ContratoFicha | null; hoy: string; primero: boolean;
  datosFicha: { tipoContrato: string; salario: number; cargo: string; fechaIngreso: string };
  onCerrar: () => void; onListo: () => void;
}) {
  const [f, setF] = useState({
    tipoContrato: vigente?.tipoContrato ?? datosFicha.tipoContrato,
    fechaInicio: primero ? dia(datosFicha.fechaIngreso) : dia(hoy),
    fechaFin: "",
    salario: String(datosFicha.salario),
    cargo: vigente?.cargo ?? datosFicha.cargo,
    jornada: vigente?.jornada ?? "",
    horario: vigente?.horario ?? "",
    observaciones: "",
  });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const salario = Number(f.salario);
  const cambiaSalario = salario > 0 && salario !== datosFicha.salario;

  async function guardar() {
    setCargando(true);
    const e = await enviar(`/api/empleados/${empleadoId}/contratos`, "POST", {
      tipoContrato: f.tipoContrato,
      fechaInicio: f.fechaInicio,
      // El campo se apaga con Indefinido, pero conserva lo que tuviera escrito.
      fechaFin: f.tipoContrato === "INDEFINIDO" ? null : f.fechaFin || null,
      salario,
      cargo: f.cargo,
      jornada: f.jornada || null,
      horario: f.horario || null,
      observaciones: f.observaciones || null,
    });
    setCargando(false);
    setError(e);
    if (!e) onListo();
  }

  return (
    <Modal titulo={primero ? "Registrar contrato" : "Nuevo contrato o renovación"} error={error} cargando={cargando}
      puedeGuardar={!!f.fechaInicio && salario > 0 && !!f.cargo.trim()} onCerrar={onCerrar} onGuardar={guardar}>
      <Campo etiqueta="Tipo de contrato">
        <select className="input" value={f.tipoContrato} onChange={(e) => setF({ ...f, tipoContrato: e.target.value })}>
          {Object.entries(TIPOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Inicio"><input className="input" type="date" value={f.fechaInicio} max={dia(hoy)} onChange={(e) => setF({ ...f, fechaInicio: e.target.value })} /></Campo>
        <Campo etiqueta={f.tipoContrato === "TEMPORAL" || f.tipoContrato === "PRUEBA" ? "Fin" : "Fin (opcional)"}>
          <input className="input" type="date" value={f.fechaFin} disabled={f.tipoContrato === "INDEFINIDO"} onChange={(e) => setF({ ...f, fechaFin: e.target.value })} />
        </Campo>
      </div>
      <Campo etiqueta="Cargo"><input className="input" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} /></Campo>
      <Campo etiqueta="Salario mensual (L)"><input className="input" type="number" min="0" step="0.01" value={f.salario} onChange={(e) => setF({ ...f, salario: e.target.value })} /></Campo>
      {cambiaSalario && <p className="text-xs text-amber-700">El salario de la ficha cambiará a {formatCurrency(salario)} y quedará en el historial de salarios.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Jornada (opcional)"><input className="input" value={f.jornada} onChange={(e) => setF({ ...f, jornada: e.target.value })} /></Campo>
        <Campo etiqueta="Horario (opcional)"><input className="input" value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} /></Campo>
      </div>
      <Campo etiqueta="Observaciones (opcional)"><input className="input" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Campo>
      {vigente && <p className="text-xs text-gray-500">El contrato vigente se cerrará el día anterior al inicio de este y quedará en el historial.</p>}
    </Modal>
  );
}

function FormEditar({ empleadoId, contrato, onCerrar, onListo }: { empleadoId: string; contrato: ContratoFicha; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({
    fechaFin: dia(contrato.fechaFin),
    cargo: contrato.cargo,
    jornada: contrato.jornada ?? "",
    horario: contrato.horario ?? "",
    observaciones: contrato.observaciones ?? "",
  });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setCargando(true);
    const e = await enviar(`/api/empleados/${empleadoId}/contratos/${contrato.id}`, "PATCH", {
      fechaFin: f.fechaFin || null,
      cargo: f.cargo,
      jornada: f.jornada || null,
      horario: f.horario || null,
      observaciones: f.observaciones || null,
    });
    setCargando(false);
    setError(e);
    if (!e) onListo();
  }

  return (
    <Modal titulo="Editar contrato vigente" error={error} cargando={cargando} puedeGuardar={!!f.cargo.trim()} onCerrar={onCerrar} onGuardar={guardar}>
      <Campo etiqueta="Cargo"><input className="input" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} /></Campo>
      <Campo etiqueta="Fecha de fin"><input className="input" type="date" value={f.fechaFin} disabled={contrato.tipoContrato === "INDEFINIDO"} onChange={(e) => setF({ ...f, fechaFin: e.target.value })} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Jornada"><input className="input" value={f.jornada} onChange={(e) => setF({ ...f, jornada: e.target.value })} /></Campo>
        <Campo etiqueta="Horario"><input className="input" value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} /></Campo>
      </div>
      <Campo etiqueta="Observaciones"><input className="input" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Campo>
      <p className="text-xs text-gray-500">El tipo, el inicio y el salario no se editan: para cambiarlos, registre un contrato nuevo.</p>
    </Modal>
  );
}
