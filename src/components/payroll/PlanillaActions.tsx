"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";

interface Props {
  planillaId: string;
  estado: string;
  /** Generar, recalcular, confirmar y descartar un borrador. */
  puedeCalcular: boolean;
}

export default function PlanillaActions({ planillaId, estado, puedeCalcular }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function cambiarEstado(nuevoEstado: string, pregunta?: string) {
    if (pregunta && !confirm(pregunta)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "No se pudo cambiar el estado. Intente nuevamente.");
        // Si el borrador se actualizó al intentar confirmarlo, hay que ver las cifras nuevas.
        if (d.recalculada) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      alert("No se pudo cambiar el estado. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  async function recalcular() {
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}/recalcular`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(d.error ?? "No se pudo recalcular. Intente nuevamente.");
        return;
      }
      const antes = Number(d.netoAnterior);
      const ahora = Number(d.netoNuevo);
      alert(antes === ahora
        ? `Recalculada con los datos actuales. El neto no cambió: ${formatCurrency(ahora)}.`
        : `Recalculada con los datos actuales. El neto pasó de ${formatCurrency(antes)} a ${formatCurrency(ahora)}.`);
      router.refresh();
    } catch {
      alert("No se pudo recalcular. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  async function descartar() {
    if (!confirm("Se borrará este borrador. No afecta préstamos, bonos ni empleados. ¿Descartarlo?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "No se pudo descartar. Intente nuevamente.");
        setLoading(false);
        return;
      }
      router.push("/planillas");
      router.refresh();
    } catch {
      alert("No se pudo descartar. Intente nuevamente.");
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
      {estado === "BORRADOR" && puedeCalcular && (
        <>
          <button onClick={recalcular} disabled={loading} className="btn btn-secondary">
            Recalcular
          </button>
          <button
            onClick={() => cambiarEstado("CALCULADA", "Al confirmar se cobran las cuotas de préstamos y se marcan los bonos de evaluación. ¿Confirmar la planilla?")}
            disabled={loading}
            className="btn btn-primary"
          >
            Confirmar planilla
          </button>
        </>
      )}
      {estado !== "ANULADA" && (
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
      {estado === "CALCULADA" && puedeCalcular && (
        <button
          onClick={() => cambiarEstado("BORRADOR", "Se devolverán las cuotas y los bonos que cobró esta planilla, y podrá recalcularla. ¿Volver a borrador?")}
          disabled={loading}
          className="btn btn-secondary"
        >
          Volver a borrador
        </button>
      )}
      {estado === "BORRADOR" && puedeCalcular && (
        <button
          onClick={descartar}
          disabled={loading}
          className="btn border border-red-300 bg-white text-red-700 hover:bg-red-50"
        >
          Descartar borrador
        </button>
      )}
      {estado === "CALCULADA" && (
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
