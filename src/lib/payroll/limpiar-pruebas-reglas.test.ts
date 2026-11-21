import { describe, it, expect } from "vitest";
import { DIAS_MAXIMOS, errorDeDesde, motivoNoLimpiable } from "@/lib/payroll/limpiar-pruebas-reglas";

describe("qué planilla se puede quitar al limpiar pruebas", () => {
  it("en borrador o confirmada, sin SAP, sí", () => {
    expect(motivoNoLimpiable({ estado: "BORRADOR", enviosSap: 0 })).toBeNull();
    expect(motivoNoLimpiable({ estado: "CALCULADA", enviosSap: 0 })).toBeNull();
  });
  it("las cerradas no: aprobada y pagada se anulan; la anulada queda en el historial", () => {
    expect(motivoNoLimpiable({ estado: "APROBADA", enviosSap: 0 })).toMatch(/cerrada/);
    expect(motivoNoLimpiable({ estado: "PAGADA", enviosSap: 0 })).toMatch(/cerrada/);
    expect(motivoNoLimpiable({ estado: "ANULADA", enviosSap: 0 })).toMatch(/anulada/);
  });
  it("con historial en SAP tampoco, aunque siga confirmada", () => {
    expect(motivoNoLimpiable({ estado: "CALCULADA", enviosSap: 1 })).toMatch(/SAP/);
  });
});

describe("desde cuándo se limpia", () => {
  const ahora = new Date("2026-11-21T15:00:00Z");
  it("una fecha válida de los últimos días", () => {
    expect(errorDeDesde(new Date("2026-11-21T06:00:00Z"), ahora)).toBeNull();
    expect(errorDeDesde(new Date("2026-09-01T00:00:00Z"), ahora)).toBeNull();
  });
  it("ni vacía, ni futura, ni más atrás del tope", () => {
    expect(errorDeDesde(new Date("no"), ahora)).toMatch(/Indique/);
    expect(errorDeDesde(new Date("2026-11-22T00:00:00Z"), ahora)).toMatch(/futura/);
    expect(errorDeDesde(new Date(ahora.getTime() - (DIAS_MAXIMOS + 1) * 86_400_000), ahora)).toMatch(/días atrás/);
  });
});
