/**
 * Cierre de sesión por inactividad. PURO y sin Prisma: lo usan el proxy (Edge), el
 * servidor y el navegador.
 *
 * DOS CAPAS, PORQUE UNA SOLA NO ALCANZA:
 *  · En el navegador (`CierreInactividad`): mide la actividad real de la persona
 *    (teclado, ratón, toques), avisa un minuto antes y cierra la sesión limpiando la
 *    pantalla. Es la que se ve.
 *  · En el servidor: el token de la sesión lleva `actividadEn`, la última actividad
 *    que el navegador informó con un latido (`RUTA_LATIDO`). Pasado el límite, el
 *    token deja de valer aunque la pestaña siga abierta, el navegador esté dormido o
 *    alguien copie la cookie. Es la que protege.
 *
 * SÓLO EL LATIDO CUENTA COMO ACTIVIDAD. Antes cualquier petición renovaba la sesión de
 * 8 horas, así que una pantalla que consulta algo cada minuto la mantenía viva para
 * siempre. Ahora una consulta automática no alarga nada: hace falta una persona.
 */

/** Clave en ConfiguracionSistema. */
export const CLAVE_INACTIVIDAD = "SEGURIDAD_INACTIVIDAD_MINUTOS";
export const INACTIVIDAD_POR_OMISION = 5;
export const INACTIVIDAD_MINIMA = 1;
/** La sesión dura como mucho 8 horas (`SESION.maxAge`): más no tendría efecto. */
export const INACTIVIDAD_MAXIMA = 480;

/** El navegador informa actividad a lo sumo una vez por minuto. */
export const LATIDO_MS = 60_000;
/**
 * Holgura del servidor sobre el límite: el último latido puede ir hasta un minuto por
 * detrás de la última tecla, más la red. Así el servidor nunca corta a quien el
 * navegador todavía considera activo; el navegador cierra primero.
 */
export const MARGEN_SERVIDOR_MS = 2 * 60_000;

export const RUTA_LATIDO = "/api/sesion/latido";
export const RUTA_CIERRE = "/api/sesion/cierre";

/** Minutos válidos; cualquier otra cosa, el valor por omisión. */
export function normalizarMinutos(valor: unknown): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : NaN;
  if (!Number.isInteger(n) || n < INACTIVIDAD_MINIMA || n > INACTIVIDAD_MAXIMA) return INACTIVIDAD_POR_OMISION;
  return n;
}

/** Lo que escribe el administrador. */
export function leerMinutos(texto: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  const t = String(texto ?? "").trim();
  if (!/^\d+$/.test(t)) return { ok: false, error: "Escriba los minutos como un número entero, por ejemplo 5." };
  const n = Number(t);
  if (n < INACTIVIDAD_MINIMA || n > INACTIVIDAD_MAXIMA) {
    return { ok: false, error: `Use entre ${INACTIVIDAD_MINIMA} y ${INACTIVIDAD_MAXIMA} minutos (8 horas, lo que dura una sesión).` };
  }
  return { ok: true, valor: n };
}

/**
 * ¿El token pasó el límite de inactividad (con la holgura del servidor)? Un token sin
 * marca no vence aquí. Lee del token `actividadEn` (última actividad informada, en ms)
 * e `inactividadMin` (minutos copiados de la configuración al entrar y al revalidar).
 */
export function vencidaPorInactividad(token: Readonly<Record<string, unknown>>, ahora: number): boolean {
  if (typeof token.actividadEn !== "number") return false;
  return ahora - token.actividadEn > normalizarMinutos(token.inactividadMin) * 60_000 + MARGEN_SERVIDOR_MS;
}

/** Cuánto antes del cierre se avisa: un minuto, o la mitad del límite si es más corto. */
export function anticipoAvisoMs(limiteMs: number): number {
  return Math.min(60_000, Math.floor(limiteMs / 2));
}

/**
 * Adónde volver después de entrar: sólo rutas de esta misma aplicación. Sin esta
 * comprobación, `/login?volver=https://otro.sitio` serviría para mandar a alguien a
 * una página falsa justo después de escribir su contraseña (redirección abierta).
 */
export function destinoSeguro(volver: string | null | undefined): string {
  if (!volver || !volver.startsWith("/") || volver.startsWith("//") || volver.startsWith("/\\")) return "/dashboard";
  if ([...volver].some((c) => c.charCodeAt(0) < 32) || volver.startsWith("/login") || volver.startsWith("/api")) return "/dashboard";
  return volver;
}

/** Texto de los minutos: «5 minutos», «1 minuto», «1 hora y 30 minutos». */
export function textoMinutos(min: number): string {
  if (min < 60) return `${min} ${min === 1 ? "minuto" : "minutos"}`;
  const h = Math.floor(min / 60), m = min % 60;
  const horas = `${h} ${h === 1 ? "hora" : "horas"}`;
  return m ? `${horas} y ${m} ${m === 1 ? "minuto" : "minutos"}` : horas;
}
