import { describe, it, expect } from "vitest";
import { ajustarACaja, areaConDibujo, logoEsPequeno, revisarPngDeLogo, LOGO_MAX_ALTO, LOGO_MAX_ANCHO, LOGO_MAX_BYTES } from "./logo";

/** Encabezado de un PNG con las medidas pedidas. Sólo se revisa la estructura, no el dibujo. */
function png({ ancho = 100, alto = 40, profundidad = 8, entrelazado = 0, relleno = 0, cierre = "IEND", nombre = "IHDR" } = {}): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const txt = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), ...txt(nombre), ...u32(ancho), ...u32(alto), profundidad, 6, 0, 0, entrelazado, 0, 0, 0, 0,
    ...new Array(relleno).fill(0),
    ...u32(0), ...txt(cierre), 0xae, 0x42, 0x60, 0x82,
  ]);
}

describe("revisarPngDeLogo", () => {
  it("acepta el PNG que produce la pantalla y lee sus medidas", () => {
    expect(revisarPngDeLogo(png({ ancho: 300, alto: 120 }))).toEqual({ ok: true, ancho: 300, alto: 120 });
  });

  it.each([
    ["vacío", new Uint8Array()],
    ["un JPG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)])],
    ["un HTML con extensión de imagen", new TextEncoder().encode("<script>alert(1)</script>".padEnd(80, " "))],
    ["un PNG truncado", png().slice(0, 40)],
    ["un PNG sin cierre", png({ cierre: "XXXX" })],
    ["otro bloque en vez del encabezado", png({ nombre: "tEXt" })],
    ["medidas en cero", png({ ancho: 0 })],
  ])("rechaza %s", (_, bytes) => {
    expect(revisarPngDeLogo(bytes).ok).toBe(false);
  });

  it("rechaza lo que el generador de PDF no sabe leer", () => {
    expect(revisarPngDeLogo(png({ entrelazado: 1 })).ok).toBe(false);
    expect(revisarPngDeLogo(png({ profundidad: 16 })).ok).toBe(false);
  });

  it("pone tope a las medidas y al peso, en el límite exacto", () => {
    expect(revisarPngDeLogo(png({ ancho: LOGO_MAX_ANCHO, alto: LOGO_MAX_ALTO })).ok).toBe(true);
    expect(revisarPngDeLogo(png({ ancho: LOGO_MAX_ANCHO + 1 })).ok).toBe(false);
    expect(revisarPngDeLogo(png({ alto: LOGO_MAX_ALTO + 1 })).ok).toBe(false);
    const base = png().length;
    expect(revisarPngDeLogo(png({ relleno: LOGO_MAX_BYTES - base })).ok).toBe(true);
    expect(revisarPngDeLogo(png({ relleno: LOGO_MAX_BYTES - base + 1 })).ok).toBe(false);
  });

  it("lee medidas grandes sin volverlas negativas", () => {
    expect(revisarPngDeLogo(png({ ancho: 0xffffffff })).ok).toBe(false);
  });
});

describe("ajustarACaja", () => {
  it("reduce sin deformar, y manda el lado que más se pasa", () => {
    expect(ajustarACaja(1000, 500, 200, 200)).toEqual({ ancho: 200, alto: 100 });
    expect(ajustarACaja(500, 1000, 200, 200)).toEqual({ ancho: 100, alto: 200 });
    expect(ajustarACaja(2000, 100, 220, 64)).toEqual({ ancho: 220, alto: 11 });
  });

  it("nunca agranda", () => {
    expect(ajustarACaja(50, 20, 220, 64)).toEqual({ ancho: 50, alto: 20 });
  });

  it("no deja una medida en cero", () => {
    expect(ajustarACaja(5000, 1, 200, 200)).toEqual({ ancho: 200, alto: 1 });
  });
});

describe("areaConDibujo", () => {
  /** Lienzo de 6 × 4 con la pintura en las posiciones indicadas. */
  function lienzo(fondo: [number, number, number, number], pintados: Array<[number, number]>, tinta: [number, number, number, number] = [10, 40, 60, 255]) {
    const datos: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) datos.push(...(pintados.some(([a, b]) => a === x && b === y) ? tinta : fondo));
    return datos;
  }

  it("quita un margen transparente", () => {
    expect(areaConDibujo(lienzo([0, 0, 0, 0], [[2, 1], [3, 2]]), 6, 4)).toEqual({ x: 2, y: 1, ancho: 2, alto: 2 });
  });

  it("quita un margen blanco, el de un JPG o una captura", () => {
    expect(areaConDibujo(lienzo([255, 255, 255, 255], [[1, 1]]), 6, 4)).toEqual({ x: 1, y: 1, ancho: 1, alto: 1 });
  });

  it("también el casi blanco, que deja el JPG alrededor del dibujo", () => {
    expect(areaConDibujo(lienzo([250, 251, 249, 255], [[4, 3]]), 6, 4)).toEqual({ x: 4, y: 3, ancho: 1, alto: 1 });
  });

  it("deja entero el logo sin margen", () => {
    expect(areaConDibujo(lienzo([200, 30, 30, 255], []), 6, 4)).toEqual({ x: 0, y: 0, ancho: 6, alto: 4 });
  });

  it("un logo blanco sobre transparente no se vería en papel", () => {
    expect(areaConDibujo(lienzo([0, 0, 0, 0], [[2, 2]], [255, 255, 255, 255]), 6, 4)).toBeNull();
  });

  it("una imagen en blanco no se vería", () => {
    expect(areaConDibujo(lienzo([255, 255, 255, 255], []), 6, 4)).toBeNull();
  });
});

describe("logoEsPequeno", () => {
  it("avisa sólo si no llena el espacio en ninguna dirección", () => {
    expect(logoEsPequeno(120, 40)).toBe(true);
    expect(logoEsPequeno(300, 40)).toBe(false);
    expect(logoEsPequeno(120, 90)).toBe(false);
  });
});
