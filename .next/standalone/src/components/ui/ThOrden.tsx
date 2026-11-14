import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ordenAlPulsar, type Direccion, type Orden } from "@/lib/http/orden";

/**
 * Encabezado de columna que ordena la lista. Es un enlace, no un botón: el orden vive
 * en la URL y así funciona con el teclado, en otra pestaña y al recargar.
 */
export default function ThOrden<C extends string>({
  campo,
  actual,
  enlace,
  dirInicial = "asc",
  className,
  children,
}: {
  campo: C;
  actual: Orden<C>;
  enlace: (orden: Orden<C>) => string;
  /** Con qué dirección arranca la columna: de mayor a menor en montos y fechas. */
  dirInicial?: Direccion;
  className?: string;
  children: ReactNode;
}) {
  const activa = actual.campo === campo;
  return (
    <th className={className} aria-sort={activa ? (actual.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={enlace(ordenAlPulsar(actual, campo, dirInicial))}
        scroll={false}
        // En una columna de cifras la flecha va a la izquierda: el texto queda alineado con los números.
        className={cn("group inline-flex items-center gap-1 hover:text-gray-900", activa && "text-gray-900", className?.includes("num") && "flex-row-reverse")}
      >
        {children}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn("h-3 w-3 shrink-0", activa ? "opacity-100" : "opacity-0 group-hover:opacity-40", activa && actual.dir === "desc" && "rotate-180")}
        >
          <path d="M6 3l3.5 5h-7z" fill="currentColor" />
        </svg>
      </Link>
    </th>
  );
}
