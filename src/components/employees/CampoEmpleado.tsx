"use client";

/**
 * Un campo «Empleado» con el buscador, para todas las pantallas que eligen a un empleado
 * (pedido de Edbin, 2026-11-27): el rótulo y `BuscadorEmpleado` contra
 * `/api/empleados/buscar?para=…`, que aplica el permiso y el filtro de esa pantalla.
 *
 * No va dentro de <label> (`Campo` y `Field` envuelven en uno): el buscador tiene botones y
 * una lista, y un rótulo no puede contenerlos. Por eso el rótulo es un <span> con id.
 *
 * Como filtro («Todos»), el valor null es «todos»: «Quitar» vuelve a todos.
 */

import { useEffect, useId, useState } from "react";
import BuscadorEmpleado, { empleadoPorId, type EmpleadoBuscado } from "./BuscadorEmpleado";

export type { EmpleadoBuscado };

/** `/api/empleados/buscar?para=documentos&…`, sin los parámetros vacíos. */
export function rutaBuscarEmpleado(para: string, parametros: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams({ para });
  for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
  return `/api/empleados/buscar?${q.toString()}`;
}

/**
 * El elegido a partir de un id ya conocido: el del registro que se edita o el que llega en
 * la dirección (`?empleadoId=`). Mientras llega, null.
 */
export function useEmpleadoElegido(para: string, idInicial: string | null | undefined) {
  const [valor, setValor] = useState<EmpleadoBuscado | null>(null);
  useEffect(() => {
    if (!idInicial) return;
    let vivo = true;
    void empleadoPorId(rutaBuscarEmpleado(para), idInicial).then((e) => {
      if (vivo && e) setValor((actual) => actual ?? e);
    });
    return () => { vivo = false; };
  }, [para, idInicial]);
  return [valor, setValor] as const;
}

export default function CampoEmpleado({
  etiqueta,
  para,
  parametros,
  valor,
  onCambio,
  placeholder,
  vacio,
  sinTotal,
  ayuda,
  etiquetaOculta = false,
  className = "block text-sm",
}: {
  etiqueta: string;
  /** El contexto de `/api/empleados/buscar`: «documentos», «dotaciones», «asistencia»… */
  para: string;
  /** Lo que ese contexto necesita: `planId`, `capacitacionId`, `excluir`, `sucursalId`. */
  parametros?: Record<string, string | null | undefined>;
  valor: EmpleadoBuscado | null;
  onCambio: (e: EmpleadoBuscado | null) => void;
  placeholder?: string;
  vacio?: string;
  sinTotal?: boolean;
  /** Lo que va debajo (una nota sobre el elegido). */
  ayuda?: React.ReactNode;
  /** Para un filtro en una barra: el rótulo sólo para lectores de pantalla. */
  etiquetaOculta?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className} data-campo-empleado={para}>
      <span id={id} className={etiquetaOculta ? "sr-only" : "font-medium text-gray-800"}>{etiqueta}</span>
      <div className={etiquetaOculta ? "" : "mt-1"}>
        <BuscadorEmpleado
          etiquetaId={id}
          endpoint={rutaBuscarEmpleado(para, parametros)}
          valor={valor}
          onCambio={onCambio}
          placeholder={placeholder}
          vacio={vacio}
          sinTotal={sinTotal}
        />
      </div>
      {ayuda}
    </div>
  );
}
