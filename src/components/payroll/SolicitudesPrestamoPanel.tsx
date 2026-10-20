"use client";

/**
 * Solicitudes de préstamo y anticipo que llegan desde Mi espacio. Aprobar crea
 * la deducción a plazo; rechazar exige un motivo, que el empleado verá.
 */

import { useCallback, useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Solicitud {
  id: string;
  tipo: "PRESTAMO" | "ADELANTO";
  monto: string | number;
  cuotas: number;
  cuotaPeriodo: string | number;
  motivo: string | null;
  excedeLimite: boolean;
  limiteCuotaPeriodo: string | number | null;
  createdAt: string;
  empleado: {
    codigo: string; primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null;
    salarioBase: string | number; tipoPlanilla: string; sucursal: { nombre: string };
  };
}

const nombre = (e: Solicitud["empleado"]) => [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" ");
const periodo: Record<string, string> = { MENSUAL: "mes", QUINCENAL: "quincena", SEMANAL: "semana" };

export default function SolicitudesPrestamoPanel() {
  const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [rechazo, setRechazo] = useState<{ id: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/prestamos/solicitudes", { cache: "no-store" });
    setSolicitudes(res.ok ? await res.json() : []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  async function resolver(s: Solicitud, accion: "aprobar" | "rechazar", observacion?: string) {
    let confirmarExceso = false;
    if (accion === "aprobar" && s.excedeLimite) {
      confirmarExceso = confirm(
        `La cuota de ${formatCurrency(Number(s.cuotaPeriodo))} pasa de lo que se puede descontar del salario de ${nombre(s.empleado)} (Arts. 371 y 372 del Código del Trabajo). ¿Aprobarla de todos modos?`
      );
      if (!confirmarExceso) return;
    }
    setOcupado(s.id);
    try {
      const res = await fetch(`/api/prestamos/solicitudes/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, observacion, confirmarExceso }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo resolver");
      setAviso({ ok: true, texto: accion === "aprobar" ? `Aprobada. Se descuenta desde la próxima planilla de ${nombre(s.empleado)}.` : "Solicitud rechazada." });
      setRechazo(null);
      await cargar();
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "Error" });
    } finally {
      setOcupado(null);
    }
  }

  if (!solicitudes || solicitudes.length === 0) return aviso ? <p className="text-sm text-green-800">{aviso.texto}</p> : null;

  return (
    <section className="panel overflow-hidden" aria-labelledby="sol-prestamo">
      <div className="border-b border-gray-100 px-5 py-3">
        <h2 id="sol-prestamo" className="text-sm font-semibold text-gray-900">Solicitudes de préstamo y anticipo ({solicitudes.length})</h2>
        <p className="text-xs text-gray-500">Llegan desde Mi espacio. Al aprobar se crea la deducción y se descuenta desde la siguiente planilla.</p>
      </div>
      {aviso && <p className={`px-5 pt-3 text-sm ${aviso.ok ? "text-green-800" : "text-red-700"}`}>{aviso.texto}</p>}
      <ul className="divide-y divide-gray-100">
        {solicitudes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {nombre(s.empleado)} <span className="font-normal text-gray-500">{s.empleado.codigo}, {s.empleado.sucursal.nombre}</span>
              </p>
              <p className="text-sm text-gray-700">
                {s.tipo === "PRESTAMO" ? "Préstamo" : "Anticipo"} de {formatCurrency(Number(s.monto))} en {s.cuotas} cuotas de {formatCurrency(Number(s.cuotaPeriodo))} por {periodo[s.empleado.tipoPlanilla] ?? "período"}.
                <span className="text-gray-500"> Salario {formatCurrency(Number(s.empleado.salarioBase))}. Pedido el {formatDate(s.createdAt)}.</span>
              </p>
              {s.motivo && <p className="text-xs text-gray-500">«{s.motivo}»</p>}
              {s.excedeLimite && (
                <p className="mt-1 text-xs text-red-700">
                  Pasa del límite embargable: quedaban {formatCurrency(Number(s.limiteCuotaPeriodo ?? 0))} por período.
                </p>
              )}
              {rechazo?.id === s.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className="input max-w-sm" placeholder="Motivo del rechazo (lo verá el empleado)" value={rechazo.motivo} onChange={(e) => setRechazo({ id: s.id, motivo: e.target.value })} aria-label="Motivo del rechazo" />
                  <button type="button" className="btn btn-secondary btn-sm text-red-700" disabled={!rechazo.motivo.trim() || ocupado === s.id} onClick={() => void resolver(s, "rechazar", rechazo.motivo.trim())}>Confirmar rechazo</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRechazo(null)}>Cancelar</button>
                </div>
              )}
            </div>
            {rechazo?.id !== s.id && (
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn btn-primary btn-sm" disabled={ocupado === s.id} onClick={() => void resolver(s, "aprobar")}>Aprobar</button>
                <button type="button" className="btn btn-ghost btn-sm text-red-700" onClick={() => setRechazo({ id: s.id, motivo: "" })}>Rechazar</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
