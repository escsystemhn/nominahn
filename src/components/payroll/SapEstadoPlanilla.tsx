"use client";

/**
 * Bloque «SAP Business One» en el detalle de una planilla: en qué estado está
 * su asiento en la cola, el número que le dio SAP, el error traducido si lo
 * hubo, y los botones para enviar, reintentar o revertir.
 *
 * No aparece si la integración no está configurada: una empresa sin SAP no
 * tiene por qué ver un bloque vacío.
 */

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface Bitacora {
  intento: number;
  httpStatus: number | null;
  duracionMs: number;
  resultado: string;
  errorCodigo: string | null;
  mensaje: string | null;
  createdAt: string;
}

interface Envio {
  id: string;
  tipo: "ASIENTO" | "REVERSO";
  estado: "PENDIENTE" | "ENVIANDO" | "ENVIADO" | "ERROR" | "CANCELADO";
  intentos: number;
  sapTransId: number | null;
  sapNumero: number | null;
  errorCodigo: string | null;
  errorTraducido: string | null;
  errorMensaje: string | null;
  esTransitorio: boolean | null;
  proximoIntentoAt: string | null;
  enviadoAt: string | null;
  createdAt: string;
  updatedAt: string;
  bitacora: Bitacora[];
}

interface LineaSap {
  AccountCode: string;
  Debit: number;
  Credit: number;
  LineMemo: string;
  CostingCode?: string;
  CostingCode2?: string;
  CostingCode3?: string;
  CostingCode4?: string;
  CostingCode5?: string;
  ProjectCode?: string;
}

interface VistaPrevia {
  tipo: "ASIENTO" | "REVERSO";
  payload: {
    ReferenceDate: string;
    Memo: string;
    Reference: string;
    Reference2: string;
    JournalEntryLines: LineaSap[];
  } | null;
  errores: string[];
  avisos: string[];
  totalDebe: number;
  totalHaber: number;
}

interface Estado {
  configurado: boolean;
  activo: boolean;
  modoEnvio?: "MANUAL" | "AL_APROBAR" | "AL_PAGAR";
  errorConfig: string | null;
  asiento: Envio | null;
  reverso: Envio | null;
  vistaPrevia: VistaPrevia | null;
}

interface Props {
  planillaId: string;
  estadoPlanilla: string;
  puedeEnviar: boolean;
}

const MODO: Record<string, string> = {
  MANUAL: "Envío manual desde esta pantalla",
  AL_APROBAR: "Se envía al aprobar la planilla",
  AL_PAGAR: "Se envía al marcar la planilla como pagada",
};

const fechaHora = (s: string | null) => (s ? new Date(s).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" }) : "");

function describir(e: Envio | null): { tono: "neutro" | "ok" | "aviso" | "error" | "marca"; texto: string } {
  if (!e) return { tono: "neutro", texto: "Sin enviar" };
  switch (e.estado) {
    case "ENVIADO":
      return { tono: "ok", texto: `Registrado en SAP como asiento ${e.sapNumero ?? e.sapTransId} el ${fechaHora(e.enviadoAt)}` };
    case "ENVIANDO":
      return { tono: "marca", texto: "Enviando a SAP…" };
    case "PENDIENTE":
      return e.intentos === 0
        ? { tono: "marca", texto: "En cola; se envía en un momento" }
        : { tono: "aviso", texto: `Falló el intento ${e.intentos} (${e.errorTraducido ?? e.errorMensaje}). Se reintenta ${e.proximoIntentoAt ? `a las ${fechaHora(e.proximoIntentoAt)}` : "pronto"}.` };
    case "ERROR":
      return { tono: "error", texto: e.errorTraducido ?? e.errorMensaje ?? "Error sin detalle" };
    case "CANCELADO":
      return { tono: "aviso", texto: e.errorTraducido ?? "Cancelado" };
  }
}

const PUNTO = { neutro: "bg-gray-400", marca: "bg-blue-500", ok: "bg-green-600", aviso: "bg-amber-500", error: "bg-red-600" } as const;

const dimension = (l: LineaSap) => l.CostingCode ?? l.CostingCode2 ?? l.CostingCode3 ?? l.CostingCode4 ?? l.CostingCode5 ?? "";

export default function SapEstadoPlanilla({ planillaId, estadoPlanilla, puedeEnviar }: Props) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [verAsiento, setVerAsiento] = useState(false);
  const [verBitacora, setVerBitacora] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/planillas/${planillaId}/sap`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo consultar el estado en SAP");
      setEstado(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al consultar");
    }
  }, [planillaId]);

  // Carga inicial y, mientras algo está en cola o enviándose, sondeo cada
  // diez segundos. Ambas desde callbacks: el estado se fija al responder el
  // servidor, no en el cuerpo del efecto.
  const enCurso = [estado?.asiento, estado?.reverso].some((e) => e && (e.estado === "PENDIENTE" || e.estado === "ENVIANDO"));
  useEffect(() => {
    const inicial = setTimeout(() => void cargar(), 0);
    const sondeo = enCurso ? setInterval(() => void cargar(), 10_000) : null;
    return () => {
      clearTimeout(inicial);
      if (sondeo) clearInterval(sondeo);
    };
  }, [enCurso, cargar]);

  async function accion(a: "enviar" | "reintentar" | "reverso") {
    setOcupado(true);
    setMensaje(null);
    try {
      const res = await fetch(`/api/planillas/${planillaId}/sap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: a }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo enviar");
      const env: Envio | null = d.envio;
      if (d.ok && env) {
        setMensaje({ ok: true, texto: `${a === "reverso" ? "Reverso" : "Asiento"} registrado en SAP con el número ${env.sapNumero ?? env.sapTransId}.` });
      } else {
        const detalle = env?.errorTraducido ?? env?.errorMensaje ?? (d.errores as string[] | undefined)?.join(" ") ?? "SAP no aceptó el asiento.";
        setMensaje({ ok: false, texto: detalle });
      }
      await cargar();
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : "Error al enviar" });
    } finally {
      setOcupado(false);
    }
  }

  if (!estado && !error) return null;
  if (!estado) {
    return (
      <section className="panel p-5">
        <p className="text-sm text-red-700">{error}</p>
      </section>
    );
  }
  if (!estado.configurado && !estado.asiento && !estado.reverso) return null;

  const { asiento, reverso, vistaPrevia } = estado;
  const cerrada = estadoPlanilla === "APROBADA" || estadoPlanilla === "PAGADA";
  const puedeEnviarAhora = puedeEnviar && estado.activo && cerrada && (!asiento || asiento.estado === "ERROR" || asiento.estado === "CANCELADO");
  const puedeReintentarPendiente = puedeEnviar && estado.activo && cerrada && asiento?.estado === "PENDIENTE" && asiento.intentos > 0;
  const puedeReverso =
    puedeEnviar && estado.activo && estadoPlanilla === "ANULADA" && asiento?.estado === "ENVIADO" && reverso?.estado !== "ENVIADO" && reverso?.estado !== "ENVIANDO" && reverso?.estado !== "PENDIENTE";
  const dA = describir(asiento);
  const dR = describir(reverso);
  const mostrarPrevia = vistaPrevia && (!asiento || asiento.estado !== "ENVIADO" || vistaPrevia.tipo === "REVERSO");

  return (
    <section className="panel p-5" aria-label="Contabilización en SAP Business One">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">SAP Business One</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {!estado.activo ? "Integración desactivada." : MODO[estado.modoEnvio ?? "MANUAL"]}
            {estado.errorConfig ? ` ${estado.errorConfig}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeEnviarAhora && (
            <button type="button" onClick={() => void accion(asiento ? "reintentar" : "enviar")} disabled={ocupado} className="btn btn-primary btn-sm">
              {ocupado ? "Enviando…" : asiento ? "Reintentar envío" : "Enviar a SAP"}
            </button>
          )}
          {puedeReintentarPendiente && (
            <button type="button" onClick={() => void accion("reintentar")} disabled={ocupado} className="btn btn-primary btn-sm">
              {ocupado ? "Enviando…" : "Reintentar ahora"}
            </button>
          )}
          {puedeReverso && (
            <button type="button" onClick={() => void accion("reverso")} disabled={ocupado} className="btn btn-secondary btn-sm">
              {ocupado ? "Enviando…" : "Enviar reverso a SAP"}
            </button>
          )}
          <button type="button" onClick={() => void cargar()} className="btn btn-ghost btn-sm" disabled={ocupado}>
            Actualizar
          </button>
        </div>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-gray-500">Asiento</dt>
        <dd className="flex items-start gap-2 text-gray-900">
          <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${PUNTO[dA.tono]}`} aria-hidden />
          <span>{dA.texto}</span>
        </dd>
        {(reverso || estadoPlanilla === "ANULADA") && asiento?.estado === "ENVIADO" && (
          <>
            <dt className="text-gray-500">Reverso</dt>
            <dd className="flex items-start gap-2 text-gray-900">
              <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${PUNTO[dR.tono]}`} aria-hidden />
              <span>{reverso ? dR.texto : "Pendiente de enviar: la planilla se anuló después de contabilizarla."}</span>
            </dd>
          </>
        )}
      </dl>

      {mensaje && (
        <p className={`mt-3 rounded-md border px-3 py-2 text-sm ${mensaje.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {mensaje.texto}
        </p>
      )}

      {!cerrada && estadoPlanilla !== "ANULADA" && !asiento && (
        <p className="mt-3 text-xs text-gray-500">El asiento se puede enviar cuando la planilla esté aprobada o pagada.</p>
      )}

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        {mostrarPrevia && (
          <button type="button" className="text-blue-700 underline-offset-2 hover:underline" onClick={() => setVerAsiento((v) => !v)}>
            {verAsiento ? "Ocultar el asiento" : `Ver el ${vistaPrevia.tipo === "REVERSO" ? "reverso" : "asiento"} que se envía`}
          </button>
        )}
        {(asiento?.bitacora.length || reverso?.bitacora.length) ? (
          <button type="button" className="text-blue-700 underline-offset-2 hover:underline" onClick={() => setVerBitacora((v) => !v)}>
            {verBitacora ? "Ocultar intentos" : "Ver intentos"}
          </button>
        ) : null}
      </div>

      {verAsiento && vistaPrevia && (
        <div className="mt-3">
          {vistaPrevia.errores.length > 0 && (
            <ul className="mb-3 list-disc space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 pl-7 text-sm text-red-800">
              {vistaPrevia.errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {vistaPrevia.avisos.length > 0 && (
            <ul className="mb-3 list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 pl-7 text-sm text-amber-800">
              {vistaPrevia.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {vistaPrevia.payload && (
            <>
              <p className="mb-2 text-xs text-gray-500">
                Fecha contable {vistaPrevia.payload.ReferenceDate}. Memo «{vistaPrevia.payload.Memo}». Referencia {vistaPrevia.payload.Reference}.
              </p>
              <div className="overflow-x-auto">
                <table className="table-base text-xs">
                  <thead>
                    <tr>
                      <th className="px-3">Cuenta SAP</th>
                      <th className="px-3">Concepto</th>
                      <th className="px-3">Centro</th>
                      <th className="num px-3">Debe</th>
                      <th className="num px-3">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vistaPrevia.payload.JournalEntryLines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono">{l.AccountCode}</td>
                        <td className="px-3 py-1.5">{l.LineMemo}</td>
                        <td className="px-3 py-1.5 text-gray-500">{dimension(l)}</td>
                        <td className="num px-3 py-1.5">{l.Debit ? formatCurrency(l.Debit) : ""}</td>
                        <td className="num px-3 py-1.5">{l.Credit ? formatCurrency(l.Credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-900">
                      <td colSpan={3} className="px-3 py-2">Totales</td>
                      <td className="num px-3 py-2">{formatCurrency(vistaPrevia.totalDebe)}</td>
                      <td className="num px-3 py-2">{formatCurrency(vistaPrevia.totalHaber)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {verBitacora && (
        <div className="mt-3 overflow-x-auto">
          <table className="table-base text-xs">
            <thead>
              <tr>
                <th className="px-3">Fecha</th>
                <th className="px-3">Tipo</th>
                <th className="num px-3">Intento</th>
                <th className="px-3">Resultado</th>
                <th className="num px-3">HTTP</th>
                <th className="num px-3">ms</th>
                <th className="px-3">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {[...(asiento ? asiento.bitacora.map((b) => ({ ...b, tipo: "Asiento" })) : []), ...(reverso ? reverso.bitacora.map((b) => ({ ...b, tipo: "Reverso" })) : [])]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((b, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-1.5">{fechaHora(b.createdAt)}</td>
                    <td className="px-3 py-1.5">{b.tipo}</td>
                    <td className="num px-3 py-1.5">{b.intento}</td>
                    <td className="px-3 py-1.5">{b.resultado}</td>
                    <td className="num px-3 py-1.5">{b.httpStatus ?? ""}</td>
                    <td className="num px-3 py-1.5">{b.duracionMs}</td>
                    <td className="px-3 py-1.5 text-gray-600">{[b.errorCodigo, b.mensaje].filter(Boolean).join(": ")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
