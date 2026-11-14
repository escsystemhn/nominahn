import { describe, expect, it } from "vitest";
import { anioDecimoEnCurso, repartirAnticipos } from "./anticipos";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("repartirAnticipos", () => {
  it("rebaja todo cuando cabe", () => {
    const r = repartirAnticipos([{ id: "a", monto: 5000, fechaPago: d("2026-01-15") }], 20000);
    expect(r.aplicado.toFixed(2)).toBe("5000.00");
    expect(r.exceso.toFixed(2)).toBe("0.00");
    expect(r.partes.map((p) => [p.id, p.monto.toFixed(2)])).toEqual([["a", "5000.00"]]);
  });

  it("nunca pasa del disponible: el exceso se informa", () => {
    const r = repartirAnticipos([{ id: "a", monto: "30000", fechaPago: d("2025-12-01") }], 18000.5);
    expect(r.aplicado.toFixed(2)).toBe("18000.50");
    expect(r.exceso.toFixed(2)).toBe("11999.50");
  });

  it("toma primero el más antiguo", () => {
    const r = repartirAnticipos(
      [
        { id: "nuevo", monto: 4000, fechaPago: d("2026-06-01") },
        { id: "viejo", monto: 3000, fechaPago: d("2025-06-01") },
      ],
      5000
    );
    expect(r.partes.map((p) => [p.id, p.monto.toFixed(2)])).toEqual([["viejo", "3000.00"], ["nuevo", "2000.00"]]);
    expect(r.exceso.toFixed(2)).toBe("2000.00");
  });

  it("sin disponible (la causa no da cesantía) no rebaja nada", () => {
    const r = repartirAnticipos([{ id: "a", monto: 1000, fechaPago: d("2026-01-01") }], 0);
    expect(r.aplicado.toFixed(2)).toBe("0.00");
    expect(r.partes).toEqual([]);
    expect(r.exceso.toFixed(2)).toBe("1000.00");
  });

  it("ignora montos no positivos", () => {
    const r = repartirAnticipos([{ id: "a", monto: 0, fechaPago: d("2026-01-01") }, { id: "b", monto: -5, fechaPago: d("2026-01-02") }], 100);
    expect(r.aplicado.toFixed(2)).toBe("0.00");
    expect(r.exceso.toFixed(2)).toBe("0.00");
  });
});

describe("anioDecimoEnCurso", () => {
  it("13.º: el año natural", () => {
    expect(anioDecimoEnCurso("DECIMO_TERCERO", d("2026-10-15"))).toBe(2026);
    expect(anioDecimoEnCurso("DECIMO_TERCERO", d("2026-01-01"))).toBe(2026);
  });

  it("14.º: hasta junio es el de ese año; desde julio, el del siguiente", () => {
    expect(anioDecimoEnCurso("DECIMO_CUARTO", d("2026-06-30"))).toBe(2026);
    expect(anioDecimoEnCurso("DECIMO_CUARTO", d("2026-07-01"))).toBe(2027);
    expect(anioDecimoEnCurso("DECIMO_CUARTO", d("2026-10-15"))).toBe(2027);
  });
});
