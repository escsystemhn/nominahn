"use client";

/**
 * Ordenar una lista en el celular. Ahí la lista se lee en tarjetas y los encabezados
 * que ordenan (`ThOrden`) quedan ocultos: sin esto no había forma de ordenar. Usa la
 * misma URL (`?orden=campo&dir=asc|desc`), así que el orden se conserva al cambiar
 * de tamaño de pantalla, al recargar y al compartir el enlace.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Direccion } from "@/lib/http/orden";

export interface OpcionOrden {
  campo: string;
  etiqueta: string;
  /** Cómo se lee cada sentido: «de la A a la Z», «de mayor a menor», «más recientes primero». */
  tipo: "texto" | "numero" | "fecha";
}

const SENTIDO: Record<OpcionOrden["tipo"], Record<Direccion, string>> = {
  texto: { asc: "de la A a la Z", desc: "de la Z a la A" },
  numero: { asc: "de menor a mayor", desc: "de mayor a menor" },
  fecha: { asc: "más antiguas primero", desc: "más recientes primero" },
};

export default function OrdenMovil({ opciones, actual, className }: {
  opciones: OpcionOrden[];
  actual: { campo: string; dir: Direccion };
  className?: string;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const parametros = useSearchParams();
  const [aplicando, transicion] = useTransition();

  function cambiar(valor: string) {
    const [campo, dir] = valor.split(":");
    const q = new URLSearchParams(parametros.toString());
    q.set("orden", campo);
    q.set("dir", dir);
    // Un orden nuevo empieza en la primera página, como al pulsar un encabezado.
    q.delete("page");
    transicion(() => router.replace(`${ruta}?${q.toString()}`, { scroll: false }));
  }

  return (
    <label className={`block w-full text-sm sm:hidden ${className ?? ""}`}>
      <span className="mb-1 block text-xs text-gray-600">Ordenar por</span>
      <select className="input" value={`${actual.campo}:${actual.dir}`} disabled={aplicando} onChange={(e) => cambiar(e.target.value)}>
        {opciones.flatMap((o) =>
          (["asc", "desc"] as const).map((d) => (
            <option key={`${o.campo}:${d}`} value={`${o.campo}:${d}`}>{`${o.etiqueta}, ${SENTIDO[o.tipo][d]}`}</option>
          ))
        )}
      </select>
    </label>
  );
}
