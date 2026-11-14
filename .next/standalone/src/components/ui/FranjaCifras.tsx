import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Cifra {
  label: ReactNode;
  valor: ReactNode;
  detalle?: ReactNode;
  /** La cifra por la que se viene a esta pantalla. A lo sumo una. */
  destacada?: boolean;
}

const COLUMNAS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

/**
 * Cifras de resumen en una franja con divisores, no en tarjetas de colores: en una
 * pantalla de nómina el dato es lo importante, y un fondo pastel compite con él.
 */
export default function FranjaCifras({ cifras, etiqueta }: { cifras: Cifra[]; etiqueta?: string }) {
  return (
    <section aria-label={etiqueta}>
      <div className={cn("grid grid-cols-1 divide-y divide-gray-200 border-b border-gray-200 sm:divide-x sm:divide-y-0", COLUMNAS[cifras.length] ?? "lg:grid-cols-4")}>
        {cifras.map((c, i) => (
          <div key={i} className="py-4 sm:px-5 sm:first:pl-0 lg:px-6">
            <p className="text-sm text-gray-500">{c.label}</p>
            <p className={cn("tnum mt-1 text-xl font-semibold leading-none", c.destacada ? "text-blue-800" : "text-gray-900")}>{c.valor}</p>
            {c.detalle && <div className="mt-2 text-xs text-gray-500">{c.detalle}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
