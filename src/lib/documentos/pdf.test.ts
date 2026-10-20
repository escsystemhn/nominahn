import { describe, it, expect } from "vitest";
import { fragmentos, parrafos } from "./pdf";

describe("fragmentos del PDF", () => {
  it("deja el texto sin marcas como está", () => {
    expect(fragmentos("Sin negritas.")).toBe("Sin negritas.");
  });

  it("marca la negrita y deja la puntuación pegada dentro de ella", () => {
    // Al justificar, pdfmake abre espacio entre fragmentos: «R.L. , con».
    expect(fragmentos("De **Comercial S. de R.L.**, con RTN")).toEqual([
      { text: "De " },
      { text: "Comercial S. de R.L.,", bold: true },
      { text: " con RTN" },
    ]);
    expect(fragmentos("cargo de **Gerente**.")).toEqual([{ text: "cargo de " }, { text: "Gerente.", bold: true }]);
  });

  it("no toca lo que sigue a una negrita con espacio", () => {
    expect(fragmentos("**L 13,200.00** (trece mil)")).toEqual([{ text: "L 13,200.00", bold: true }, { text: " (trece mil)" }]);
  });

  it("separa párrafos por línea en blanco", () => {
    expect(parrafos("Uno.\n\nDos.\r\n\r\nTres.")).toEqual(["Uno.", "Dos.", "Tres."]);
  });
});
