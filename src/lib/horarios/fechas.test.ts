import { describe, it, expect } from "vitest";
import { enumerar, periodoTexto } from "./fechas";

describe("textos de fechas", () => {
  it("escribe el período sin repetir mes ni año", () => {
    expect(periodoTexto("2026-11-02", "2026-11-29")).toBe("2 al 29 de noviembre de 2026");
    expect(periodoTexto("2026-10-26", "2026-11-22")).toBe("26 de octubre al 22 de noviembre de 2026");
    expect(periodoTexto("2026-12-28", "2027-01-24")).toBe("28 de diciembre de 2026 al 24 de enero de 2027");
  });

  it("enumera con «y» antes del último", () => {
    expect(enumerar(["Choloma"])).toBe("Choloma");
    expect(enumerar(["San Pedro Sula", "Choloma"])).toBe("San Pedro Sula y Choloma");
    expect(enumerar(["A", "B", "C"])).toBe("A, B y C");
  });
});
