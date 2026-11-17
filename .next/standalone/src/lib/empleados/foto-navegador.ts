/**
 * Prepara en el navegador la foto que se va a guardar: recorta el cuadrado elegido, lo
 * reduce a `FOTO_LADO` px y lo convierte a JPEG. Pasar por el lienzo también descarta los
 * metadatos del archivo original (el servidor igual los vuelve a quitar). Ver `foto.ts`.
 */

import { FOTO_LADO, FOTO_MAX_BYTES, FOTO_ORIGEN_MAX_BYTES, FOTO_ORIGEN_TIPOS, type Recorte } from "./foto";

/** Abre un archivo como imagen, con su orientación EXIF ya aplicada. */
export async function abrirImagen(archivo: File): Promise<ImageBitmap> {
  if (!(FOTO_ORIGEN_TIPOS as readonly string[]).includes(archivo.type)) {
    throw new Error("Use una imagen JPG, PNG o WebP. Las fotos HEIC del iPhone se pueden tomar con la cámara desde aquí.");
  }
  if (archivo.size > FOTO_ORIGEN_MAX_BYTES) throw new Error("La imagen pesa más de 15 MB.");
  try {
    return await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la imagen. Puede estar dañada: pruebe con otra.");
  }
}

function aJpeg(lienzo: HTMLCanvasElement, calidad: number): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo preparar la foto."))), "image/jpeg", calidad);
  });
}

/** Recorta, reduce y comprime. Si pasa del límite, baja la calidad hasta que quepa. */
export async function prepararFoto(origen: CanvasImageSource, recorte: Recorte): Promise<Blob> {
  const lienzo = document.createElement("canvas");
  lienzo.width = FOTO_LADO;
  lienzo.height = FOTO_LADO;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede preparar la foto.");
  ctx.imageSmoothingQuality = "high";
  // Sin espejo: la vista previa de la cámara frontal se ve como en un espejo, pero la foto
  // se guarda como la vería otra persona (un carné con el texto al derecho).
  ctx.drawImage(origen, recorte.x, recorte.y, recorte.lado, recorte.lado, 0, 0, FOTO_LADO, FOTO_LADO);
  for (const calidad of [0.86, 0.78, 0.68, 0.58]) {
    const b = await aJpeg(lienzo, calidad);
    if (b.size <= FOTO_MAX_BYTES) return b;
  }
  throw new Error("La foto quedó demasiado pesada. Pruebe con otra imagen.");
}
