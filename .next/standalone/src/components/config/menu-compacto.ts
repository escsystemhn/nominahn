"use client";

/**
 * Preferencia del menú de Configuración: con nombres o sólo con íconos (pedido de Edbin,
 * 2026-11-17: «en algunas computadoras la información se ve amontonada»).
 *
 * Es una comodidad de cada computadora: va en localStorage y, si el navegador no deja
 * guardar (ventana privada, almacenamiento bloqueado), se recuerda mientras la página siga
 * abierta. Sin elección guardada, una pantalla de menos de 1440 px abre compacto: a 1366 px,
 * barra principal + menú con nombres dejan muy poco para el contenido.
 */

import { useCallback, useSyncExternalStore } from "react";

const CLAVE = "g360.configuracion.menuCompacto";
const EVENTO = "g360:menu-compacto";
const ANGOSTA = "(max-width: 1439.98px)";
let enMemoria: boolean | null = null;

function leer(): boolean {
  try {
    const v = window.localStorage.getItem(CLAVE);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // Sin almacenamiento: vale lo elegido en esta página o el ancho de la pantalla.
  }
  return enMemoria ?? window.matchMedia(ANGOSTA).matches;
}

function suscribir(aviso: () => void) {
  const mq = window.matchMedia(ANGOSTA);
  mq.addEventListener("change", aviso);
  window.addEventListener("storage", aviso);
  window.addEventListener(EVENTO, aviso);
  return () => {
    mq.removeEventListener("change", aviso);
    window.removeEventListener("storage", aviso);
    window.removeEventListener(EVENTO, aviso);
  };
}

/** [compacto, cambiar]. En el servidor siempre con nombres; el navegador ajusta al hidratar. */
export function useMenuCompacto(): [boolean, (compacto: boolean) => void] {
  const compacto = useSyncExternalStore(suscribir, leer, () => false);
  const cambiar = useCallback((v: boolean) => {
    enMemoria = v;
    try {
      window.localStorage.setItem(CLAVE, v ? "1" : "0");
    } catch {
      // Queda en memoria hasta recargar.
    }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return [compacto, cambiar];
}
