import { describe, it, expect } from "vitest";
import {
  errorDePeriodo, esFechaIso, esPeriodoEstandar, etiquetaPeriodo, frasePeriodo, nombreArchivoPeriodo,
  periodoDeNombreArchivo, periodoQueContiene, periodosSugeridos,
} from "@/lib/payroll/periodos-planilla";

describe("períodos de planilla", () => {
  it("la quincena que contiene una fecha: del 1 al 15 y del 16 al último día", () => {
    expect(periodoQueContiene("QUINCENAL", "2026-11-11")).toEqual({ tipo: "QUINCENAL", desde: "2026-11-01", hasta: "2026-11-15" });
    expect(periodoQueContiene("QUINCENAL", "2026-11-16")).toEqual({ tipo: "QUINCENAL", desde: "2026-11-16", hasta: "2026-11-30" });
    expect(periodoQueContiene("QUINCENAL", "2026-12-31").hasta).toBe("2026-12-31");
    expect(periodoQueContiene("QUINCENAL", "2028-02-20").hasta).toBe("2028-02-29");
  });

  it("el mes y la semana de lunes a domingo", () => {
    expect(periodoQueContiene("MENSUAL", "2026-02-10")).toEqual({ tipo: "MENSUAL", desde: "2026-02-01", hasta: "2026-02-28" });
    // 2026-11-11 es miércoles.
    expect(periodoQueContiene("SEMANAL", "2026-11-11")).toEqual({ tipo: "SEMANAL", desde: "2026-11-09", hasta: "2026-11-15" });
    expect(periodoQueContiene("SEMANAL", "2026-11-09").desde).toBe("2026-11-09");
    expect(periodoQueContiene("SEMANAL", "2026-11-15").desde).toBe("2026-11-09");
  });

  it("sugiere los períodos alrededor de hoy, en orden y cruzando el año", () => {
    const q = periodosSugeridos("QUINCENAL", "2026-01-05", 2, 1);
    expect(q.map((p) => p.desde)).toEqual(["2025-12-01", "2025-12-16", "2026-01-01", "2026-01-16"]);
    expect(q[1].hasta).toBe("2025-12-31");
    const m = periodosSugeridos("MENSUAL", "2026-03-31", 1, 1);
    expect(m.map((p) => `${p.desde}/${p.hasta}`)).toEqual(["2026-02-01/2026-02-28", "2026-03-01/2026-03-31", "2026-04-01/2026-04-30"]);
  });

  it("nombra los períodos como se dicen", () => {
    expect(etiquetaPeriodo({ tipo: "QUINCENAL", desde: "2026-11-01", hasta: "2026-11-15" })).toBe("1.ª quincena de noviembre de 2026");
    expect(etiquetaPeriodo({ tipo: "QUINCENAL", desde: "2026-11-16", hasta: "2026-11-30" })).toBe("2.ª quincena de noviembre de 2026");
    expect(etiquetaPeriodo({ tipo: "MENSUAL", desde: "2026-11-01", hasta: "2026-11-30" })).toBe("Noviembre de 2026");
    expect(etiquetaPeriodo({ tipo: "QUINCENAL", desde: "2026-11-03", hasta: "2026-11-17" })).toBe("del 03/11/2026 al 17/11/2026");
    expect(esPeriodoEstandar({ tipo: "QUINCENAL", desde: "2026-11-16", hasta: "2026-11-29" })).toBe(false);
  });

  it("el período dentro de una frase, con «al» y «del» contraídos", () => {
    const q = { tipo: "QUINCENAL" as const, desde: "2026-11-01", hasta: "2026-11-15" };
    const m = { tipo: "MENSUAL" as const, desde: "2026-11-01", hasta: "2026-11-30" };
    const s = { tipo: "SEMANAL" as const, desde: "2026-11-09", hasta: "2026-11-15" };
    const otro = { tipo: "QUINCENAL" as const, desde: "2026-11-03", hasta: "2026-11-17" };
    expect(frasePeriodo(q, "a")).toBe("a la 1.ª quincena de noviembre de 2026");
    expect(frasePeriodo(m, "a")).toBe("al mes de noviembre de 2026");
    expect(frasePeriodo(m, "de")).toBe("del mes de noviembre de 2026");
    expect(frasePeriodo(m, "en")).toBe("en el mes de noviembre de 2026");
    expect(frasePeriodo(s, "en")).toBe("en la semana del 09/11/2026 al 15/11/2026");
    expect(frasePeriodo(otro, "de")).toBe("del período del 03/11/2026 al 17/11/2026");
  });

  it("el nombre del archivo lleva el período y se puede leer de vuelta, aunque el navegador le agregue « (1)»", () => {
    const p = { tipo: "QUINCENAL" as const, desde: "2026-11-01", hasta: "2026-11-15" };
    expect(nombreArchivoPeriodo(p)).toBe("deducciones_quincenal_2026-11-01_al_2026-11-15");
    expect(periodoDeNombreArchivo("deducciones_quincenal_2026-11-01_al_2026-11-15 (1).xlsx")).toEqual(p);
    expect(periodoDeNombreArchivo("plantilla_deducciones_mensual_2026-11-01_al_2026-11-30.csv")?.tipo).toBe("MENSUAL");
    expect(periodoDeNombreArchivo("deducciones.xlsx")).toBeNull();
    expect(periodoDeNombreArchivo("deducciones_quincenal_2026-11-15_al_2026-11-01.xlsx")).toBeNull();
  });

  it("valida fechas y períodos escritos a mano", () => {
    expect(esFechaIso("2026-02-30")).toBe(false);
    expect(esFechaIso("2026-02-28")).toBe(true);
    expect(errorDePeriodo({ desde: "2026-11-15", hasta: "2026-11-01" })).toMatch(/posterior/);
    expect(errorDePeriodo({ desde: "2026-11-01", hasta: "2027-01-31" })).toMatch(/45 días/);
    expect(errorDePeriodo({ desde: "", hasta: "2026-11-15" })).toMatch(/Elija/);
    expect(errorDePeriodo({ desde: "2026-11-01", hasta: "2026-11-30" })).toBeNull();
  });
});
