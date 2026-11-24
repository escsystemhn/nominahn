"use client";

/**
 * Los comprobantes de pago de varias planillas de una vez (2026-11-24, pedido de Edbin:
 * «enviar de forma masiva los comprobantes, sea por correo o de forma impresa»).
 *
 *   Por correo: a cada empleado con correo, sólo de las planillas aprobadas o pagadas, una
 *     planilla tras otra con la misma ruta que el botón de cada planilla
 *     (`POST /api/planillas/[id]/email`), viendo cómo va cada una.
 *   Impresos: un solo PDF (`/api/planillas/comprobantes`), de todos o sólo de quienes no
 *     tienen correo, cada empleado en su hoja con las dos copias.
 *
 * Se abre desde la barra de lo marcado, desde cada período y desde cada planilla.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ListaProceso, VentanaLote, resumenProceso, useProcesoLote, type Paso, type Resultado } from "@/components/payroll/ProcesoLote";

interface PorPlanilla { id: string; nombre: string; estado: string; empleados: number; conCorreo: number }
interface Conteo { empleados: number; sinCorreo: number; sinAprobar: number; planillas: number; detalle: PorPlanilla[] }

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const cerrada = (estado: string) => estado === "APROBADA" || estado === "PAGADA";

export default function ComprobantesLote({ ids, nombre, puedeEnviar, onCerrar }: {
  ids: string[];
  /** «la 2.ª quincena de noviembre de 2026», «3 planillas». */
  nombre: string;
  /** `planillas.boletas`: sin él, sólo se imprimen. */
  puedeEnviar: boolean;
  onCerrar: (cambio: boolean) => void;
}) {
  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soloSinCorreo, setSoloSinCorreo] = useState(true);
  const p = useProcesoLote();
  const clave = ids.join(",");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/planillas/comprobantes?${new URLSearchParams({ ids: clave, contar: "1" })}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) throw new Error(d.error ?? "No se pudieron contar los comprobantes.");
        setConteo(d as Conteo);
        setSoloSinCorreo((d as Conteo).sinCorreo > 0);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudieron contar los comprobantes.");
      }
    })();
    return () => { vivo = false; };
  }, [clave]);

  const aEnviar = (conteo?.detalle ?? []).filter((x) => cerrada(x.estado) && x.conCorreo > 0);
  const correos = aEnviar.reduce((n, x) => n + x.conCorreo, 0);
  const sinAprobarConCorreo = (conteo?.detalle ?? []).filter((x) => !cerrada(x.estado)).length;
  const aImprimir = conteo ? (soloSinCorreo ? conteo.sinCorreo : conteo.empleados) : 0;

  function imprimir() {
    const q = new URLSearchParams({ ids: clave, modo: "ver", ...(soloSinCorreo ? { solo: "sin-correo" } : {}) });
    window.open(`/api/planillas/comprobantes?${q.toString()}`, "_blank", "noopener");
  }

  async function ejecutar(paso: Paso): Promise<Resultado> {
    const r = await fetch(`/api/planillas/${paso.clave}/email`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Sin servidor de correo fallarían todas por lo mismo: se para y se dice una vez.
      if (r.status === 503) p.detener();
      return { estado: "error", mensaje: d.error ?? "No se pudieron enviar." };
    }
    const partes = [`${plural(d.enviados, "enviado", "enviados")} de ${d.total}.`];
    if (d.sinCorreo?.length) partes.push(`Sin correo: ${d.sinCorreo.length}.`);
    if (d.errores) partes.push(`Fallaron ${d.errores}: ${d.primerError ?? "error del servidor de correo"}.`);
    return { estado: d.errores ? "revisar" : "hecho", mensaje: partes.join(" ") };
  }

  const enviando = p.fase !== "pregunta";
  const cerrar = () => onCerrar(enviando && p.hechos + p.revisar > 0);
  return (
    <VentanaLote
      titulo={`Comprobantes de pago de ${nombre}`}
      onEscape={p.fase === "procesando" ? undefined : cerrar}
      pie={p.fase === "procesando"
        ? <button type="button" className="btn btn-secondary" onClick={p.detener}>Detener después de esta</button>
        : <button type="button" className={enviando ? "btn btn-primary" : "btn btn-ghost"} onClick={cerrar}>Cerrar</button>}
    >
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {!conteo && !error && <p className="text-sm text-gray-500">Contando…</p>}

      {conteo && !enviando && (
        <div className="space-y-4" data-comprobantes-lote>
          {puedeEnviar && (
            <section className="space-y-2 rounded-lg border border-gray-200 p-3" aria-labelledby="cl-correo" data-por-correo>
              <h4 id="cl-correo" className="text-sm font-semibold text-gray-900">Por correo</h4>
              {correos > 0 ? (
                <p className="text-sm text-gray-600">
                  A cada empleado con correo: {plural(correos, "comprobante", "comprobantes")} de {plural(aEnviar.length, "planilla aprobada o pagada", "planillas aprobadas o pagadas")}.
                  Se envían una planilla tras otra.
                </p>
              ) : (
                <p className="text-sm text-gray-600">Nadie con correo en las planillas aprobadas o pagadas de lo elegido.</p>
              )}
              {sinAprobarConCorreo > 0 && (
                <p className="text-xs text-amber-900">
                  {plural(sinAprobarConCorreo, "planilla sin aprobar no se envía", "planillas sin aprobar no se envían")}: su comprobante todavía puede cambiar.
                </p>
              )}
              <button type="button" className="btn btn-primary" disabled={correos === 0}
                onClick={() => void p.correr(aEnviar.map((x) => ({ clave: x.id, nombre: x.nombre, detalle: plural(x.conCorreo, "correo", "correos") })), ejecutar)}>
                Enviar {plural(correos, "comprobante", "comprobantes")} por correo
              </button>
            </section>
          )}

          <section className="space-y-2 rounded-lg border border-gray-200 p-3" aria-labelledby="cl-impresos" data-impresos>
            <h4 id="cl-impresos" className="text-sm font-semibold text-gray-900">Impresos</h4>
            <p className="text-sm text-gray-600">Un solo PDF: cada empleado en su hoja, con las dos copias de media carta (empleado y empresa), por sucursal y departamento.</p>
            <fieldset className="space-y-2" data-opciones-comprobantes>
              <legend className="sr-only">Cuáles imprimir</legend>
              <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 text-sm">
                <input type="radio" name="comprobantes-cuales" className="mt-0.5" checked={soloSinCorreo} disabled={conteo.sinCorreo === 0} onChange={() => setSoloSinCorreo(true)} />
                <span><span className="font-medium text-gray-900">Sólo quienes no tienen correo ({conteo.sinCorreo})</span>
                  <span className="block text-xs text-gray-500">Son los que hay que imprimir si a los demás se les envía por correo.</span></span>
              </label>
              <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 text-sm">
                <input type="radio" name="comprobantes-cuales" className="mt-0.5" checked={!soloSinCorreo} onChange={() => setSoloSinCorreo(false)} />
                <span><span className="font-medium text-gray-900">Todos ({conteo.empleados})</span></span>
              </label>
            </fieldset>
            {conteo.sinAprobar > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {plural(conteo.sinAprobar, "comprobante es de una planilla sin aprobar", "comprobantes son de planillas sin aprobar")}: salen con el aviso en rojo y sin línea de firma.
              </p>
            )}
            <button type="button" className="btn btn-secondary" disabled={aImprimir === 0} onClick={imprimir}>
              Abrir el PDF ({plural(aImprimir, "comprobante", "comprobantes")})
            </button>
          </section>
        </div>
      )}

      {enviando && (
        <>
          <ListaProceso p={p} />
          {p.fase === "listo" && <p className="text-sm font-medium text-gray-900" role="status" data-resumen-lote>{resumenProceso(p, ["enviada", "enviadas"])}</p>}
        </>
      )}
    </VentanaLote>
  );
}

/** El botón «Comprobantes de pago» de una planilla: la misma ventana, con sólo esa planilla. */
export function BotonComprobantes({ planillaId, puedeEnviar }: { planillaId: string; puedeEnviar: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setAbierto(true)} data-boton-comprobantes>Comprobantes de pago</button>
      {abierto && <ComprobantesLote ids={[planillaId]} nombre="esta planilla" puedeEnviar={puedeEnviar} onCerrar={(cambio) => { setAbierto(false); if (cambio) router.refresh(); }} />}
    </>
  );
}
