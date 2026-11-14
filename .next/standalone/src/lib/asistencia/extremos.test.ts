import { describe, it, expect } from "vitest";
import { extremos, type MarcaMinima } from "./extremos";

const marca = (iso: string, tipo: MarcaMinima["tipo"] = "DESCONOCIDO"): MarcaMinima => ({
  ocurridoEn: new Date(iso),
  tipo,
});

describe("extremos", () => {
  it("toma la primera marca como entrada y la última como salida", () => {
    const { entrada, salida } = extremos([
      marca("2026-09-04T14:00:00Z"),
      marca("2026-09-04T23:00:00Z"),
    ]);
    expect(entrada?.toISOString()).toBe("2026-09-04T14:00:00.000Z");
    expect(salida?.toISOString()).toBe("2026-09-04T23:00:00.000Z");
  });

  it("ordena antes de decidir: el orden de llegada no manda", () => {
    // Los equipos no garantizan que el buffer venga cronológico.
    const { entrada, salida } = extremos([
      marca("2026-09-04T23:00:00Z"),
      marca("2026-09-04T14:00:00Z"),
    ]);
    expect(entrada?.toISOString()).toBe("2026-09-04T14:00:00.000Z");
    expect(salida?.toISOString()).toBe("2026-09-04T23:00:00.000Z");
  });

  it("con una sola marca deja la salida en null, no la iguala a la entrada", () => {
    // Igualarlas daría una jornada de CERO horas para alguien que sí trabajó;
    // null hace que el día se registre como incompleto y salga a revisión.
    const { entrada, salida } = extremos([marca("2026-09-04T14:00:00Z")]);
    expect(entrada?.toISOString()).toBe("2026-09-04T14:00:00.000Z");
    expect(salida).toBeNull();
  });

  it("descarta el almuerzo: con cuatro marcas usa la primera y la última", () => {
    const { entrada, salida } = extremos([
      marca("2026-09-04T14:00:00Z"),
      marca("2026-09-04T18:00:00Z"),
      marca("2026-09-04T19:00:00Z"),
      marca("2026-09-04T23:00:00Z"),
    ]);
    expect(entrada?.toISOString()).toBe("2026-09-04T14:00:00.000Z");
    expect(salida?.toISOString()).toBe("2026-09-04T23:00:00.000Z");
  });

  it("prefiere la etiqueta del equipo cuando la hay", () => {
    // Hikvision informa el tipo en algunos modelos; si lo hace, manda su dato
    // por encima de la inferencia por orden.
    const { entrada, salida } = extremos([
      marca("2026-09-04T13:50:00Z", "SALIDA"), // salida del turno anterior
      marca("2026-09-04T14:00:00Z", "ENTRADA"),
      marca("2026-09-04T23:00:00Z", "SALIDA"),
    ]);
    expect(entrada?.toISOString()).toBe("2026-09-04T14:00:00.000Z");
    expect(salida?.toISOString()).toBe("2026-09-04T23:00:00.000Z");
  });

  it("sin marcas devuelve ambos en null", () => {
    expect(extremos([])).toEqual({ entrada: null, salida: null });
  });
});
