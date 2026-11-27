"use client";

/**
 * Traer a alguien de otra sucursal a este plan por unos días (traslado temporal). No
 * cambia su sucursal ni su planilla: sólo dónde trabaja esos días.
 */
import { useState } from "react";
import { Campo } from "@/components/ui/ModalForm";
import CampoEmpleado, { type EmpleadoBuscado } from "@/components/employees/CampoEmpleado";
import type { NivelesEstructura } from "@/lib/organizacion/estructura";

interface Props {
  planId: string;
  desde: string;
  hasta: string;
  sucursales: { id: string; nombre: string }[];
  niveles: NivelesEstructura;
  onListo: (aviso: string | null) => void;
  onCerrar: () => void;
}

export default function TrasladoTemporalModal({ planId, desde, hasta, sucursales, niveles, onListo, onCerrar }: Props) {
  // El elegido en el buscador (para su tarjeta); `form.empleadoId` es lo que se envía.
  const [empleado, setEmpleado] = useState<EmpleadoBuscado | null>(null);
  const [form, setForm] = useState({ empleadoId: "", sucursalDestinoId: sucursales[0]?.id ?? "", desde, hasta, motivo: "" });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const r = await fetch("/api/horarios/traslados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, motivo: form.motivo || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(typeof d.error === "string" ? d.error : "No se pudo registrar el traslado.");
        return;
      }
      onListo(d.aviso ?? null);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Personal de fuera del plan">
      <div className="panel max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Traer personal de fuera del plan</h3>
        <p className="text-sm text-gray-600">
          Registra un <b>traslado temporal</b>: esos días la persona aparece en este plan como personal del destino elegido
          y en su {niveles.sucursal.toLowerCase()} de origen queda «trasladada». Su {niveles.sucursal.toLowerCase()} y su planilla no cambian.
        </p>
        {/* Buscar en el servidor en vez de bajar a todos los candidatos (hasta mil) y filtrarlos
            aquí. El contexto «traslado» aplica los filtros del plan: no dados de baja ni
            suspendidos, con puesto, de otras sucursales e ingresados antes de que termine. Fuera
            de <Campo>, que es un <label> y no puede contener al buscador. */}
        <CampoEmpleado
          etiqueta="Empleado"
          para="traslado"
          parametros={{ planId }}
          vacio="Nadie coincide. Sólo se ofrece personal con puesto de fuera de este plan."
          valor={empleado}
          onCambio={(e) => {
            setEmpleado(e);
            setForm((f) => ({ ...f, empleadoId: e?.id ?? "" }));
          }}
        />
        <Campo etiqueta={`${niveles.sucursal} de destino`}>
          <select className="input" value={form.sucursalDestinoId} onChange={(e) => setForm({ ...form, sucursalDestinoId: e.target.value })}>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Desde">
            <input className="input" type="date" value={form.desde} min={desde} max={hasta} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
          </Campo>
          <Campo etiqueta="Hasta">
            <input className="input" type="date" value={form.hasta} min={form.desde} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
          </Campo>
        </div>
        <Campo etiqueta="Motivo (opcional)">
          <input className="input" maxLength={200} placeholder="Ej.: cubrir vacaciones, inventario" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
        </Campo>
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primary" disabled={guardando || !form.empleadoId || !form.sucursalDestinoId || !form.desde || !form.hasta} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : "Registrar traslado"}
          </button>
        </div>
      </div>
    </div>
  );
}
