/**
 * Política de reintentos de la cola hacia SAP. Separada de `envio.ts` para que
 * sea pura y probable sin base de datos.
 */

/** Esperas entre reintentos de un error transitorio, en minutos; la última se repite. */
export const ESPERAS_REINTENTO_MIN = [1, 5, 15, 60, 360] as const;
export const MAX_INTENTOS = 10;

/** Cuándo volver a intentar tras `intentos` fallos; `null` cuando ya no se reintenta. */
export function proximoIntento(intentos: number, ahora: Date = new Date()): Date | null {
  if (intentos >= MAX_INTENTOS) return null;
  const minutos = ESPERAS_REINTENTO_MIN[Math.min(Math.max(intentos, 1) - 1, ESPERAS_REINTENTO_MIN.length - 1)];
  return new Date(ahora.getTime() + minutos * 60_000);
}
