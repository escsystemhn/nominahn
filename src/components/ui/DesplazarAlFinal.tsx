"use client";

/**
 * Una caja con desplazamiento horizontal que arranca al final: en pantalla angosta, el
 * tablero de Planillas muestra primero los períodos más recientes (los de la derecha).
 */

import { useEffect, useRef } from "react";

export default function DesplazarAlFinal({ className, children }: { className?: string; children: React.ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caja.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return <div ref={caja} className={className} data-desplazar-al-final>{children}</div>;
}
