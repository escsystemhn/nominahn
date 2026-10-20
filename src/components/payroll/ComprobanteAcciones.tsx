"use client";

/**
 * Comprobante de UN empleado dentro de la planilla: su estado de envío y las
 * acciones de verlo, descargarlo y enviárselo (o reenviárselo) por correo.
 *
 * Antes sólo existía «Enviar comprobantes por email» para toda la planilla, sin
 * forma de ver el documento de nadie ni de reenviar el de una persona que dice
 * que no le llegó.
 *
 * Estado y acciones van en UNA columna a propósito: la tabla ya es ancha y en
 * dos columnas el botón de enviar quedaba fuera de la pantalla.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  planillaId: string;
  detalleId: string;
  empleadoId: string;
  /** A dónde se enviaría; `null` si la ficha no tiene ningún correo. */
  correo: string | null;
  enviado: boolean;
  /** Aprobada o pagada, y el usuario tiene `planillas.boletas`. */
  puedeEnviar: boolean;
}

export default function ComprobanteAcciones({
  planillaId, detalleId, empleadoId, correo, enviado, puedeEnviar,
}: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!correo) return;
    if (!confirm(`¿${enviado ? "Reenviar" : "Enviar"} el comprobante a ${correo}?`)) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoIds: [empleadoId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo enviar");
      if (data.enviados === 1) alert(`Comprobante enviado a ${correo}.`);
      else throw new Error(data.primerError ?? "El servidor de correo rechazó el envío.");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo enviar el comprobante.");
    } finally {
      setEnviando(false);
    }
  }

  const url = `/api/mis-boletas/${detalleId}`;
  const enlace = "text-blue-700 hover:underline";
  return (
    <div className="text-center whitespace-nowrap leading-tight">
      {enviado ? (
        <span className="text-green-600 text-[11px]">✓ Enviado</span>
      ) : correo ? (
        <span className="text-gray-400 text-[11px]">Pendiente</span>
      ) : (
        // Se ve ANTES de enviar: quién no recibirá su comprobante.
        <span className="text-amber-600 text-[11px]" title="Registre el correo en la ficha del empleado">
          Sin correo
        </span>
      )}
      <div className="mt-1 text-[11px] space-x-2">
        <a href={`${url}?modo=ver`} target="_blank" rel="noopener noreferrer" className={enlace}>Ver</a>
        <a href={url} className="text-gray-500 hover:underline">Descargar</a>
        {puedeEnviar && correo && (
          <button onClick={enviar} disabled={enviando} title={`Enviar a ${correo}`}
            className="text-green-700 hover:underline disabled:opacity-40">
            {enviando ? "Enviando…" : enviado ? "Reenviar" : "Enviar"}
          </button>
        )}
      </div>
    </div>
  );
}
