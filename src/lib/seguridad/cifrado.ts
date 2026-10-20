/**
 * Cifrado de credenciales guardadas en la base: la contraseña de los relojes
 * biométricos Hikvision y la del servidor de correo saliente.
 *
 * POR QUÉ NO SE GUARDAN EN CLARO. En un terminal de control de acceso esa
 * credencial abre puertas; la del correo permite enviar mensajes a nombre de la
 * empresa, que es exactamente lo que necesita un fraude de nómina («cambie su
 * cuenta de depósito»). Una fila legible convierte cualquier volcado de la base
 * —una copia de seguridad, un `SELECT` de soporte— en ese acceso.
 *
 * AES-256-GCM con nonce por registro. GCM y no CBC porque además de cifrar
 * autentica: un valor manipulado falla al descifrar en vez de devolver basura.
 *
 * La clave sale de `CIFRADO_KEY`. Se acepta también `BIOMETRICO_KEY`, que fue su
 * nombre mientras sólo la usaban los relojes, para no romper las instalaciones
 * que ya la tienen. Si no hay ninguna NO se cae la aplicación —el resto no la
 * necesita— pero sí se rechaza guardar una credencial: es preferible que el alta
 * falle con un mensaje claro a que la contraseña acabe en claro «temporalmente».
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITMO = "aes-256-gcm";
const BYTES_NONCE = 12; // el tamaño recomendado para GCM
const BYTES_TAG = 16;

export class SecretoNoConfigurado extends Error {
  constructor() {
    super(
      "Falta CIFRADO_KEY en el entorno: sin ella no se pueden guardar credenciales, " +
        "y no se guardan en claro. Genere una con crypto.randomBytes(32).toString('hex')."
    );
    this.name = "SecretoNoConfigurado";
  }
}

/**
 * Clave de 32 bytes derivada de la variable de entorno.
 *
 * Se pasa por SHA-256 para aceptar cualquier longitud de entrada sin que una
 * clave corta produzca un error de tamaño en tiempo de ejecución. No sustituye a
 * que la variable sea larga y aleatoria.
 */
function clave(): Buffer {
  const bruta = process.env.CIFRADO_KEY || process.env.BIOMETRICO_KEY;
  if (!bruta || bruta.length < 32) throw new SecretoNoConfigurado();
  return createHash("sha256").update(bruta).digest();
}

/** ¿Se pueden guardar credenciales en esta instalación? */
export function cifradoDisponible(): boolean {
  try {
    clave();
    return true;
  } catch {
    return false;
  }
}

/** Cifra un secreto. Formato: base64(nonce ‖ tag ‖ cifrado). */
export function cifrar(texto: string): string {
  const nonce = randomBytes(BYTES_NONCE);
  const cipher = createCipheriv(ALGORITMO, clave(), nonce);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), cifrado]).toString("base64");
}

/** Descifra. Lanza si el valor fue manipulado o la clave no es la misma. */
export function descifrar(empaquetado: string): string {
  const buf = Buffer.from(empaquetado, "base64");
  if (buf.length <= BYTES_NONCE + BYTES_TAG) {
    throw new Error("Credencial cifrada con formato inválido.");
  }

  const nonce = buf.subarray(0, BYTES_NONCE);
  const tag = buf.subarray(BYTES_NONCE, BYTES_NONCE + BYTES_TAG);
  const cifrado = buf.subarray(BYTES_NONCE + BYTES_TAG);

  const decipher = createDecipheriv(ALGORITMO, clave(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
}
