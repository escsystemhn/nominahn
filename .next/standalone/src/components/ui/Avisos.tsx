"use client";

/**
 * Confirmaciones y avisos propios, en lugar de `confirm()` y `alert()` del navegador.
 *
 * Los del navegador no dejan explicar la consecuencia de una acción, detienen la
 * pantalla por un simple «guardado» y pueden silenciarse. Aquí una confirmación dice
 * qué va a pasar y el botón nombra la acción; un aviso no interrumpe el trabajo.
 *
 *   const { confirmar, avisar } = useAvisos();
 *   if (!(await confirmar({ titulo: "¿Eliminar el turno?", accion: "Eliminar", peligro: true }))) return;
 *   avisar.exito("Turno eliminado.");
 *   avisar.error("No se pudo eliminar el turno.");
 *
 *   const motivo = await pedirMotivo({ titulo: "¿Reabrir la planilla?", accion: "Reabrir", peligro: true });
 *   if (motivo === null) return;
 */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface OpcionesConfirmar {
  titulo: string;
  /** Qué va a pasar, en palabras de quien usa el sistema. */
  detalle?: React.ReactNode;
  /** Lo que dice el botón: «Aprobar», «Eliminar». Sin él, «Confirmar». */
  accion?: string;
  /** Para lo que borra o revierte: botón rojo, y el foco arranca en Cancelar. */
  peligro?: boolean;
}

export interface OpcionesMotivo extends OpcionesConfirmar {
  /** La etiqueta del campo. Sin ella, «Motivo». */
  etiquetaMotivo?: string;
  largoMaximo?: number;
}

type TipoAviso = "exito" | "error";
interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
}

interface ApiAvisos {
  confirmar: (opciones: OpcionesConfirmar) => Promise<boolean>;
  /** Como `confirmar`, pero exige escribir la justificación. `null` si se canceló. */
  pedirMotivo: (opciones: OpcionesMotivo) => Promise<string | null>;
  avisar: { exito: (texto: string) => void; error: (texto: string) => void };
}

const Contexto = createContext<ApiAvisos | null>(null);

export function useAvisos(): ApiAvisos {
  const api = useContext(Contexto);
  if (!api) throw new Error("useAvisos necesita <AvisosProvider> en el layout raíz.");
  return api;
}

/** Lo que dura un aviso de éxito breve. */
const DURACION_EXITO_MS = 5000;
const LARGO_BREVE = 100;

interface Pendiente {
  opciones: OpcionesMotivo;
  conMotivo: boolean;
  responder: (acepta: boolean, motivo: string) => void;
}

export function AvisosProvider({ children }: { children: React.ReactNode }) {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(1);

  const quitar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);

  const agregar = useCallback((tipo: TipoAviso, texto: string) => {
    const id = siguiente.current++;
    setAvisos((a) => [...a, { id, tipo, texto }]);
    // Un error o un resumen largo se queda hasta que la persona lo cierre: puede traer algo que hacer.
    if (tipo === "exito" && texto.length <= LARGO_BREVE && !texto.includes("\n")) {
      setTimeout(() => quitar(id), DURACION_EXITO_MS);
    }
  }, [quitar]);

  const api = useMemo<ApiAvisos>(() => ({
    confirmar: (opciones) =>
      new Promise<boolean>((resolver) => setPendiente({ opciones, conMotivo: false, responder: (acepta) => resolver(acepta) })),
    pedirMotivo: (opciones) =>
      new Promise<string | null>((resolver) =>
        setPendiente({ opciones, conMotivo: true, responder: (acepta, motivo) => resolver(acepta ? motivo.trim() : null) })
      ),
    avisar: { exito: (t) => agregar("exito", t), error: (t) => agregar("error", t) },
  }), [agregar]);

  const responder = (acepta: boolean, motivo: string) => {
    pendiente?.responder(acepta, motivo);
    setPendiente(null);
  };

  return (
    <Contexto.Provider value={api}>
      {children}
      {pendiente && <DialogoConfirmar opciones={pendiente.opciones} conMotivo={pendiente.conMotivo} onResponder={responder} />}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:w-96">
        {avisos.map((a) => (
          <div
            key={a.id}
            role={a.tipo === "error" ? "alert" : "status"}
            className={cn(
              "panel pointer-events-auto flex w-full items-start gap-3 border-l-4 px-4 py-3 text-sm text-gray-800 shadow-lg",
              a.tipo === "error" ? "border-l-red-600" : "border-l-blue-500"
            )}
          >
            <p className="min-w-0 flex-1 whitespace-pre-line">{a.texto}</p>
            <button type="button" onClick={() => quitar(a.id)} aria-label="Cerrar aviso" className="-mr-1 -mt-0.5 shrink-0 rounded px-1 text-lg leading-none text-gray-500 hover:text-gray-900">
              ×
            </button>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

function DialogoConfirmar({ opciones, conMotivo, onResponder }: {
  opciones: OpcionesMotivo;
  conMotivo: boolean;
  onResponder: (acepta: boolean, motivo: string) => void;
}) {
  const { titulo, detalle, accion = "Confirmar", peligro = false, etiquetaMotivo = "Motivo", largoMaximo = 500 } = opciones;
  const idTitulo = useId();
  const idDetalle = useId();
  const [motivo, setMotivo] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  const areaMotivo = useRef<HTMLTextAreaElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const aceptar = useRef<HTMLButtonElement>(null);

  // Lo que borra arranca en Cancelar, para que un Enter distraído no lo ejecute. Con
  // motivo arranca en el campo: un Enter ahí sólo escribe un salto de línea.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    (conMotivo ? areaMotivo : peligro ? cancelar : aceptar).current?.focus();
    return () => previo?.focus?.();
  }, [peligro, conMotivo]);

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onResponder(false, "");
    } else if (e.key === "Tab") {
      // El foco no sale del diálogo.
      e.preventDefault();
      const focos = Array.from(caja.current?.querySelectorAll<HTMLElement>("textarea, button:not(:disabled)") ?? []);
      const i = focos.indexOf(document.activeElement as HTMLElement);
      focos[(i + (e.shiftKey ? -1 : 1) + focos.length) % focos.length]?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-blue-950/50 p-4 sm:items-center" onKeyDown={teclado}>
      <div
        ref={caja}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={detalle ? idDetalle : undefined}
        className="panel w-full max-w-md space-y-3 p-5 shadow-xl"
      >
        <h2 id={idTitulo} className="text-base font-semibold text-gray-900">{titulo}</h2>
        {detalle && <div id={idDetalle} className="text-sm text-gray-600">{detalle}</div>}
        {conMotivo && (
          <label className="block text-sm font-medium text-gray-700">
            {etiquetaMotivo}
            <textarea
              ref={areaMotivo}
              className="input mt-1 font-normal"
              rows={3}
              maxLength={largoMaximo}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
        )}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button ref={cancelar} type="button" className="btn btn-secondary" onClick={() => onResponder(false, "")}>Cancelar</button>
          <button
            ref={aceptar}
            type="button"
            className={cn("btn", peligro ? "bg-red-700 text-white hover:bg-red-800" : "btn-primary")}
            disabled={conMotivo && !motivo.trim()}
            onClick={() => onResponder(true, motivo)}
          >
            {accion}
          </button>
        </div>
      </div>
    </div>
  );
}
