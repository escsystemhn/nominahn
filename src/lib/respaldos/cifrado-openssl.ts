/**
 * Cifrado de respaldos en el formato de OpenSSL:
 *
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in RESPALDO.enc -out RESPALDO.tar.gz
 *
 * A propósito un formato estándar: el respaldo debe poder abrirse aunque esta
 * aplicación ya no exista (OpenSSL viene con Git para Windows y con cualquier
 * Linux). «Salted__» + 8 bytes de sal; clave y vector salen de PBKDF2-SHA256.
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { Transform } from "node:stream";

export const ITERACIONES_OPENSSL = 100_000;
const MAGIA = Buffer.from("Salted__", "ascii");

function derivar(clave: string, sal: Buffer): { key: Buffer; iv: Buffer } {
  const d = pbkdf2Sync(Buffer.from(clave, "utf8"), sal, ITERACIONES_OPENSSL, 48, "sha256");
  return { key: d.subarray(0, 32), iv: d.subarray(32, 48) };
}

/** Transforma texto claro en el formato de `openssl enc`. */
export function cifradorOpenssl(clave: string): Transform {
  const sal = randomBytes(8);
  const { key, iv } = derivar(clave, sal);
  const c = createCipheriv("aes-256-cbc", key, iv);
  let inicio = true;
  return new Transform({
    transform(trozo: Buffer, _enc, listo) {
      if (inicio) { this.push(Buffer.concat([MAGIA, sal])); inicio = false; }
      listo(null, c.update(trozo));
    },
    flush(listo) {
      if (inicio) this.push(Buffer.concat([MAGIA, sal]));
      listo(null, c.final());
    },
  });
}

/** Lo inverso. Una clave equivocada falla al final («bad decrypt»). */
export function descifradorOpenssl(clave: string): Transform {
  let cabecera = Buffer.alloc(0);
  let d: ReturnType<typeof createDecipheriv> | null = null;
  return new Transform({
    transform(trozo: Buffer, _enc, listo) {
      try {
        if (!d) {
          cabecera = Buffer.concat([cabecera, trozo]);
          if (cabecera.length < 16) return listo();
          if (!cabecera.subarray(0, 8).equals(MAGIA)) return listo(new Error("El archivo no está cifrado con este formato."));
          const { key, iv } = derivar(clave, cabecera.subarray(8, 16));
          d = createDecipheriv("aes-256-cbc", key, iv);
          return listo(null, d.update(cabecera.subarray(16)));
        }
        listo(null, d.update(trozo));
      } catch (e) {
        listo(e as Error);
      }
    },
    flush(listo) {
      try {
        if (!d) return listo(new Error("El archivo cifrado está incompleto."));
        listo(null, d.final());
      } catch {
        listo(new Error("La contraseña de cifrado no corresponde a este respaldo."));
      }
    },
  });
}
