"use client";

/**
 * Una ventana para hacer algo con varias planillas, una tras otra, viendo cómo va cada
 * una (fase 2 de Planillas por período, 2026-11-24). Primero pregunta (lo que se va a
 * hacer y lo que se omite), después procesa en orden y al final dice qué salió y qué no.
 * Una que falla no detiene a las demás; «Detener» termina la que está en curso y para.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface Paso {
  clave: string;
  nombre: string;
  /** A la derecha del nombre: el neto, cuántos empleados… */
  detalle?: string;
}

export type Resultado = { estado: "hecho" | "revisar" | "error"; mensaje: string };
type EstadoPaso = { estado: "espera" } | { estado: "procesando" } | Resultado;
export type Fase = "pregunta" | "procesando" | "listo";

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function useProcesoLote() {
  const [fase, setFase] = useState<Fase>("pregunta");
  const [lista, setLista] = useState<Paso[]>([]);
  const [estados, setEstados] = useState<Record<string, EstadoPaso>>({});
  const detener = useRef(false);

  async function correr(pasos: Paso[], ejecutar: (p: Paso) => Promise<Resultado>) {
    detener.current = false;
    setLista(pasos);
    setEstados(Object.fromEntries(pasos.map((p) => [p.clave, { estado: "espera" } as EstadoPaso])));
    setFase("procesando");
    for (const p of pasos) {
      if (detener.current) break;
      setEstados((s) => ({ ...s, [p.clave]: { estado: "procesando" } }));
      let r: Resultado;
      try {
        r = await ejecutar(p);
      } catch {
        r = { estado: "error", mensaje: "No se pudo conectar con el servidor." };
      }
      setEstados((s) => ({ ...s, [p.clave]: r }));
    }
    setFase("listo");
  }

  const cuenta = (e: EstadoPaso["estado"]) => lista.filter((p) => estados[p.clave]?.estado === e).length;
  return {
    fase, lista, estados, correr,
    detener: () => { detener.current = true; },
    hechos: cuenta("hecho"), revisar: cuenta("revisar"), errores: cuenta("error"), sinProcesar: cuenta("espera"),
    procesados: lista.length - cuenta("espera") - cuenta("procesando"),
  };
}

export type Proceso = ReturnType<typeof useProcesoLote>;

/** «8 planillas confirmadas. 1 para revisar. 1 no se pudo.» */
export function resumenProceso(p: Proceso, hecho: [string, string], sustantivo: [string, string] = ["planilla", "planillas"]): string {
  const partes = [`${plural(p.hechos, `${sustantivo[0]} ${hecho[0]}`, `${sustantivo[1]} ${hecho[1]}`)}.`];
  if (p.revisar) partes.push(`${plural(p.revisar, "quedó para revisar", "quedaron para revisar")}.`);
  if (p.errores) partes.push(`${plural(p.errores, "no se pudo", "no se pudieron")}.`);
  if (p.sinProcesar) partes.push(`${plural(p.sinProcesar, "quedó sin procesar", "quedaron sin procesar")} al detener.`);
  return partes.join(" ");
}

const MARCA: Record<EstadoPaso["estado"], { texto: string; clase: string }> = {
  espera: { texto: "En espera", clase: "text-gray-500" },
  procesando: { texto: "Procesando…", clase: "text-blue-700" },
  hecho: { texto: "Listo", clase: "text-green-700" },
  revisar: { texto: "Revisar", clase: "text-amber-800" },
  error: { texto: "No se pudo", clase: "text-red-700" },
};

/** Cada paso con su estado, en palabras (no sólo en color). */
export function ListaProceso({ p }: { p: Proceso }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-700" aria-live="polite">
        {p.fase === "procesando" ? `Procesando ${Math.min(p.procesados + 1, p.lista.length)} de ${p.lista.length}…` : `${p.procesados} de ${p.lista.length} procesadas.`}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        <div className="h-full rounded-full bg-blue-500 transition-[width] motion-reduce:transition-none" style={{ width: `${p.lista.length ? (p.procesados / p.lista.length) * 100 : 0}%` }} />
      </div>
      <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 text-sm" data-proceso>
        {p.lista.map((x) => {
          const e = p.estados[x.clave] ?? { estado: "espera" };
          const m = MARCA[e.estado];
          return (
            <li key={x.clave} className="px-3 py-2" data-paso={x.clave} data-estado={e.estado}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-gray-900">{x.nombre}</span>
                <span className={cn("shrink-0 text-xs font-semibold", m.clase)}>
                  {e.estado === "procesando" && <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none" />}
                  {m.texto}
                </span>
              </div>
              {"mensaje" in e && <p className={cn("mt-0.5 text-xs", e.estado === "hecho" ? "text-gray-600" : m.clase)}>{e.mensaje}</p>}
              {e.estado === "espera" && x.detalle && <p className="mt-0.5 text-xs text-gray-500">{x.detalle}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** El marco de la ventana: título, contenido y botones. Escape cierra sólo si no está procesando. */
export function VentanaLote({ titulo, children, pie, onEscape }: { titulo: string; children: React.ReactNode; pie: React.ReactNode; onEscape?: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape" && onEscape) onEscape(); };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onEscape]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={titulo} data-ventana-lote>
      <div ref={panel} tabIndex={-1} className="panel flex max-h-full w-full max-w-lg flex-col shadow-xl outline-none">
        <h3 className="border-b border-gray-100 px-5 py-4 text-base font-semibold text-gray-900">{titulo}</h3>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">{pie}</div>
      </div>
    </div>
  );
}

/** Los botones de abajo según la fase: cancelar y hacer, detener, o cerrar. */
export function PieProceso({ p, textoAccion, puede, onAccion, onCerrar }: {
  p: Proceso; textoAccion: string; puede: boolean; onAccion: () => void; onCerrar: () => void;
}) {
  if (p.fase === "pregunta") {
    return (
      <>
        <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!puede} onClick={onAccion}>{textoAccion}</button>
      </>
    );
  }
  if (p.fase === "procesando") return <button type="button" className="btn btn-secondary" onClick={p.detener}>Detener después de esta</button>;
  return <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>;
}
