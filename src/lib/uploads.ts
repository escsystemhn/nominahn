/**
 * Almacenamiento de archivos subidos (CVs, documentos de empleado, etc.).
 *
 * SEGURIDAD: los archivos se guardan FUERA de `public/`. Todo lo que cae en
 * `public/` lo sirve Next.js de forma estática, sin pasar por el middleware ni
 * por ninguna comprobación de sesión — es decir, contratos, identidades y CVs
 * quedaban descargables por cualquiera que tuviera (o adivinara) la URL. Aquí el
 * archivo vive en un directorio privado y sólo se entrega a través de
 * `GET /api/uploads/[nombre]`, que exige sesión.
 */

import path from "path";

/** Extensiones aceptadas. Deliberadamente SIN .html ni .svg: ambos ejecutan
 * scripts en el navegador y abrirían un XSS al servirse desde nuestro dominio. */
export const EXT_PERMITIDAS = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp"]);

const MAX_BYTES_DEFAULT = 5 * 1024 * 1024; // 5 MB

/** Límite de tamaño en bytes. Configurable con MAX_FILE_SIZE (bytes). */
export function maxBytes(): number {
  const raw = process.env.MAX_FILE_SIZE;
  if (!raw) return MAX_BYTES_DEFAULT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : MAX_BYTES_DEFAULT;
}

/**
 * Directorio privado donde se guardan los archivos. Configurable con UPLOAD_DIR;
 * por defecto `<raíz>/var/uploads`, que NO está bajo `public/`.
 */
export function directorioUploads(): string {
  const dir = process.env.UPLOAD_DIR?.trim();
  return dir && dir.length > 0 ? path.resolve(dir) : path.join(process.cwd(), "var", "uploads");
}

export function extensionPermitida(ext: string): boolean {
  return EXT_PERMITIDAS.has(ext.toLowerCase());
}

/**
 * Nombre de archivo válido para SERVIR: exactamente un UUID v4 seguido de una
 * extensión permitida. Es el formato que produce la subida (`randomUUID()+ext`).
 *
 * Su única razón de ser es la seguridad: al aceptar sólo este patrón, un
 * parámetro como `../../.env` o `..%2Fconfig` no matchea y se rechaza antes de
 * tocar el disco. Es la defensa contra path traversal en la ruta de descarga.
 */
const RE_NOMBRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|doc|docx|png|jpe?g|webp)$/i;

export function nombreArchivoValido(nombre: string): boolean {
  // `basename` neutraliza cualquier componente de ruta antes de validar el patrón:
  // doble red contra traversal.
  return typeof nombre === "string" && nombre === path.basename(nombre) && RE_NOMBRE.test(nombre);
}

/** MIME con el que se entrega cada extensión al descargar. */
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function tipoContenido(nombre: string): string {
  return MIME[path.extname(nombre).toLowerCase()] ?? "application/octet-stream";
}
