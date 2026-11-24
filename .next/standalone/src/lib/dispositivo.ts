/**
 * Con qué equipo se está usando la aplicación: computadora, tablet o celular.
 *
 * Se decide por cómo se maneja la pantalla y por su tamaño FÍSICO, no por el ancho
 * de la ventana: una ventana angosta en una computadora sigue siendo una computadora,
 * y un celular acostado sigue siendo un celular.
 *   · Con mouse o panel táctil como puntero principal: computadora. Incluye las
 *     laptops con pantalla táctil y la tablet con teclado y panel táctil.
 *   · Con el dedo, si el lado corto de la pantalla mide menos de 600 px: celular.
 *   · Con el dedo y una pantalla mayor: tablet.
 */

export type Dispositivo = "COMPUTADORA" | "TABLET" | "CELULAR";

/** Lado corto, en px de CSS, a partir del cual una pantalla táctil es de tablet. */
export const LADO_CORTO_TABLET = 600;

export function tipoDeDispositivo(e: { conDedo: boolean; anchoPantalla: number; altoPantalla: number }): Dispositivo {
  if (!e.conDedo) return "COMPUTADORA";
  return Math.min(e.anchoPantalla, e.altoPantalla) < LADO_CORTO_TABLET ? "CELULAR" : "TABLET";
}

export const NOMBRE_DISPOSITIVO: Record<Dispositivo, string> = {
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CELULAR: "Celular",
};
