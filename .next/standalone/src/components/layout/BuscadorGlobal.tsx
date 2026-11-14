"use client";

/**
 * Buscador de toda la aplicación: empleados, planillas y pantallas, desde cualquier
 * lugar. Se abre con el botón de la barra o con Ctrl+K.
 *
 * Las pantallas se filtran aquí mismo con el menú que la persona ya tiene permitido; lo
 * demás lo responde `/api/buscar`, que aplica permisos y alcance.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { coincide, palabrasDeBusqueda } from "@/lib/texto-busqueda";
import { cn } from "@/lib/utils";
import { opcionesDeMenu } from "./Sidebar";

interface Opcion {
  id: string;
  titulo: string;
  detalle?: string;
  href: string;
}

const SIN_RESULTADOS = { empleados: [] as Opcion[], planillas: [] as Opcion[] };
const ESPERA_ESCRITURA_MS = 200;
const PANTALLAS_VISIBLES = 5;

const IconoBuscar = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
  </svg>
);

export default function BuscadorGlobal({ permisos, conEmpleado, jerarquiaNomina }: { permisos: readonly string[]; conEmpleado: boolean; jerarquiaNomina: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  const cerrar = () => {
    setAbierto(false);
    boton.current?.focus();
  };

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Buscar empleado, planilla o pantalla"
        aria-keyshortcuts="Control+K"
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 md:w-80 md:border md:border-gray-300 md:bg-white md:px-3 md:hover:border-gray-400 md:hover:bg-white"
      >
        <IconoBuscar className="h-5 w-5 shrink-0 md:h-4 md:w-4" />
        <span className="hidden flex-1 truncate text-left md:block">Buscar empleado, planilla o pantalla</span>
        <kbd className="hidden rounded border border-gray-200 px-1.5 text-xs font-sans text-gray-500 lg:block">Ctrl K</kbd>
      </button>
      {/* Se monta al abrir: cada búsqueda empieza limpia. */}
      {abierto && <Paleta permisos={permisos} conEmpleado={conEmpleado} jerarquiaNomina={jerarquiaNomina} onCerrar={cerrar} />}
    </>
  );
}

function Paleta({ permisos, conEmpleado, jerarquiaNomina, onCerrar }: { permisos: readonly string[]; conEmpleado: boolean; jerarquiaNomina: boolean; onCerrar: () => void }) {
  const router = useRouter();
  const idLista = useId();
  const [texto, setTexto] = useState("");
  const [remotos, setRemotos] = useState(SIN_RESULTADOS);
  const [buscando, setBuscando] = useState(false);
  const [activo, setActivo] = useState(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peticion = useRef<AbortController | null>(null);

  const palabras = useMemo(() => palabrasDeBusqueda(texto), [texto]);
  const hayTexto = palabras.join("").length >= 2;

  const pantallas = useMemo<Opcion[]>(() => {
    if (!hayTexto) return [];
    return opcionesDeMenu(permisos, conEmpleado, jerarquiaNomina)
      .filter((o) => coincide(`${o.label} ${o.seccion ?? ""}`, palabras))
      .slice(0, PANTALLAS_VISIBLES)
      .map((o) => ({ id: `pantalla-${o.href}`, titulo: o.label, detalle: o.seccion, href: o.href }));
  }, [permisos, conEmpleado, jerarquiaNomina, palabras, hayTexto]);

  const grupos = [
    { nombre: "Pantallas", opciones: pantallas },
    { nombre: "Empleados", opciones: remotos.empleados },
    { nombre: "Planillas", opciones: remotos.planillas },
  ].filter((g) => g.opciones.length > 0);
  const opciones = grupos.flatMap((g) => g.opciones);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      peticion.current?.abort();
    },
    []
  );

  function alEscribir(valor: string) {
    setTexto(valor);
    setActivo(0);
    if (temporizador.current) clearTimeout(temporizador.current);
    peticion.current?.abort();
    if (palabrasDeBusqueda(valor).join("").length < 2) {
      setRemotos(SIN_RESULTADOS);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    temporizador.current = setTimeout(async () => {
      const control = new AbortController();
      peticion.current = control;
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(valor)}`, { signal: control.signal });
        setRemotos(res.ok ? await res.json() : SIN_RESULTADOS);
        setBuscando(false);
      } catch (e) {
        // Una búsqueda vieja cancelada por la siguiente no es un error.
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setRemotos(SIN_RESULTADOS);
          setBuscando(false);
        }
      }
    }, ESPERA_ESCRITURA_MS);
  }

  function abrir(o: Opcion | undefined) {
    if (!o) return;
    onCerrar();
    router.push(o.href);
  }

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCerrar();
    } else if (e.key === "ArrowDown" && opciones.length) {
      e.preventDefault();
      setActivo((i) => (i + 1) % opciones.length);
    } else if (e.key === "ArrowUp" && opciones.length) {
      e.preventDefault();
      setActivo((i) => (i - 1 + opciones.length) % opciones.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      abrir(opciones[activo]);
    } else if (e.key === "Tab") {
      // El único control es el campo: el foco no sale de la ventana.
      e.preventDefault();
    }
  }

  const idOpcion = (i: number) => `${idLista}-${i}`;
  let posicion = -1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-blue-950/50 p-4 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Buscar" className="panel flex max-h-full w-full max-w-xl flex-col overflow-hidden shadow-xl" onKeyDown={teclado}>
        <div className="flex items-center gap-3 border-b border-gray-200 px-4">
          <IconoBuscar className="h-5 w-5 shrink-0 text-gray-500" />
          <input
            autoFocus
            role="combobox"
            aria-expanded={opciones.length > 0}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={opciones.length ? idOpcion(activo) : undefined}
            aria-label="Buscar empleado, planilla o pantalla"
            placeholder="Buscar empleado, planilla o pantalla"
            autoComplete="off"
            value={texto}
            onChange={(e) => alEscribir(e.target.value)}
            className="h-12 w-full min-w-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
          />
        </div>

        <div id={idLista} role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto py-2">
          {grupos.map((g) => (
            <div key={g.nombre} role="group" aria-label={g.nombre} className="pb-1">
              <p aria-hidden="true" className="px-4 pb-1 pt-2 text-xs font-medium text-gray-500">{g.nombre}</p>
              {g.opciones.map((o) => {
                posicion++;
                const i = posicion;
                return (
                  <div
                    key={o.id}
                    id={idOpcion(i)}
                    role="option"
                    aria-selected={i === activo}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => abrir(o)}
                    className={cn("flex cursor-pointer items-baseline justify-between gap-4 px-4 py-2 text-sm", i === activo && "bg-blue-50")}
                  >
                    <span className="min-w-0 truncate font-medium text-gray-900">{o.titulo}</span>
                    {o.detalle && <span className="shrink-0 truncate text-xs text-gray-500">{o.detalle}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <p aria-live="polite" className={cn("px-4 text-sm text-gray-500", (opciones.length === 0 || buscando) && "border-t border-gray-100 py-3", opciones.length > 0 && !buscando && "sr-only")}>
          {!hayTexto
            ? "Escriba al menos dos letras. No importa si lleva tildes."
            : buscando
              ? "Buscando…"
              : opciones.length === 0
                ? `Sin resultados para «${texto.trim()}».`
                : `${opciones.length} resultados.`}
        </p>
      </div>
    </div>
  );
}
