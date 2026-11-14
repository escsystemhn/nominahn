/**
 * Reglas del logo de una sucursal. Sin dependencias de navegador ni de servidor:
 * las usan la pantalla que lo prepara, la ruta que lo guarda y las pruebas.
 *
 * El navegador lo normaliza antes de enviarlo (`logo-navegador.ts`): recorta el
 * margen vacío, lo reduce y lo convierte a PNG. Así el servidor no decodifica
 * imágenes ajenas con código nativo, y sólo comprueba que recibió lo acordado.
 *
 * Por qué siempre PNG: conserva la transparencia, y es de los pocos formatos que
 * entienden a la vez los clientes de correo y el generador de PDF. Y por qué el
 * tope de peso: el logo viaja dentro de cada comprobante enviado por correo.
 */

export const LOGO_MAX_ANCHO = 720;
export const LOGO_MAX_ALTO = 240;
export const LOGO_MAX_BYTES = 300 * 1024;

/** Lo que la pantalla acepta como imagen de partida, antes de reducirla. */
export const LOGO_ORIGEN_MAX_BYTES = 10 * 1024 * 1024;
export const LOGO_ORIGEN_TIPOS = ["image/png", "image/jpeg", "image/webp"] as const;

/** Espacio que ocupa el logo en el membrete de un comprobante o documento. */
export const LOGO_CAJA_ANCHO = 220;
export const LOGO_CAJA_ALTO = 64;

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LARGO_IHDR = 13;
/** Firma + encabezado IHDR completo + cierre IEND. */
const LARGO_MINIMO = FIRMA_PNG.length + (4 + 4 + LARGO_IHDR + 4) + 12;

export type RevisionPng = { ok: true; ancho: number; alto: number } | { ok: false; error: string };

const contiene = (b: Uint8Array, pos: number, texto: string) => [...texto].every((c, i) => b[pos + i] === c.charCodeAt(0));
const entero32 = (b: Uint8Array, pos: number) => ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;

/**
 * Comprueba que los bytes son el PNG que produce la pantalla. Quien llame a la
 * API directamente no debe poder guardar otra cosa: el archivo acaba incrustado
 * en documentos que abren otras personas.
 *
 * Exige 8 bits y sin entrelazar porque el generador de PDF no admite lo demás,
 * y fallaría al emitir el comprobante de cualquier empleado de la sucursal.
 */
export function revisarPngDeLogo(b: Uint8Array): RevisionPng {
  const invalido: RevisionPng = { ok: false, error: "El archivo no es una imagen PNG válida." };
  if (b.length < LARGO_MINIMO) return invalido;
  if (b.length > LOGO_MAX_BYTES) return { ok: false, error: `El logo no puede pesar más de ${Math.round(LOGO_MAX_BYTES / 1024)} KB.` };
  if (!FIRMA_PNG.every((v, i) => b[i] === v)) return invalido;
  if (entero32(b, 8) !== LARGO_IHDR || !contiene(b, 12, "IHDR")) return invalido;
  if (!contiene(b, b.length - 8, "IEND")) return invalido;

  const ancho = entero32(b, 16);
  const alto = entero32(b, 20);
  if (ancho < 1 || alto < 1) return invalido;
  if (ancho > LOGO_MAX_ANCHO || alto > LOGO_MAX_ALTO) {
    return { ok: false, error: `El logo no puede medir más de ${LOGO_MAX_ANCHO} × ${LOGO_MAX_ALTO} píxeles.` };
  }
  const profundidad = b[24];
  const entrelazado = b[28];
  if (profundidad !== 8 || entrelazado !== 0) return { ok: false, error: "El PNG debe ser de 8 bits y sin entrelazar." };
  return { ok: true, ancho, alto };
}

/** Medidas para que quepa en la caja sin deformarse. Nunca agranda: se vería borroso. */
export function ajustarACaja(ancho: number, alto: number, maxAncho: number, maxAlto: number): { ancho: number; alto: number } {
  const escala = Math.min(1, maxAncho / ancho, maxAlto / alto);
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Transparente o casi blanco: no se distingue del papel. */
function pixelVacio(rgba: ArrayLike<number>, i: number): boolean {
  return rgba[i + 3] < 16 || (rgba[i] >= 245 && rgba[i + 1] >= 245 && rgba[i + 2] >= 245);
}

/**
 * El rectángulo que de verdad tiene dibujo. Muchos logos llegan con márgenes
 * enormes, y al ajustarlos a la altura del membrete quedaban diminutos y sin
 * alinear con el texto. `null`: la imagen no se vería sobre papel blanco.
 */
export function areaConDibujo(rgba: ArrayLike<number>, ancho: number, alto: number): { x: number; y: number; ancho: number; alto: number } | null {
  let minX = ancho, minY = alto, maxX = -1, maxY = -1;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (pixelVacio(rgba, (y * ancho + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, ancho: maxX - minX + 1, alto: maxY - minY + 1 };
}

/** Menor que el espacio del membrete: se agrandaría en papel y saldría borroso. */
export function logoEsPequeno(ancho: number, alto: number): boolean {
  return ancho < LOGO_CAJA_ANCHO && alto < LOGO_CAJA_ALTO;
}
