"use client";

/**
 * «Columnas»: qué datos muestra la lista de Empleados. Cada casilla se aplica al momento
 * (la tabla se vuelve a dibujar en el servidor) y la elección se recuerda en este
 * navegador. «Empleado» va siempre: es lo que abre la ficha.
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COOKIE_COLUMNAS, GRUPOS_COLUMNAS, NINGUNA_COLUMNA, textoColumnas, type ClaveColumna, type GrupoColumnas } from "@/lib/empleados/columnas-lista";

export interface OpcionColumna {
  clave: ClaveColumna;
  etiqueta: string;
  grupo: GrupoColumnas;
}

const UN_ANIO = 60 * 60 * 24 * 365;

function guardar(valor: string | null) {
  const seguro = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    valor === null
      ? `${COOKIE_COLUMNAS}=; path=/; max-age=0; samesite=lax${seguro}`
      : `${COOKIE_COLUMNAS}=${encodeURIComponent(valor)}; path=/; max-age=${UN_ANIO}; samesite=lax${seguro}`;
}

export default function SelectorColumnas({ opciones, visibles, porOmision }: {
  opciones: OpcionColumna[];
  visibles: ClaveColumna[];
  porOmision: ClaveColumna[];
}) {
  const router = useRouter();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState<ReadonlySet<ClaveColumna>>(() => new Set(visibles));
  const [aplicando, transicion] = useTransition();

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  function aplicar(nueva: ReadonlySet<ClaveColumna>, valor: string | null) {
    setSeleccion(nueva);
    guardar(valor);
    transicion(() => router.refresh());
  }

  function alternar(clave: ClaveColumna) {
    const nueva = new Set(seleccion);
    if (nueva.has(clave)) nueva.delete(clave);
    else nueva.add(clave);
    // Sin ninguna se guarda una marca: una cookie vacía volvería a las columnas de siempre.
    aplicar(nueva, textoColumnas([...nueva]) || NINGUNA_COLUMNA);
  }

  const esPorOmision = seleccion.size === porOmision.length && porOmision.every((c) => seleccion.has(c));
  const cuantas = opciones.filter((o) => seleccion.has(o.clave)).length;

  return (
    <div ref={raiz} className="relative">
      <button
        ref={boton}
        type="button"
        className="btn btn-secondary"
        aria-expanded={abierto}
        aria-controls={id}
        data-selector-columnas
        onClick={() => setAbierto((a) => !a)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
          <rect x="3" y="4" width="14" height="12" rx="1.5" />
          <path d="M8 4v12M12.5 4v12" />
        </svg>
        Columnas
        <span className="tnum rounded-full bg-gray-100 px-1.5 text-xs font-medium text-gray-600">{cuantas + 1}</span>
      </button>

      {abierto && (
        <div
          id={id}
          role="dialog"
          aria-label="Columnas de la lista"
          className="fixed inset-x-4 top-24 z-40 rounded-xl border border-gray-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[25rem]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Columnas de la lista</p>
              <p className="text-xs text-gray-500">
                {cuantas + 1} de {opciones.length + 1} visibles. Se recuerda en este navegador.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-blue-700 hover:underline disabled:text-gray-400 disabled:no-underline"
              disabled={esPorOmision}
              onClick={() => aplicar(new Set(porOmision), null)}
            >
              Restablecer
            </button>
          </div>

          <div className="max-h-[min(60vh,32rem)] space-y-4 overflow-y-auto px-4 py-3">
            {GRUPOS_COLUMNAS.map((grupo) => {
              const delGrupo = opciones.filter((o) => o.grupo === grupo);
              if (delGrupo.length === 0) return null;
              return (
                <fieldset key={grupo}>
                  <legend className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700">
                    <span aria-hidden="true" className="h-3 w-0.75 rounded-full bg-blue-500" />
                    {grupo}
                  </legend>
                  <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                    {grupo === "Identificación" && (
                      <label className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-500">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked disabled />
                        Empleado <span className="text-xs">(siempre)</span>
                      </label>
                    )}
                    {delGrupo.map((o) => (
                      <label key={o.clave} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-800 hover:bg-gray-50">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={seleccion.has(o.clave)}
                          onChange={() => alternar(o.clave)}
                          data-columna={o.clave}
                        />
                        {o.etiqueta}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-2.5">
            <span aria-live="polite" className="text-xs text-gray-500">{aplicando ? "Aplicando…" : ""}</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setAbierto(false);
                boton.current?.focus();
              }}
            >
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
