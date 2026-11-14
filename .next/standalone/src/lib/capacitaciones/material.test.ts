import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enlaceValido, firmarEnlace, formatoPorFirma, leerRange, rutaMaterial, textoMarca, VIDA_ENLACE_MS } from "./material";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe("formatoPorFirma", () => {
  it("reconoce PDF, MP4, WebM, PNG y JPG por sus primeros bytes", () => {
    expect(formatoPorFirma(bytes("%PDF-1.7\n"))?.visor).toBe("pdf");
    expect(formatoPorFirma(bytes(0, 0, 0, 0x20, "ftypisom", 0, 0))?.ext).toBe(".mp4");
    expect(formatoPorFirma(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f))?.mime).toBe("video/webm");
    expect(formatoPorFirma(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))?.ext).toBe(".png");
    expect(formatoPorFirma(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe(".jpg");
  });
  it("rechaza lo demás aunque se llame .pdf (un ejecutable, un Word)", () => {
    expect(formatoPorFirma(bytes("MZ", 0x90, 0))).toBeNull();
    expect(formatoPorFirma(bytes("PK", 3, 4, 20, 0))).toBeNull(); // .docx es un zip
    expect(formatoPorFirma(bytes("<html>"))).toBeNull();
  });
});

describe("enlace firmado", () => {
  const anterior = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = "secreto-de-prueba";
  });
  afterAll(() => {
    process.env.AUTH_SECRET = anterior;
  });

  it("vale para ese material y ese usuario, mientras no venza", () => {
    const t = firmarEnlace("m1", "u1", 1_000);
    expect(enlaceValido(t, "m1", "u1", 1_000 + VIDA_ENLACE_MS - 1)).toBe(true);
    expect(enlaceValido(t, "m1", "u1", 1_000 + VIDA_ENLACE_MS + 1)).toBe(false);
    expect(enlaceValido(t, "m2", "u1", 2_000)).toBe(false);
    expect(enlaceValido(t, "m1", "u2", 2_000)).toBe(false);
  });
  it("no se puede alargar cambiando la fecha", () => {
    const t = firmarEnlace("m1", "u1", 1_000);
    const [, f] = t.split(".");
    expect(enlaceValido(`${9_999_999_999_999}.${f}`, "m1", "u1", 2_000)).toBe(false);
    expect(enlaceValido(null, "m1", "u1")).toBe(false);
    expect(enlaceValido("basura", "m1", "u1")).toBe(false);
  });
});

describe("leerRange", () => {
  it("tramos normales, abiertos y del final", () => {
    expect(leerRange("bytes=0-99", 1000)).toEqual({ inicio: 0, fin: 99 });
    expect(leerRange("bytes=500-", 1000)).toEqual({ inicio: 500, fin: 999 });
    expect(leerRange("bytes=-100", 1000)).toEqual({ inicio: 900, fin: 999 });
    expect(leerRange("bytes=900-5000", 1000)).toEqual({ inicio: 900, fin: 999 });
  });
  it("sin Range, todo; fuera de rango o raro, 416", () => {
    expect(leerRange(null, 1000)).toBeNull();
    expect(leerRange("bytes=1000-", 1000)).toBe("invalido");
    expect(leerRange("bytes=5-2", 1000)).toBe("invalido");
    expect(leerRange("bytes=0-1,5-9", 1000)).toBe("invalido");
    expect(leerRange("items=0-1", 1000)).toBe("invalido");
  });
});

describe("rutaMaterial", () => {
  it("sólo nombres UUID con extensión permitida", () => {
    expect(rutaMaterial("123e4567-e89b-42d3-a456-426614174000.pdf")).toMatch(/capacitaciones[\\/]123e4567/);
    expect(() => rutaMaterial("../../.env")).toThrow();
    expect(() => rutaMaterial("123e4567-e89b-42d3-a456-426614174000.exe")).toThrow();
  });
});

describe("textoMarca", () => {
  it("nombre, DNI con guiones y fecha de Honduras", () => {
    expect(textoMarca("Ana Núñez", "0801199012345", new Date("2026-11-14T18:00:00Z"))).toBe("Ana Núñez · DNI 0801-1990-12345 · 14/11/2026");
    expect(textoMarca("Ana Núñez", null, new Date("2026-11-15T03:00:00Z"))).toBe("Ana Núñez · 14/11/2026");
  });
});
