"use client";

/**
 * Lo marcado en la lista de Planillas por período y lo que se hace con ello.
 * Fase 1 (2026-11-24): imprimir las planillas o sus comprobantes en un solo PDF.
 * Fase 2 (2026-11-24): recalcular, confirmar, aprobar y marcar pagadas varias a la vez, y
 * un solo archivo del banco. Los comprobantes, por correo o impresos (`ComprobantesLote`). La barra ofrece sólo lo que tiene algo que hacer con lo
 * marcado y lo que la cuenta puede hacer, con cuántas entran.
 *
 * Las casillas y los botones los dibuja el servidor (`PlanillasPorPeriodo`):
 * `data-sel-planilla` (con su neto, estado, nombre y período), `data-sel-periodo` para
 * marcar un período entero y `data-lote` en los botones de cada período. Aquí sólo se
 * escuchan.
 */

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/ModalForm";
import ArchivoBanco from "@/components/payroll/ArchivoBanco";
import ComprobantesLote from "@/components/payroll/ComprobantesLote";
import { ListaProceso, PieProceso, VentanaLote, resumenProceso, useProcesoLote, type Paso, type Resultado } from "@/components/payroll/ProcesoLote";
import { ACCIONES_LOTE, accionesDisponibles, repartirLote, type AccionLote } from "@/lib/payroll/lote-planillas";
import type { EstadoLista } from "@/lib/payroll/planillas-por-periodo";
import { formatCurrency } from "@/lib/utils";

type Lote = { tipo: "imprimir" | "comprobantes"; ids: string[]; nombre: string };
interface Marcada { id: string; neto: number; estado: EstadoLista; nombre: string; periodo: string }

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const abrir = (url: string) => window.open(url, "_blank", "noopener");

function DialogoImprimir({ lote, orden, dir, onCerrar }: { lote: Lote; orden: string; dir: string; onCerrar: () => void }) {
  const [completo, setCompleto] = useState(true);
  const [papel, setPapel] = useState("LEGAL");
  function aceptar() {
    const q = new URLSearchParams({
      reporteId: completo ? "planilla-detallada" : "resumen-planilla",
      planillaIds: lote.ids.join(","), formato: "PDF", modo: "ver", papel, orden, dir,
      ...(completo ? { porDivision: "1" } : {}),
    });
    abrir(`/api/reportes?${q.toString()}`);
    onCerrar();
  }
  return (
    <Modal titulo={`Imprimir ${plural(lote.ids.length, "planilla", "planillas")}`} error={null} cargando={false} puedeGuardar textoGuardar="Abrir el PDF" onCerrar={onCerrar} onGuardar={aceptar}>
      <p className="text-sm text-gray-600">Un solo PDF de {lote.nombre}, listo para imprimir.</p>
      <fieldset className="space-y-2" data-opciones-imprimir>
        <legend className="sr-only">Qué imprimir</legend>
        <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 text-sm">
          <input type="radio" name="imprimir-que" className="mt-0.5" checked={completo} onChange={() => setCompleto(true)} />
          <span><span className="font-medium text-gray-900">Planillas completas</span>
            <span className="block text-xs text-gray-500">Cada sucursal en hoja aparte, con su total; al final, el resumen de todas.</span></span>
        </label>
        <label className="flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 text-sm">
          <input type="radio" name="imprimir-que" className="mt-0.5" checked={!completo} onChange={() => setCompleto(false)} />
          <span><span className="font-medium text-gray-900">Sólo el resumen</span>
            <span className="block text-xs text-gray-500">Una hoja con el bruto, las deducciones, el neto y el costo patronal de cada sucursal.</span></span>
        </label>
      </fieldset>
      <label className="block text-sm">
        <span className="font-medium text-gray-800">Papel</span>
        <select className="input mt-1" value={papel} onChange={(e) => setPapel(e.target.value)} id="imprimir-papel">
          <option value="LEGAL">Legal (8.5 × 14 pulg.)</option>
          <option value="CARTA">Carta (8.5 × 11 pulg.)</option>
          <option value="OFICIO">Oficio (8.5 × 13 pulg.)</option>
        </select>
      </label>
      <p className="text-xs text-gray-500">Las planillas en borrador salen marcadas así, para que nadie las tome por definitivas.</p>
    </Modal>
  );
}

/** Confirmar, aprobar, pagar o recalcular las marcadas, una tras otra, con las mismas rutas que cada planilla. */
function DialogoAccion({ accion, marcadas, onCerrar }: { accion: AccionLote; marcadas: Marcada[]; onCerrar: (cambio: boolean) => void }) {
  const def = ACCIONES_LOTE[accion];
  const { van, omitidas, neto } = repartirLote(accion, marcadas);
  const p = useProcesoLote();
  const variosPeriodos = new Set(marcadas.map((m) => m.periodo)).size > 1;
  const nombre = (m: Marcada) => (variosPeriodos ? `${m.nombre} (${m.periodo})` : m.nombre);
  const cuantas = plural(van.length, "planilla", "planillas");

  async function ejecutar(paso: Paso): Promise<Resultado> {
    if (accion === "recalcular") {
      const r = await fetch(`/api/planillas/${paso.clave}/recalcular`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { estado: r.status === 409 ? "revisar" : "error", mensaje: d.error ?? "No se pudo recalcular." };
      const antes = Number(d.netoAnterior), ahora = Number(d.netoNuevo);
      return { estado: "hecho", mensaje: antes === ahora ? `El neto no cambió: ${formatCurrency(ahora)}.` : `El neto pasó de ${formatCurrency(antes)} a ${formatCurrency(ahora)}.` };
    }
    const r = await fetch(`/api/planillas/${paso.clave}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: def.hacia }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      return { estado: "hecho", mensaje: accion === "confirmar" ? "Confirmada: sus cuotas y bonos ya se aplicaron." : accion === "aprobar" ? "Aprobada y cerrada." : "Marcada pagada." };
    }
    if (d.recalculada) return { estado: "revisar", mensaje: "Los datos cambiaron desde que se calculó: se actualizó y no se confirmó. Ábrala, revísela y confírmela." };
    // Un conflicto (neto negativo, asiento en SAP…) lo resuelve una persona mirando la planilla.
    return { estado: r.status === 409 ? "revisar" : "error", mensaje: d.error ?? "No se pudo cambiar el estado." };
  }

  const cerrar = () => onCerrar(p.fase !== "pregunta");
  return (
    <VentanaLote
      titulo={`${def.boton} ${cuantas}`}
      onEscape={p.fase === "procesando" ? undefined : cerrar}
      pie={<PieProceso p={p} textoAccion={`${def.boton} ${cuantas}`} puede={van.length > 0}
        onAccion={() => void p.correr(van.map((m) => ({ clave: m.id, nombre: nombre(m), detalle: `Neto ${formatCurrency(m.neto)}` })), ejecutar)} onCerrar={cerrar} />}
    >
      {p.fase === "pregunta" ? (
        <div className="space-y-3" data-lote-accion={accion}>
          <p className="text-sm text-gray-800">{def.verbo} {cuantas} por <span className="font-semibold">{formatCurrency(neto)}</span> de neto.</p>
          <p className="text-sm text-gray-600">{def.explicacion}</p>
          <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 text-sm" data-van>
            {van.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 px-3 py-1.5"><span className="min-w-0 truncate">{nombre(m)}</span><span className="num shrink-0 text-gray-600">{formatCurrency(m.neto)}</span></li>
            ))}
          </ul>
          {omitidas.length > 0 && (
            <div className="text-sm" data-omitidas>
              <p className="text-gray-700">{plural(omitidas.length, "planilla marcada se omite", "planillas marcadas se omiten")}:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-500">
                {omitidas.map((m) => <li key={m.id}>{nombre(m)}: {m.motivo}.</li>)}
              </ul>
            </div>
          )}
          {def.aviso && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{def.aviso}</p>}
        </div>
      ) : (
        <>
          <ListaProceso p={p} />
          {p.fase === "listo" && <p className="text-sm font-medium text-gray-900" role="status" data-resumen-lote>{resumenProceso(p, def.hecho)}</p>}
        </>
      )}
    </VentanaLote>
  );
}

function DialogoBanco({ ids, onCerrar }: { ids: string[]; onCerrar: () => void }) {
  return (
    <VentanaLote titulo="Archivo del banco" onEscape={onCerrar} pie={<button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>}>
      <p className="text-sm text-gray-600">Un solo archivo con el pago de {plural(ids.length, "la planilla aprobada o pagada", "las planillas aprobadas o pagadas")} que marcó.</p>
      <ArchivoBanco base={`/api/planillas/archivo-banco?ids=${ids.join(",")}`} enVentana />
    </VentanaLote>
  );
}

export default function SeleccionPlanillas({ children, puedeImprimir, permisos, orden, dir }: {
  children: React.ReactNode;
  puedeImprimir: boolean;
  /** Los de nómina que tiene la cuenta: decide qué acciones por lote se ofrecen. */
  permisos: string[];
  /** El orden de la vista de la planilla: la impresa sale igual. */
  orden: string;
  dir: string;
}) {
  const router = useRouter();
  const raiz = useRef<HTMLDivElement>(null);
  const [marcadas, setMarcadas] = useState<Map<string, Marcada>>(new Map());
  const [lote, setLote] = useState<Lote | null>(null);
  const [accion, setAccion] = useState<AccionLote | null>(null);
  const [banco, setBanco] = useState<string[] | null>(null);

  const sincronizar = useCallback(() => {
    const r = raiz.current;
    if (!r) return;
    const m = new Map<string, Marcada>();
    r.querySelectorAll<HTMLInputElement>("input[data-sel-planilla]:checked").forEach((c) => m.set(c.dataset.selPlanilla!, {
      id: c.dataset.selPlanilla!,
      neto: Number(c.dataset.neto || 0),
      estado: (c.dataset.estado ?? "BORRADOR") as EstadoLista,
      nombre: c.dataset.nombre ?? "",
      periodo: c.dataset.periodoNombre ?? "",
    }));
    // La casilla de cada período: marcada si están todas, a medias si sólo algunas.
    r.querySelectorAll<HTMLInputElement>("input[data-sel-periodo]").forEach((h) => {
      const filas = [...r.querySelectorAll<HTMLInputElement>("input[data-sel-planilla]")].filter((f) => f.dataset.periodo === h.dataset.selPeriodo);
      const n = filas.filter((f) => f.checked).length;
      h.checked = n > 0 && n === filas.length;
      h.indeterminate = n > 0 && n < filas.length;
    });
    setMarcadas(m);
  }, []);

  function alCambiar(e: React.ChangeEvent<HTMLDivElement>) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.selPeriodo !== undefined) {
      raiz.current?.querySelectorAll<HTMLInputElement>("input[data-sel-planilla]").forEach((c) => { if (c.dataset.periodo === t.dataset.selPeriodo) c.checked = t.checked; });
    }
    if (t.dataset.selPeriodo !== undefined || t.dataset.selPlanilla !== undefined) sincronizar();
  }

  function alPulsar(e: React.MouseEvent<HTMLDivElement>) {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-lote]");
    if (!b || !raiz.current?.contains(b)) return;
    const ids = (b.dataset.ids ?? "").split(",").filter(Boolean);
    if (ids.length) setLote({ tipo: b.dataset.lote as Lote["tipo"], ids, nombre: b.dataset.nombre ?? "el período" });
  }

  function quitar() {
    raiz.current?.querySelectorAll<HTMLInputElement>("input[data-sel-planilla], input[data-sel-periodo]").forEach((c) => { c.checked = false; c.indeterminate = false; });
    setMarcadas(new Map());
  }

  function alTerminar(cambio: boolean) {
    setAccion(null);
    if (!cambio) return;
    // Lo de la lista cambió de estado: se quita la selección y se vuelve a leer del servidor.
    quitar();
    router.refresh();
  }

  const lista = [...marcadas.values()];
  const ids = lista.map((m) => m.id);
  const neto = lista.reduce((s, m) => s + Math.round(m.neto * 100), 0) / 100;
  const nombreMarcadas = plural(ids.length, "planilla marcada", "planillas marcadas");
  const nombreLote = plural(ids.length, "planilla", "planillas");
  const acciones = accionesDisponibles(lista, permisos);
  const pagables = lista.filter((m) => m.estado === "APROBADA" || m.estado === "PAGADA").map((m) => m.id);
  return (
    <div ref={raiz} onChange={alCambiar} onClick={alPulsar}>
      {children}
      {/* La barra es fija: este hueco deja ver lo último de la lista por encima de ella. */}
      {ids.length > 0 && <div aria-hidden="true" className="h-36 sm:h-24" />}
      {ids.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] xl:pl-60" data-barra-seleccion>
          <div className="pointer-events-auto flex w-full max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            <p className="mr-auto text-sm">
              <span className="font-semibold text-gray-900">{nombreMarcadas}</span>
              <span className="block text-xs text-gray-500">Neto {formatCurrency(neto)}</span>
            </p>
            {acciones.length > 0 && (
              <span className="flex flex-wrap gap-2" data-acciones-lote>
                {/* Recalcular no avanza la planilla: va más discreto que los pasos del ciclo. */}
                {acciones.map(({ accion: a, cuantas }) => (
                  <button key={a} type="button" className={a === "recalcular" ? "btn btn-secondary" : "btn btn-primary"} data-accion-lote={a} onClick={() => setAccion(a)}>
                    {ACCIONES_LOTE[a].boton}
                    <span className={`ml-1.5 rounded-full px-1.5 text-xs font-semibold ${a === "recalcular" ? "bg-gray-100 text-gray-700" : "bg-white/20"}`} aria-label={`, ${plural(cuantas, "planilla", "planillas")}`}>{cuantas}</span>
                  </button>
                ))}
              </span>
            )}
            {puedeImprimir && (
              <button type="button" className="btn btn-secondary" onClick={() => setLote({ tipo: "imprimir", ids, nombre: nombreLote })}>Imprimir</button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setLote({ tipo: "comprobantes", ids, nombre: nombreLote })}>Comprobantes</button>
            {permisos.includes("planillas.pagar") && pagables.length > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => setBanco(pagables)}>Archivo del banco</button>
            )}
            <button type="button" className="btn btn-ghost" onClick={quitar}>Quitar selección</button>
          </div>
        </div>
      )}
      {lote?.tipo === "imprimir" && <DialogoImprimir lote={lote} orden={orden} dir={dir} onCerrar={() => setLote(null)} />}
      {lote?.tipo === "comprobantes" && (
        <ComprobantesLote ids={lote.ids} nombre={lote.nombre} puedeEnviar={permisos.includes("planillas.boletas")}
          onCerrar={(cambio) => { setLote(null); if (cambio) router.refresh(); }} />
      )}
      {accion && <DialogoAccion accion={accion} marcadas={lista} onCerrar={alTerminar} />}
      {banco && <DialogoBanco ids={banco} onCerrar={() => setBanco(null)} />}
    </div>
  );
}
