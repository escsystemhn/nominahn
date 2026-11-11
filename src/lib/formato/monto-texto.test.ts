import { describe, it, expect } from "vitest";
import { leerMonto } from "@/lib/formato/monto-texto";

const valor = (t: string) => {
  const r = leerMonto(t);
  return r.ok ? r.valor : `error: ${r.error}`;
};

describe("leerMonto — montos escritos a mano", () => {
  it("punto decimal, como en Honduras", () => {
    expect(valor("297.58")).toBe(297.58);
    expect(valor("595.16")).toBe(595.16);
    expect(valor("0")).toBe(0);
  });
  it("REGRESIÓN: la coma decimal no se pierde (antes «297,58» quedaba vacío o en 29,758)", () => {
    expect(valor("297,58")).toBe(297.58);
    expect(valor("297,5")).toBe(297.5);
  });
  it("separadores de miles", () => {
    expect(valor("1,011.77")).toBe(1011.77);
    expect(valor("1.011,77")).toBe(1011.77);
    expect(valor("1,011")).toBe(1011);
    expect(valor("11,903.13")).toBe(11903.13);
  });
  it("ignora «L», «L.», «HNL» y espacios", () => {
    expect(valor("L 297.58")).toBe(297.58);
    expect(valor("L. 1,011.77")).toBe(1011.77);
    expect(valor(" HNL 595.16 ")).toBe(595.16);
  });
  it("vacío es «sin valor», no cero", () => {
    expect(valor("")).toBeNull();
    expect(valor("   ")).toBeNull();
  });
  it("rechaza con mensaje lo que no entiende o trae más de dos decimales", () => {
    expect(valor("abc")).toMatch(/^error/);
    expect(valor("-5")).toMatch(/^error/);
    expect(valor("297.585")).toBe("error: máximo 2 decimales");
    expect(leerMonto("2.555", { decimales: 3 })).toEqual({ ok: true, valor: 2.555 });
  });
});
