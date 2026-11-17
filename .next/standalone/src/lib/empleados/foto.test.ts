import { describe, expect, it } from "vitest";
import { dimensionesJpeg, FOTO_MAX_BYTES, limpiarJpeg, recorteCuadrado, revisarJpegDeFoto, urlFoto } from "./foto";

/** Un segmento JPEG: marcador + largo (incluye los 2 bytes del largo) + datos. */
const segmento = (marcador: number, datos: number[]) => [0xff, marcador, ((datos.length + 2) >> 8) & 0xff, (datos.length + 2) & 0xff, ...datos];
const texto = (s: string) => [...s].map((c) => c.charCodeAt(0));
const sof = (ancho: number, alto: number) => segmento(0xc0, [8, alto >> 8, alto & 0xff, ancho >> 8, ancho & 0xff, 1, 1, 0x11, 0]);
const ESCANEO = [...segmento(0xda, [1, 1, 0, 0, 0x3f, 0]), 0x12, 0x34, 0x56, 0xff, 0xd9];

/** JPEG mínimo con JFIF, EXIF (con «GPS»), comentario, SOF y datos. */
function jpeg(ancho = 512, alto = 512, conMetadatos = true): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    ...segmento(0xe0, texto("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    ...(conMetadatos ? [...segmento(0xe1, texto("Exif\0\0GPS 15.5,-88.0")), ...segmento(0xfe, texto("iPhone de Ana"))] : []),
    ...sof(ancho, alto),
    ...ESCANEO,
  ]);
}

describe("recorte cuadrado", () => {
  it("zoom 1: el cuadrado más grande, centrado", () => {
    expect(recorteCuadrado(1280, 960)).toEqual({ x: 160, y: 0, lado: 960 });
    expect(recorteCuadrado(600, 800)).toEqual({ x: 0, y: 100, lado: 600 });
  });

  it("con zoom se achica y se mueve sin salirse de la imagen", () => {
    expect(recorteCuadrado(1000, 1000, 2)).toEqual({ x: 250, y: 250, lado: 500 });
    expect(recorteCuadrado(1000, 1000, 2, -1, 1)).toEqual({ x: 0, y: 500, lado: 500 });
    expect(recorteCuadrado(1000, 1000, 2, -5, 5)).toEqual({ x: 0, y: 500, lado: 500 }); // se limita a −1…1
  });
});

describe("JPEG del servidor", () => {
  it("lee ancho y alto del SOF; rechaza lo que no es JPEG", () => {
    expect(dimensionesJpeg(jpeg(512, 384))).toEqual({ ancho: 512, alto: 384 });
    expect(dimensionesJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(dimensionesJpeg(new Uint8Array([0xff, 0xd8, ...ESCANEO]))).toBeNull(); // sin SOF
  });

  it("quita EXIF y comentarios, deja JFIF y la imagen intacta", () => {
    const original = jpeg();
    const limpio = limpiarJpeg(original);
    const comoTexto = (b: Uint8Array) => String.fromCharCode(...b);
    expect(comoTexto(original)).toContain("GPS");
    expect(comoTexto(limpio)).not.toContain("GPS");
    expect(comoTexto(limpio)).not.toContain("iPhone");
    expect(comoTexto(limpio)).toContain("JFIF");
    expect([...limpio]).toEqual([...jpeg(512, 512, false)]);
    expect(dimensionesJpeg(limpio)).toEqual({ ancho: 512, alto: 512 });
  });

  it("un JPEG truncado no se limpia: se rechaza", () => {
    expect(() => limpiarJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]))).toThrow();
    expect(() => limpiarJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it("revisión: cuadrado, entre 128 y 1024 px, hasta el peso máximo", () => {
    expect(revisarJpegDeFoto(jpeg())).toEqual({ ok: true, lado: 512 });
    expect(revisarJpegDeFoto(jpeg(512, 384))).toMatchObject({ ok: false, error: expect.stringMatching(/cuadrada/) });
    expect(revisarJpegDeFoto(jpeg(64, 64))).toMatchObject({ ok: false });
    expect(revisarJpegDeFoto(jpeg(2048, 2048))).toMatchObject({ ok: false });
    expect(revisarJpegDeFoto(new Uint8Array(FOTO_MAX_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/KB/) });
    expect(revisarJpegDeFoto(new Uint8Array(0))).toMatchObject({ ok: false });
  });

  it("la URL lleva la versión para no mostrar una foto vieja de la caché", () => {
    expect(urlFoto("e1", new Date(1000))).toBe("/api/empleados/e1/foto?v=1000");
    expect(urlFoto("e1", null)).toBe("/api/empleados/e1/foto?v=0");
  });
});
