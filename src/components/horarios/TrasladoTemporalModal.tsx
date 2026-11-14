"use client";

/**
 * Traer a alguien de otra sucursal a este plan por unos días (traslado temporal). No
 * cambia su sucursal ni su planilla: sólo dónde trabaja esos días.
 */
import { useEffect, useMemo, useState } from "react";
import { Campo } from "@/components/ui/ModalForm";

interface Candidato {
  id: string;
  codigo: string;
  nombre: string;
  sucursal: string;
  puesto: string;
}

interface Props {
  planId: string;
  desde: string;
  hasta: string;
  sucursales: { id: string; nombre: string }[];
  onListo: (aviso: string | null) => void;
  onCerrar: () => void;
}

export default function TrasladoTemporalModal({ planId, desde, hasta, sucursales, onListo, onCerrar }: Props) {
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [buscar, setBuscar] = useState("");
  const [form, setForm] = useState({ empleadoId: "", sucursalDestinoId: sucursales[0]?.id ?? "", desde, hasta, motivo: "" });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fetch(`/api/horarios/traslados?planId=${encodeURIComponent(planId)}`);
      const d = r.ok ? await r.json() : { candidatos: [] };
      if (vivo) setCandidatos(d.candidatos);
    })();
    return () => {
      vivo = false;
    };
  }, [planId]);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (candidatos ?? []).filter((c) => !q || `${c.codigo} ${c.nombre} ${c.sucursal} ${c.puesto}`.toLowerCase().includes(q));
  }, [candidatos, buscar]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Personal de otra sucursal">
      <div className="panel max-h-full w-full max-w-lg space-y-4 overflow-y-auto p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Traer personal de otra sucursal</h3>
        <p className="text-sm text-gray-600">
          Registra un <b>traslado temporal</b>: esos días la persona aparece en este plan como personal de la sucursal de destino
          y en su propia sucursal queda «trasladada». Su sucursal y su planilla no cambian.
        </p>
        <Campo etiqueta="Buscar">
          <input className="input" placeholder="Nombre, código, sucursal o puesto" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </Campo>
        <Campo etiqueta="Empleado">
          <select className="input" value={form.empleadoId} onChange={(e) => setForm({ ...form, empleadoId: e.target.value })} size={Math.min(8, Math.max(3, visibles.length))}>
            {candidatos === null && <option disabled>Cargando…</option>}
            {visibles.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre} — {c.puesto}, {c.sucursal}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="A la sucursal">
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
