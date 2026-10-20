/**
 * Lo que decide la edición se fija AL COMPILAR, no al arrancar.
 *
 * next.config.ts copia estas variables en su bloque `env`, y Next las sustituye
 * por su valor literal dentro del código compilado. Así, en un equipo instalado
 * no basta con editar un archivo de configuración para apagar la evaluación o
 * cambiar la clave pública que valida las licencias: habría que modificar el
 * programa compilado.
 *
 * Sin `G360_EDICION=instalable` (el `next dev` de desarrollo y el despliegue en
 * el VPS) la licencia no interviene en nada.
 */

export const EDICION_INSTALABLE = process.env.G360_EDICION === "instalable";

/** Base de la API de SDL, p. ej. https://licencias.esc-systemhn.com/api/v1. Vacía = sólo activación con archivo. */
export const SDL_URL = process.env.G360_SDL_URL ?? "";

/** Código del producto en SDL; es también el prefijo de sus llaves. */
export const SDL_PRODUCTO = process.env.G360_SDL_PRODUCTO || "NOMI";

export const VERSION_APP = process.env.G360_VERSION || "0.0.0";

/** kid → clave pública Ed25519 (base64url), tal como la imprime `npm run sdl -- keys show`. */
export function clavesSdl(): Record<string, string> {
  try {
    const mapa = JSON.parse(process.env.G360_SDL_CLAVES || "{}");
    return mapa && typeof mapa === "object" ? mapa : {};
  } catch {
    return {};
  }
}
