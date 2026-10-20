/**
 * Licencias emitidas por SDL, el servidor de licencias de ESC System.
 *
 * Sigue el contrato de `SDL/docs/API.md`: la LLAVE sólo sirve para pedir la
 * activación; lo que habilita el programa es el ARCHIVO de activación
 * `SDL1.<payload>.<firma>`, firmado con Ed25519 y atado al hash del código de
 * equipo. Se verifica aquí, sin red, con las claves públicas incrustadas al
 * compilar (next.config.ts → G360_SDL_CLAVES). Sin la clave privada de SDL no se
 * puede fabricar un archivo que pase esta verificación.
 */

import { createHash, createPublicKey, verify } from "crypto";

export interface ClaimsActivacion {
  v: number;
  typ: string;
  kid: string;
  license_id: string;
  activation_id: string;
  product: string;
  customer: string;
  edition?: string;
  edition_name?: string;
  features?: string[];
  license_type?: string;
  max_activations?: number;
  fingerprint_hash: string;
  issued_at: string;
  expires_at: string | null;
  refresh_before: string | null;
}

export type ErrorArchivo =
  | "formato"
  | "clave_desconocida"
  | "firma_invalida"
  | "otro_producto"
  | "otro_equipo"
  | "vencida";

export const MENSAJE_ERROR_ARCHIVO: Record<ErrorArchivo, string> = {
  formato: "El texto no es un archivo de activación. Debe empezar con «SDL1.».",
  clave_desconocida: "El archivo lo firmó una clave que esta versión no conoce. Pida a ESC System un instalador actualizado.",
  firma_invalida: "La firma del archivo no es válida: está incompleto o fue modificado.",
  otro_producto: "El archivo de activación es de otro producto.",
  otro_equipo: "El archivo de activación es de otro equipo. Pídalo con el código de equipo que aparece en esta pantalla.",
  vencida: "La licencia de ese archivo ya venció.",
};

/** Forma canónica del hash de equipo que firma SDL. */
export function hashEquipo(codigo: string): string {
  return createHash("sha256").update(codigo.replace(/[\s-]/g, "").toUpperCase(), "utf8").digest("hex");
}

export function verificarArchivoActivacion(
  token: string,
  opciones: { claves: Record<string, string>; producto: string; codigoEquipo: string; ahora: number }
): { ok: true; claims: ClaimsActivacion } | { ok: false; error: ErrorArchivo } {
  const partes = token.trim().split(".");
  if (partes.length !== 3 || partes[0] !== "SDL1") return { ok: false, error: "formato" };

  let claims: ClaimsActivacion;
  try {
    claims = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "formato" };
  }

  const crudo = opciones.claves[claims?.kid];
  if (!crudo) return { ok: false, error: "clave_desconocida" };

  try {
    const clave = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: crudo }, format: "jwk" });
    const firmado = Buffer.from(`${partes[0]}.${partes[1]}`, "ascii");
    if (!verify(null, firmado, clave, Buffer.from(partes[2], "base64url"))) {
      return { ok: false, error: "firma_invalida" };
    }
  } catch {
    return { ok: false, error: "firma_invalida" };
  }

  if (claims.typ !== "sdl-activation" || claims.product !== opciones.producto) {
    return { ok: false, error: "otro_producto" };
  }
  if (claims.fingerprint_hash !== hashEquipo(opciones.codigoEquipo)) return { ok: false, error: "otro_equipo" };
  if (claims.expires_at && opciones.ahora >= Date.parse(claims.expires_at)) return { ok: false, error: "vencida" };
  return { ok: true, claims };
}

const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 símbolos: sin 0 O 1 I L

/**
 * Llave de licencia en su forma canónica, o null si está mal escrita. El dígito
 * de control de SDL detecta toda sustitución de un carácter y toda transposición
 * de dos: el error se avisa aquí sin gastar un intento contra el servidor.
 */
export function normalizarLlave(entrada: string): string | null {
  const c = String(entrada).toUpperCase().replace(/[\s\-_.]/g, "");
  if (c.length < 18 || c.length > 22) return null;
  const prefijo = c.slice(0, -16);
  const datos = c.slice(-16);
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(prefijo)) return null;
  let suma = 0;
  for (let i = 0; i < 16; i++) {
    const v = ALFABETO.indexOf(datos[i]);
    if (v < 0) return null;
    suma += (i + 1) * v;
  }
  if (suma % 31 !== 0) return null;
  return `${prefijo}-${datos.slice(0, 4)}-${datos.slice(4, 8)}-${datos.slice(8, 12)}-${datos.slice(12)}`;
}

/** Respuestas de SDL que obligan a borrar el archivo y bloquear (§3 de API.md). */
export const ERRORES_QUE_BLOQUEAN = new Set([
  "suspendida",
  "cliente_suspendido",
  "revocada",
  "vencida",
  "no_activada",
]);

export type RespuestaSdl =
  | { ok: true; activation_file: string }
  | { ok: false; error: string; message?: string; red?: boolean };

/**
 * POST a la API de SDL. Sólo HTTPS (SDL rechaza HTTP con 403), salvo loopback
 * para pruebas. Un fallo de red o un 5xx NO es motivo para bloquear: se devuelve
 * marcado con `red` y la aplicación sigue con el archivo que tiene.
 */
export async function llamarSdl(
  urlBase: string,
  ruta: "/activate" | "/validate",
  cuerpo: Record<string, unknown>
): Promise<RespuestaSdl> {
  let url: URL;
  try {
    url = new URL(urlBase.replace(/\/+$/, "") + ruta);
  } catch {
    return { ok: false, error: "configuracion", message: "La dirección del servidor de licencias no es válida.", red: true };
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    return { ok: false, error: "https_requerido", message: "El servidor de licencias debe usar https://.", red: true };
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status >= 500) return { ok: false, error: "servidor", message: `El servidor de licencias respondió ${r.status}.`, red: true };
    const datos = (await r.json()) as RespuestaSdl;
    if (datos && datos.ok === true && typeof datos.activation_file === "string") return datos;
    if (datos && datos.ok === false && typeof datos.error === "string") return datos;
    return { ok: false, error: "respuesta", message: "Respuesta inesperada del servidor de licencias.", red: true };
  } catch {
    return { ok: false, error: "sin_conexion", message: "No se pudo contactar al servidor de licencias.", red: true };
  }
}
