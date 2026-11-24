"use client";

/**
 * Al pie del menú: si se está usando en una computadora, una tablet o un celular.
 * Ver `lib/dispositivo.ts` para cómo se decide.
 *
 * Se lee en el navegador: el servidor no sabe en qué equipo se abrirá la página, así
 * que no dibuja nada y aparece al cargar. Cambia solo si se conecta un mouse o se gira
 * la pantalla.
 */

import { useSyncExternalStore } from "react";
import { NOMBRE_DISPOSITIVO, tipoDeDispositivo, type Dispositivo } from "@/lib/dispositivo";

const CONSULTA_DEDO = "(pointer: coarse)";

function suscribir(avisar: () => void) {
  const consulta = window.matchMedia(CONSULTA_DEDO);
  consulta.addEventListener("change", avisar);
  window.addEventListener("resize", avisar);
  return () => {
    consulta.removeEventListener("change", avisar);
    window.removeEventListener("resize", avisar);
  };
}

function leer(): Dispositivo {
  return tipoDeDispositivo({
    conDedo: window.matchMedia(CONSULTA_DEDO).matches,
    anchoPantalla: window.screen.width,
    altoPantalla: window.screen.height,
  });
}

const ICONOS: Record<Dispositivo, React.ReactNode> = {
  COMPUTADORA: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></>,
  TABLET: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M11 18h2" /></>,
  CELULAR: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
};

export default function TipoDispositivo() {
  const dispositivo = useSyncExternalStore(suscribir, leer, () => null);
  if (!dispositivo) return null;
  return (
    <p data-dispositivo={dispositivo} className="mt-1 flex items-center gap-1.5 text-white/60">
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        {ICONOS[dispositivo]}
      </svg>
      <span>
        <span className="sr-only">Equipo: </span>
        {NOMBRE_DISPOSITIVO[dispositivo]}
      </span>
    </p>
  );
}
