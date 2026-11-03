"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Fila de tabla que abre su detalle al hacer clic en cualquier parte. Es un atajo para
 * el ratón: la fila debe llevar además un enlace de verdad, que es el que usa el teclado.
 */
export default function FilaEnlace({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();

  function alPulsar(e: React.MouseEvent<HTMLTableRowElement>) {
    // Lo que ya es interactivo dentro de la fila hace lo suyo.
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
    // Quien arrastra para copiar un dato no quiere irse de la pantalla.
    if (window.getSelection()?.toString()) return;
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  }

  return (
    <tr onClick={alPulsar} className={cn("cursor-pointer", className)}>
      {children}
    </tr>
  );
}
