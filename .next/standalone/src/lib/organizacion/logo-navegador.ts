/**
 * Prepara en el navegador el logo que se va a guardar: lo decodifica, recorta el
 * margen vacío, lo reduce y lo convierte a PNG. Ver `logo.ts`.
 */

import { ajustarACaja, areaConDibujo, LOGO_MAX_ALTO, LOGO_MAX_ANCHO, LOGO_MAX_BYTES, LOGO_ORIGEN_MAX_BYTES, LOGO_ORIGEN_TIPOS } from "./logo";

export interface LogoPreparado {
  png: Blob;
  ancho: number;
  alto: number;
}

/** Tope para analizar la imagen: una foto de cámara ocuparía cientos de MB en memoria. */
const LADO_MAX_ANALISIS = 2400;
const INTENTOS_DE_PESO = 5;

function aPng(lienzo: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo preparar la imagen."))), "image/png");
  });
}

export async function prepararLogo(archivo: File): Promise<LogoPreparado> {
  if (!(LOGO_ORIGEN_TIPOS as readonly string[]).includes(archivo.type)) {
    throw new Error("Use una imagen PNG, JPG o WebP.");
  }
  if (archivo.size > LOGO_ORIGEN_MAX_BYTES) {
    throw new Error("La imagen pesa más de 10 MB. Use una versión más liviana del logo.");
  }

  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error("No se pudo leer la imagen. Puede estar dañada: pruebe con otro archivo.");
  }

  const base = ajustarACaja(imagen.width, imagen.height, LADO_MAX_ANALISIS, LADO_MAX_ANALISIS);
  const original = document.createElement("canvas");
  original.width = base.ancho;
  original.height = base.alto;
  const contexto = original.getContext("2d", { willReadFrequently: true });
  if (!contexto) throw new Error("Este navegador no puede preparar la imagen.");
  contexto.drawImage(imagen, 0, 0, base.ancho, base.alto);
  imagen.close();

  const area = areaConDibujo(contexto.getImageData(0, 0, base.ancho, base.alto).data, base.ancho, base.alto);
  if (!area) {
    throw new Error("La imagen está en blanco o es de color blanco: no se vería sobre el papel. Use una versión del logo en color o en negro.");
  }

  let medida = ajustarACaja(area.ancho, area.alto, LOGO_MAX_ANCHO, LOGO_MAX_ALTO);
  // Un logo plano pesa decenas de KB; uno con foto o degradado puede pasarse del tope.
  for (let intento = 0; intento < INTENTOS_DE_PESO; intento++) {
    const salida = document.createElement("canvas");
    salida.width = medida.ancho;
    salida.height = medida.alto;
    const dibujo = salida.getContext("2d");
    if (!dibujo) throw new Error("Este navegador no puede preparar la imagen.");
    dibujo.imageSmoothingQuality = "high";
    dibujo.drawImage(original, area.x, area.y, area.ancho, area.alto, 0, 0, medida.ancho, medida.alto);
    const png = await aPng(salida);
    if (png.size <= LOGO_MAX_BYTES) return { png, ancho: medida.ancho, alto: medida.alto };
    medida = ajustarACaja(medida.ancho, medida.alto, Math.round(medida.ancho * 0.75), Math.round(medida.alto * 0.75));
  }
  throw new Error("Este logo tiene demasiado detalle para guardarlo. Use una versión más sencilla, sin fotografías.");
}
