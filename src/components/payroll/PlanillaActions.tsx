"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  planillaId: string;
  estado: string;
}

export default function PlanillaActions({ planillaId, estado }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function cambiarEstado(nuevoEstado: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      alert("No se pudo cambiar el estado. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  async function enviarEmails() {
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}/email`, { method: "POST" });
      const data = await res.json();
      // El servidor dice por qué (sin servidor de correo, planilla sin aprobar);
      // «intente nuevamente» no ayudaba a nadie a arreglarlo.
      if (!res.ok) throw new Error(data.error ?? "No se pudieron enviar los comprobantes.");
      const partes = [`Enviados: ${data.enviados} de ${data.total}`];
      if (data.sinCorreo?.length) {
        partes.push(`Sin correo en su ficha (${data.sinCorreo.length}): ${data.sinCorreo.join(", ")}`);
      }
      if (data.errores) partes.push(`Fallaron ${data.errores}: ${data.primerError ?? "error del servidor de correo"}`);
      alert(partes.join("\n\n"));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al enviar los comprobantes.");
    } finally {
      setLoading(false);
    }
  }

  function exportarPartida() {
    window.open(`/api/planillas/${planillaId}/partida?formato=CSV`, "_blank");
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {estado !== "BORRADOR" && estado !== "ANULADA" && (
        <button
          onClick={exportarPartida}
          disabled={loading}
          className="btn btn-secondary"
        >
          Exportar partida contable
        </button>
      )}
      {estado === "CALCULADA" && (
        <button
          onClick={() => cambiarEstado("APROBADA")}
          disabled={loading}
          className="btn btn-primary"
        >
          Aprobar planilla
        </button>
      )}
      {estado === "APROBADA" && (
        <>
          <button
            onClick={() => cambiarEstado("PAGADA")}
            disabled={loading}
            className="btn btn-primary"
          >
            Marcar como pagada
          </button>
          <button
            onClick={enviarEmails}
            disabled={loading}
            className="btn btn-secondary"
          >
            Enviar comprobantes por correo
          </button>
        </>
      )}
      {estado === "PAGADA" && (
        <button
          onClick={enviarEmails}
          disabled={loading}
          className="btn btn-secondary"
        >
          Reenviar comprobantes
        </button>
      )}
      {["BORRADOR", "CALCULADA"].includes(estado) && (
        <button
          onClick={() => cambiarEstado("ANULADA")}
          disabled={loading}
          className="btn border border-red-300 bg-white text-red-700 hover:bg-red-50"
        >
          Anular planilla
        </button>
      )}
    </div>
  );
}
