/**
 * Política de contraseñas y utilidades de hashing.
 *
 * Hasta ahora las contraseñas sólo existían en el seed (`bcrypt.hash(..., 12)`),
 * porque no había forma de crear un usuario ni de cambiar la propia clave. Al
 * abrir esa puerta hace falta decidir explícitamente qué se acepta.
 *
 * COSTE 12, el mismo del seed: subirlo invalidaría la comparación con los hashes
 * ya guardados sólo en velocidad, no en corrección, pero mantenerlo alineado
 * evita que convivan dos costes sin que nadie sepa por qué.
 */

import bcrypt from "bcryptjs";

export const COSTE_BCRYPT = 12;

export const LONGITUD_MINIMA = 10;
/**
 * Tope alto pero presente. bcrypt ignora todo lo que pase de 72 BYTES, así que
 * una contraseña más larga da una falsa sensación de fuerza: los caracteres
 * sobrantes no participan en el hash. Se corta antes para que lo que el usuario
 * escribe sea lo que protege su cuenta.
 */
export const LONGITUD_MAXIMA = 72;

/** Las que aparecen primero en cualquier diccionario de ataque en español. */
const PROHIBIDAS = new Set([
  "contrasena", "contraseña", "password", "passw0rd", "admin1234", "12345678",
  "123456789", "1234567890", "qwerty123", "administrador", "nominahn", "honduras",
  "bienvenido", "cambiame", "temporal1",
]);

export interface ResultadoPolitica {
  ok: boolean;
  errores: string[];
}

/**
 * Comprueba una contraseña contra la política.
 *
 * Devuelve TODOS los incumplimientos a la vez y no el primero: corregirlos de
 * uno en uno, con un viaje al servidor por intento, es la forma más rápida de
 * que alguien acabe eligiendo lo mínimo que el sistema le deje pasar.
 *
 * `contexto` son datos del propio usuario (correo, nombre). Una contraseña que
 * los contiene no protege de quien ya sabe a quién está atacando.
 */
export function validarPassword(password: string, contexto: string[] = []): ResultadoPolitica {
  const errores: string[] = [];

  if (password.length < LONGITUD_MINIMA) {
    errores.push(`Debe tener al menos ${LONGITUD_MINIMA} caracteres.`);
  }
  if (password.length > LONGITUD_MAXIMA) {
    errores.push(`No puede pasar de ${LONGITUD_MAXIMA} caracteres.`);
  }
  if (!/[a-záéíóúñ]/i.test(password)) errores.push("Debe incluir al menos una letra.");
  if (!/\d/.test(password)) errores.push("Debe incluir al menos un número.");
  if (!/[^A-Za-z0-9]/.test(password)) errores.push("Debe incluir al menos un símbolo.");

  const plana = password
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  for (const prohibida of PROHIBIDAS) {
    if (plana.includes(prohibida)) {
      errores.push("Es una contraseña demasiado común. Elija otra.");
      break;
    }
  }

  // Sólo se comparan los fragmentos con sustancia: el "hn" de un correo
  // corporativo aparecería en casi cualquier contraseña.
  for (const dato of contexto) {
    for (const fragmento of dato.toLowerCase().split(/[@.\s_-]+/)) {
      if (fragmento.length >= 4 && plana.includes(fragmento)) {
        errores.push("No puede contener su nombre ni su correo.");
        return { ok: false, errores: [...new Set(errores)] };
      }
    }
  }

  return { ok: errores.length === 0, errores: [...new Set(errores)] };
}

export function hashear(password: string): Promise<string> {
  return bcrypt.hash(password, COSTE_BCRYPT);
}

export function comparar(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Contraseña temporal para una cuenta nueva o un restablecimiento.
 *
 * Se genera con `crypto.getRandomValues` y NO con `Math.random`, que es
 * predecible: quien observe una salida puede derivar las siguientes, y aquí cada
 * salida es la llave de una cuenta.
 *
 * El alfabeto excluye los caracteres que se confunden al dictarla por teléfono
 * —O/0, l/I/1— porque estas claves se transmiten de viva voz más de lo que a
 * nadie le gustaría admitir.
 */
export function generarPasswordTemporal(longitud = 14): string {
  const LETRAS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const DIGITOS = "23456789";
  const SIMBOLOS = "!@#$%*+-=?";
  const ALFABETO = LETRAS + DIGITOS + SIMBOLOS;

  const tomar = (fuente: string, n: number) => {
    const bytes = new Uint32Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => fuente[b % fuente.length]);
  };

  // Se siembra una de cada clase para que la temporal cumpla siempre la política
  // y el usuario no reciba una clave que el propio sistema rechazaría.
  const caracteres = [
    ...tomar(LETRAS, 1),
    ...tomar(DIGITOS, 1),
    ...tomar(SIMBOLOS, 1),
    ...tomar(ALFABETO, Math.max(1, longitud - 3)),
  ];

  // Barajado Fisher-Yates con la misma fuente aleatoria: sin él, las tres
  // primeras posiciones tendrían siempre la misma clase de carácter.
  const orden = new Uint32Array(caracteres.length);
  crypto.getRandomValues(orden);
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = orden[i] % (i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }

  return caracteres.join("");
}
