import { describe, expect, it } from "vitest";
import { estadoDePlanilla, etiquetaEstado } from "./EstadoBadge";

describe("nombre del estado", () => {
  it("una planilla calculada se lee Confirmada: es lo que hizo el botón que lleva ahí", () => {
    expect(etiquetaEstado(estadoDePlanilla("CALCULADA"))).toBe("Confirmada");
  });

  it("los demás estados de planilla no cambian", () => {
    expect(etiquetaEstado(estadoDePlanilla("BORRADOR"))).toBe("Borrador");
    expect(etiquetaEstado(estadoDePlanilla("APROBADA"))).toBe("Aprobada");
    expect(etiquetaEstado(estadoDePlanilla("PAGADA"))).toBe("Pagada");
    expect(etiquetaEstado(estadoDePlanilla("ANULADA"))).toBe("Anulada");
  });

  it("un décimo sigue siendo Calculada: ahí no hay nada que confirmar", () => {
    expect(etiquetaEstado("CALCULADA")).toBe("Calculada");
  });
});
