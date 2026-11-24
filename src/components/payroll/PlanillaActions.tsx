"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { useAvisos, type OpcionesConfirmar, type OpcionesMotivo } from "@/components/ui/Avisos";

interface Props {
  planillaId: string;
  estado: string;
  /** Generar, recalcular, confirmar y descartar un borrador. */
  puedeCalcular: boolean;
  /** Quien aprueba y quien paga son funciones separadas: cada uno ve sólo lo suyo. */
  puedeAprobar: boolean;
  puedePagar: boolean;
  puedeAnular: boolean;
  /** Devolver a cálculo o anular una planilla ya aprobada. */
  puedeReabrir: boolean;
  puedeAnularPagada: boolean;
  /** Para decir en cada confirmación a cuánta gente y a cuánto dinero afecta. */
  empleados: number;
  neto: string;
  /** En una frase, lo que encontró la revisión contra la planilla anterior. */
  revision?: string;
}

export default function PlanillaActions({
  planillaId,
  estado,
  puedeCalcular,
  puedeAprobar,
  puedePagar,
  puedeAnular,
  puedeReabrir,
  puedeAnularPagada,
  empleados,
  neto,
  revision,
}: Props) {
  const router = useRouter();
  const { confirmar, pedirMotivo, avisar } = useAvisos();
  const [loading, setLoading] = useState(false);
  const personas = empleados === 1 ? "1 empleado" : `${empleados} empleados`;

  async function cambiarEstado(nuevoEstado: string, pregunta: OpcionesConfirmar, hecho: string) {
    if (await confirmar(pregunta)) await enviarCambio(nuevoEstado, hecho);
  }

  // Lo que deshace un cierre exige justificación escrita: queda en la auditoría.
  async function cambiarConMotivo(nuevoEstado: string, pregunta: OpcionesMotivo, hecho: string) {
    const motivo = await pedirMotivo(pregunta);
    if (motivo !== null) await enviarCambio(nuevoEstado, hecho, motivo);
  }

  async function enviarCambio(nuevoEstado: string, hecho: string, motivo?: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado, motivo }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        avisar.error(d.error ?? "No se pudo cambiar el estado de la planilla.");
        // Si el borrador se actualizó al intentar confirmarlo, hay que ver las cifras nuevas.
        if (d.recalculada) router.refresh();
        return;
      }
      avisar.exito(hecho);
      router.refresh();
    } catch {
      avisar.error("No se pudo conectar con el servidor. Intente de nuevo.");
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
        avisar.error(d.error ?? "No se pudo recalcular la planilla.");
        return;
      }
      const antes = Number(d.netoAnterior);
      const ahora = Number(d.netoNuevo);
      avisar.exito(antes === ahora
        ? `Recalculada con los datos actuales. El neto no cambió: ${formatCurrency(ahora)}.`
        : `Recalculada con los datos actuales. El neto pasó de ${formatCurrency(antes)} a ${formatCurrency(ahora)}.`);
      router.refresh();
    } catch {
      avisar.error("No se pudo conectar con el servidor. Intente de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function descartar() {
    const seguro = await confirmar({
      titulo: "¿Descartar este borrador?",
      detalle: "Se borrará la planilla. No afecta préstamos, bonos ni empleados, porque un borrador todavía no ha cobrado nada.",
      accion: "Descartar borrador",
      peligro: true,
    });
    if (!seguro) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        avisar.error(d.error ?? "No se pudo descartar el borrador.");
        setLoading(false);
        return;
      }
      avisar.exito("Borrador descartado.");
      router.push("/planillas");
      router.refresh();
    } catch {
      avisar.error("No se pudo conectar con el servidor. Intente de nuevo.");
      setLoading(false);
    }
  }

  function exportarPartida() {
    window.open(`/api/planillas/${planillaId}/partida?formato=CSV`, "_blank");
  }

  const botonPeligro = "btn border border-red-300 bg-white text-red-700 hover:bg-red-50";
  const seAnulo = "Planilla anulada. Se devolvieron sus cuotas y bonos.";
  const conSap = "Si ya tiene asiento en SAP, se generará su reverso.";

  return (
    <div className="flex gap-2 flex-wrap">
      {estado !== "ANULADA" && (
        <button onClick={exportarPartida} disabled={loading} className="btn btn-secondary">
          Exportar partida contable
        </button>
      )}

      {estado === "BORRADOR" && puedeCalcular && (
        <>
          <button onClick={descartar} disabled={loading} className={botonPeligro}>
            Descartar borrador
          </button>
          <button onClick={recalcular} disabled={loading} className="btn btn-secondary">
            Recalcular
          </button>
          <button
            onClick={() => cambiarEstado("CALCULADA", {
              titulo: "¿Confirmar la planilla?",
              detalle: <>{personas}, neto de {neto}. {revision && `${revision} `}Se cobrarán las cuotas de préstamos y se marcarán los bonos de evaluación. Podrá volver a borrador mientras no esté aprobada.</>,
              accion: "Confirmar planilla",
            }, "Planilla confirmada. Sus cuotas y bonos ya se aplicaron.")}
            disabled={loading}
            className="btn btn-primary"
          >
            Confirmar planilla
          </button>
        </>
      )}

      {estado === "CALCULADA" && (
        <>
          {puedeAnular && (
            <button
              onClick={() => cambiarEstado("ANULADA", {
                titulo: "¿Anular la planilla?",
                detalle: "Se devolverán las cuotas y los bonos que cobró, y el período quedará libre para generar otra. Esto no se puede deshacer.",
                accion: "Anular planilla",
                peligro: true,
              }, "Planilla anulada. Se devolvieron sus cuotas y bonos.")}
              disabled={loading}
              className={botonPeligro}
            >
              Anular planilla
            </button>
          )}
          {puedeCalcular && (
            <button
              onClick={() => cambiarEstado("BORRADOR", {
                titulo: "¿Volver a borrador?",
                detalle: "Se devolverán las cuotas y los bonos que cobró esta planilla, y podrá recalcularla.",
                accion: "Volver a borrador",
              }, "La planilla volvió a borrador. Se devolvieron sus cuotas y bonos.")}
              disabled={loading}
              className="btn btn-secondary"
            >
              Volver a borrador
            </button>
          )}
          {puedeAprobar && (
            <button
              onClick={() => cambiarEstado("APROBADA", {
                titulo: "¿Aprobar la planilla?",
                detalle: <>{personas}, neto de {neto}. {revision && `${revision} `}Quedará cerrada, con sus importes sellados, y cada empleado podrá ver su comprobante. Si SAP está configurado para enviar al aprobar, el asiento saldrá en este momento.</>,
                accion: "Aprobar planilla",
              }, "Planilla aprobada.")}
              disabled={loading}
              className="btn btn-primary"
            >
              Aprobar planilla
            </button>
          )}
        </>
      )}

      {estado === "APROBADA" && (
        <>
          {puedeReabrir && (
            <button
              onClick={() => cambiarConMotivo("ANULADA", {
                titulo: "¿Anular la planilla aprobada?",
                detalle: `Se devolverán las cuotas y los bonos que cobró, y el período quedará libre para generar otra. ${conSap} Esto no se puede deshacer.`,
                etiquetaMotivo: "Motivo de la anulación",
                accion: "Anular planilla",
                peligro: true,
              }, seAnulo)}
              disabled={loading}
              className={botonPeligro}
            >
              Anular planilla
            </button>
          )}
          {puedeReabrir && (
            <button
              onClick={() => cambiarConMotivo("CALCULADA", {
                titulo: "¿Reabrir la planilla?",
                detalle: "Vuelve a Confirmada y pierde su sello de cierre. Los empleados dejan de ver su comprobante hasta que se apruebe de nuevo. Las cuotas siguen cobradas: para cambiar importes, después vuélvala a borrador. Si ya tiene asiento en SAP no podrá volver a borrador, y para corregirla tendrá que anularla.",
                etiquetaMotivo: "Motivo de la reapertura",
                accion: "Reabrir planilla",
                peligro: true,
              }, "Planilla reabierta. Ya no está cerrada.")}
              disabled={loading}
              className="btn btn-secondary"
            >
              Reabrir planilla
            </button>
          )}
          {puedePagar && (
            <button
              onClick={() => cambiarEstado("PAGADA", {
                titulo: "¿Marcar la planilla como pagada?",
                detalle: <>Registra que ya se pagaron {neto} a {personas}. Una planilla pagada ya no vuelve a edición. Si SAP está configurado para enviar al pagar, el asiento saldrá en este momento.</>,
                accion: "Marcar como pagada",
              }, "Planilla marcada como pagada.")}
              disabled={loading}
              className="btn btn-primary"
            >
              Marcar como pagada
            </button>
          )}
        </>
      )}

      {estado === "PAGADA" && puedeAnularPagada && (
        <button
          onClick={() => cambiarConMotivo("ANULADA", {
            titulo: "¿Anular la planilla pagada?",
            detalle: <>Ya se registró el pago de {neto} a {personas}: anular no recupera ese dinero, eso se gestiona aparte. Se devolverán las cuotas y los bonos que cobró, y el período quedará libre para generar otra. {conSap} Esto no se puede deshacer.</>,
            etiquetaMotivo: "Motivo de la anulación",
            accion: "Anular planilla",
            peligro: true,
          }, seAnulo)}
          disabled={loading}
          className={botonPeligro}
        >
          Anular planilla
        </button>
      )}
    </div>
  );
}
