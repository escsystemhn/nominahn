import { describe, it, expect } from "vitest";
import { enteroALetras, montoALetras } from "./numero-letras";

describe("enteroALetras", () => {
  it.each([
    [0, "CERO"],
    [1, "UNO"],
    [15, "QUINCE"],
    [16, "DIECISÉIS"],
    [21, "VEINTIUNO"],
    [22, "VEINTIDÓS"],
    [30, "TREINTA"],
    [31, "TREINTA Y UNO"],
    [100, "CIEN"],
    [101, "CIENTO UNO"],
    [115, "CIENTO QUINCE"],
    [500, "QUINIENTOS"],
    [999, "NOVECIENTOS NOVENTA Y NUEVE"],
    [1000, "MIL"],
    [1001, "MIL UNO"],
    [2026, "DOS MIL VEINTISÉIS"],
    [21000, "VEINTIÚN MIL"],
    [31000, "TREINTA Y UN MIL"],
    [100000, "CIEN MIL"],
    [101000, "CIENTO UN MIL"],
    [1000000, "UN MILLÓN"],
    [2500000, "DOS MILLONES QUINIENTOS MIL"],
    [21000000, "VEINTIÚN MILLONES"],
  ])("%i → %s", (n, letras) => {
    expect(enteroALetras(n)).toBe(letras);
  });

  it("con apócope delante de sustantivo", () => {
    expect(enteroALetras(1, true)).toBe("UN");
    expect(enteroALetras(21, true)).toBe("VEINTIÚN");
    expect(enteroALetras(41, true)).toBe("CUARENTA Y UN");
  });

  it("rechaza negativos y no finitos", () => {
    expect(() => enteroALetras(-1)).toThrow();
    expect(() => enteroALetras(Number.NaN)).toThrow();
  });
});

describe("montoALetras", () => {
  it("lempiras con centavos", () => {
    expect(montoALetras(10500.25)).toBe("DIEZ MIL QUINIENTOS LEMPIRAS CON 25/100");
    expect(montoALetras("13250")).toBe("TRECE MIL DOSCIENTOS CINCUENTA LEMPIRAS CON 00/100");
    expect(montoALetras(1)).toBe("UN LEMPIRA CON 00/100");
    expect(montoALetras(21)).toBe("VEINTIÚN LEMPIRAS CON 00/100");
    expect(montoALetras(0.5)).toBe("CERO LEMPIRAS CON 50/100");
    expect(montoALetras(1000000)).toBe("UN MILLÓN DE LEMPIRAS CON 00/100");
    expect(montoALetras(1250000.1)).toBe("UN MILLÓN DOSCIENTOS CINCUENTA MIL LEMPIRAS CON 10/100");
  });

  it("redondea a centavos sin errores de coma flotante", () => {
    expect(montoALetras(0.29)).toBe("CERO LEMPIRAS CON 29/100");
    expect(montoALetras(1.005)).toMatch(/CON 0[01]\/100$/);
  });
});
