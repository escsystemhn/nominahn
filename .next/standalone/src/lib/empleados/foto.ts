/**
 * Foto del empleado: reglas compartidas por la pantalla y el servidor. PURO.
 *
 * El navegador recorta la imagen en un cuadrado, la reduce a `FOTO_LADO` px y la convierte
 * a JPEG (`foto-navegador.ts`). El servidor no confía en eso: revisa que sea un JPEG
 * cuadrado de tamaño razonable y le QUITA los metadatos (bloques APP1…APP15 y comentarios:
 * EXIF con la ubicación GPS, la marca del teléfono, XMP) antes de guardarlo.
 */

/** Lado de la foto guardada. 512 px se ven nítidos en la ficha y pesan ~40–80 KB. */
export const FOTO_LADO = 512;
export const FOTO_LADO_MIN = 128;
export const FOTO_LADO_MAX = 1024;
/** Lo que acepta el servidor. */
export const FOTO_MAX_BYTES = 400 * 1024;
/** Lo que acepta la pantalla antes de reducirla (una foto de teléfono pesa 3–8 MB). */
export const FOTO_ORIGEN_MAX_BYTES = 15 * 1024 * 1024;
export const FOTO_ORIGEN_TIPOS = ["image/jpeg", "image/png", "image/webp"] as const;

/** URL de la foto con su versión: al cambiarla, el navegador no muestra la vieja de su caché. */
export const urlFoto = (empleadoId: string, version: Date | number | null | undefined) =>
  `/api/empleados/${empleadoId}/foto?v=${version instanceof Date ? version.getTime() : (version ?? 0)}`;

export interface Recorte {
  x: number;
  y: number;
  lado: number;
}

/**
 * El cuadrado de la imagen original que se queda. Con zoom 1 es el cuadrado más grande que
 * cabe, centrado; con más zoom, uno más chico. `dx`/`dy` (−1 a 1) lo mueven dentro de la
 * imagen sin salirse.
 */
export function recorteCuadrado(ancho: number, alto: number, zoom = 1, dx = 0, dy = 0): Recorte {
  const lado = Math.min(ancho, alto) / Math.max(1, zoom);
  const libreX = ancho - lado;
  const libreY = alto - lado;
  const lim = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    x: Math.round((libreX / 2) * (1 + lim(dx))),
    y: Math.round((libreY / 2) * (1 + lim(dy))),
    lado: Math.round(lado),
  };
}

// ─── JPEG ────────────────────────────────────────────────────────────────────────

const esSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** Ancho y alto de un JPEG leyendo sus marcadores, o `null` si no lo es. */
export function dimensionesJpeg(b: Uint8Array): { ancho: number; alto: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9 || m === 0xda) return null; // fin o datos sin SOF antes: no es una imagen válida
    const largo = (b[i + 2] << 8) | b[i + 3];
    if (largo < 2 || i + 2 + largo > b.length) return null;
    if (esSof(m)) {
      if (largo < 7) return null;
      return { alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + largo;
  }
  return null;
}

/**
 * El mismo JPEG sin metadatos: se quitan APP1…APP15 (EXIF, XMP, ICC de cámaras) y COM. El
 * APP0 (JFIF) y todo lo demás se copian tal cual. Los datos de la imagen no se tocan.
 */
export function limpiarJpeg(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error("No es un JPEG.");
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) throw new Error("JPEG dañado.");
    const m = b[i + 1];
    if (m === 0xda) { partes.push(b.subarray(i)); i = b.length; break; } // desde el SOS, la imagen tal cual
    const largo = (b[i + 2] << 8) | b[i + 3];
    if (largo < 2 || i + 2 + largo > b.length) throw new Error("JPEG dañado.");
    const metadato = (m >= 0xe1 && m <= 0xef) || m === 0xfe;
    if (!metadato) partes.push(b.subarray(i, i + 2 + largo));
    i += 2 + largo;
  }
  const salida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) { salida.set(p, o); o += p.length; }
  return salida;
}

/** Revisión del servidor: JPEG, cuadrado, de tamaño razonable. Devuelve el lado o el motivo. */
export function revisarJpegDeFoto(b: Uint8Array): { ok: true; lado: number } | { ok: false; error: string } {
  if (b.length === 0) return { ok: false, error: "No llegó ninguna imagen." };
  if (b.length > FOTO_MAX_BYTES) return { ok: false, error: `La foto no puede pesar más de ${Math.round(FOTO_MAX_BYTES / 1024)} KB.` };
  const d = dimensionesJpeg(b);
  if (!d) return { ok: false, error: "La foto debe ser un JPEG preparado por la pantalla." };
  if (d.ancho !== d.alto) return { ok: false, error: "La foto debe ser cuadrada." };
  if (d.ancho < FOTO_LADO_MIN || d.ancho > FOTO_LADO_MAX) return { ok: false, error: `La foto debe medir entre ${FOTO_LADO_MIN} y ${FOTO_LADO_MAX} px de lado.` };
  return { ok: true, lado: d.ancho };
}
