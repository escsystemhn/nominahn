"use client";

/**
 * Elegir a un empleado escribiendo, en vez de recorrer un <select> con cientos de nombres
 * (pedido de Edbin, 2026-11-18, al vincular usuarios con empleados).
 *
 * - Busca en el servidor mientras se escribe: nombre en cualquier orden y sin tildes, o código.
 * - Cada resultado dice quién es: foto o iniciales, nombre, código, puesto, departamento y lugar,
 *   con lo buscado resaltado. Con homónimos, eso es lo que evita elegir al equivocado.
 * - Teclado completo (patrón combobox de ARIA): ↑ ↓ para moverse, Enter para elegir, Esc para
 *   borrar o volver. La lista sólo muestra resultados de lo que está escrito AHORA: con los de
 *   la búsqueda anterior, quien escribía rápido y daba Enter elegía a otra persona. Un Enter
 *   que llega antes que los resultados espera y elige el primero. La lista va DENTRO del formulario, no flotando: en una ventana con
 *   desplazamiento propio, una lista flotante quedaría recortada.
 * - Elegido, se muestra como una tarjeta con «Cambiar» y «Quitar».
 * - `sugerencia`: con el buscador vacío, propone a quien coincide con ese texto (por ejemplo,
 *   el nombre ya escrito en el formulario).
 */

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import FotoAvatar from "@/components/employees/FotoAvatar";
import { palabrasDeBusqueda, tramosResaltados } from "@/lib/texto-busqueda";
import { cn } from "@/lib/utils";

export interface EmpleadoBuscado {
  id: string;
  codigo: string;
  nombre: string;
  puesto: string | null;
  departamento: string;
  /** La sucursal (o la división, con la jerarquía de nómina). */
  lugar: string;
  correo: string | null;
  /** Marca de la foto; null = sus iniciales. */
  foto: number | null;
}

const ESPERA_MS = 200;

const detalle = (e: EmpleadoBuscado) => [e.puesto, e.departamento, e.lugar].filter(Boolean).join(" · ");

function Resaltado({ texto, palabras }: { texto: string; palabras: string[] }) {
  return (
    <>
      {tramosResaltados(texto, palabras).map((t, i) =>
        t.marca ? <mark key={i} className="bg-transparent font-semibold text-blue-700">{t.texto}</mark> : <span key={i}>{t.texto}</span>
      )}
    </>
  );
}

export default function BuscadorEmpleado({
  etiquetaId,
  valor,
  onCambio,
  endpoint,
  sugerencia,
  placeholder = "Nombre, apellido o código",
  vacio = "Ningún empleado coincide.",
}: {
  /** Id del rótulo visible del campo (aria-labelledby). */
  etiquetaId: string;
  valor: EmpleadoBuscado | null;
  onCambio: (empleado: EmpleadoBuscado | null) => void;
  /** Ruta que responde `{ total, empleados: EmpleadoBuscado[] }` a `?q=`. */
  endpoint: string;
  sugerencia?: string;
  placeholder?: string;
  /** Lo que se dice cuando nada coincide. */
  vacio?: string;
}) {
  const id = useId();
  const idLista = `${id}-lista`;
  const idOpcion = (i: number) => `${id}-op-${i}`;
  const entrada = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(!valor);
  const [texto, setTexto] = useState("");
  /** Los resultados y la búsqueda a la que responden. */
  const [lote, setLote] = useState<{ consulta: string | null; empleados: EmpleadoBuscado[]; total: number | null }>({ consulta: null, empleados: [], total: null });
  const [activo, setActivo] = useState(0);
  const [fallo, setFallo] = useState(false);
  /** Enter pulsado antes de que lleguen los resultados de lo escrito. */
  const enterPendiente = useRef(false);

  const escrito = texto.trim();
  const porSugerencia = !escrito && Boolean(sugerencia?.trim());
  const consulta = escrito || (sugerencia?.trim() ?? "");
  const palabras = palabrasDeBusqueda(consulta);
  const fresco = lote.consulta === consulta;
  const resultados = fresco ? lote.empleados : [];
  const total = fresco ? lote.total : null;
  const cargando = abierto && !fresco && !fallo;

  function elegir(e: EmpleadoBuscado) {
    enterPendiente.current = false;
    onCambio(e);
    setTexto("");
    setAbierto(false);
  }

  /** Llegan los resultados: si se pulsó Enter mientras tanto, se elige el primero. */
  const alLlegar = useEffectEvent((de: string, empleados: EmpleadoBuscado[]) => {
    if (enterPendiente.current && de && empleados.length > 0) elegir(empleados[0]);
    enterPendiente.current = false;
  });

  useEffect(() => {
    if (!abierto) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${endpoint}?q=${encodeURIComponent(consulta)}`, { signal: ctrl.signal });
        const d = r.ok ? await r.json() : null;
        const empleados: EmpleadoBuscado[] = d?.empleados ?? [];
        setFallo(!d);
        setLote({ consulta, empleados, total: typeof d?.total === "number" ? d.total : null });
        setActivo(0);
        alLlegar(consulta, empleados);
      } catch {
        if (!ctrl.signal.aborted) setFallo(true);
      }
    }, consulta ? ESPERA_MS : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [abierto, consulta, endpoint]);

  useEffect(() => {
    if (abierto) document.getElementById(idOpcion(activo))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idOpcion deriva de `id`, que no cambia.
  }, [activo, abierto]);

  const mostrarLista = Boolean(consulta) && resultados.length > 0;

  function teclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && mostrarLista) {
      e.preventDefault();
      setActivo((a) => (a + 1) % resultados.length);
    } else if (e.key === "ArrowUp" && mostrarLista) {
      e.preventDefault();
      setActivo((a) => (a - 1 + resultados.length) % resultados.length);
    } else if (e.key === "Enter") {
      // Enter elige; nunca envía el formulario a medio llenar.
      e.preventDefault();
      if (mostrarLista && resultados.at(activo)) elegir(resultados.at(activo)!);
      else if (consulta && !fresco) enterPendiente.current = true;
    } else if (e.key === "Escape") {
      if (texto) {
        e.stopPropagation();
        setTexto("");
      } else if (valor) {
        e.stopPropagation();
        setAbierto(false);
      }
    }
  }

  if (valor && !abierto) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2" data-empleado-elegido aria-labelledby={etiquetaId} role="group">
        <FotoAvatar empleadoId={valor.id} version={valor.foto} nombre={valor.nombre} tamano="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{valor.nombre}</p>
          <p className="truncate text-xs text-gray-500">
            <span className="font-mono">{valor.codigo}</span>
            {detalle(valor) && <> · {detalle(valor)}</>}
          </p>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-blue-700 hover:underline"
          onClick={() => {
            setAbierto(true);
            setTimeout(() => entrada.current?.focus(), 0);
          }}
        >
          Cambiar
        </button>
        <button
          type="button"
          aria-label={`Quitar a ${valor.nombre}`}
          title="Quitar"
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          onClick={() => {
            onCambio(null);
            setAbierto(true);
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  let estado = "";
  if (fallo) estado = "No se pudo buscar. Intente de nuevo.";
  else if (cargando) estado = "Buscando…";
  else if (!consulta) estado = total === null ? "" : `Escriba para buscar entre ${total} ${total === 1 ? "empleado" : "empleados"}.`;
  else if (resultados.length === 0) estado = porSugerencia ? "" : vacio;
  else if (total !== null && total > resultados.length) estado = `${resultados.length} de ${total} coincidencias: escriba más para afinar.`;
  else estado = total === 1 ? "1 coincidencia." : `${resultados.length} coincidencias.`;

  return (
    <div data-buscador-empleado>
      <div className="relative">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400">
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13 13l3.5 3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={entrada}
          type="text"
          role="combobox"
          aria-labelledby={etiquetaId}
          aria-expanded={mostrarLista}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={mostrarLista ? idOpcion(activo) : undefined}
          autoComplete="off"
          spellCheck={false}
          className="input pl-9"
          placeholder={placeholder}
          value={texto}
          onChange={(e) => {
            enterPendiente.current = false;
            setTexto(e.target.value);
          }}
          onKeyDown={teclado}
        />
      </div>

      {mostrarLista && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-gray-200">
          {porSugerencia && (
            <p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600">Coinciden con el nombre escrito</p>
          )}
          <ul id={idLista} role="listbox" aria-labelledby={etiquetaId} className="max-h-64 overflow-y-auto">
            {resultados.map((e, i) => (
              <li
                key={e.id}
                id={idOpcion(i)}
                role="option"
                aria-selected={i === activo}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === activo ? "bg-blue-50" : "hover:bg-gray-50")}
                onMouseEnter={() => setActivo(i)}
                // Que el clic no le quite el foco a la caja antes de elegir.
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => elegir(e)}
                data-opcion-empleado={e.codigo}
              >
                <FotoAvatar empleadoId={e.id} version={e.foto} nombre={e.nombre} tamano="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-900"><Resaltado texto={e.nombre} palabras={palabras} /></p>
                  <p className="truncate text-xs text-gray-500">
                    <span className="font-mono"><Resaltado texto={e.codigo} palabras={palabras} /></span>
                    {detalle(e) && <> · {detalle(e)}</>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-1 flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-gray-500" data-estado-buscador>{estado}</p>
        {valor && (
          <button type="button" className="shrink-0 text-xs font-medium text-blue-700 hover:underline" onClick={() => { setTexto(""); setAbierto(false); }}>
            Dejar a {valor.nombre.split(" ")[0]}
          </button>
        )}
      </div>
    </div>
  );
}
