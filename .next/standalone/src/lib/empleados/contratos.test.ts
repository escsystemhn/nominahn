import { describe, it, expect } from "vitest";
import { finDelAnterior, motivoContratoInvalido, motivoFinInvalido, situacionContrato } from "./contratos";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const BASE = { fechaIngreso: d("2024-01-01"), hoy: d("2026-11-03"), ultimoInicio: null };

describe("registrar un contrato", () => {
  it("acepta uno indefinido que empieza hoy", () => {
    expect(motivoContratoInvalido({ ...BASE, tipo: "INDEFINIDO", fechaInicio: d("2026-11-03"), fechaFin: null })).toBeNull();
  });

  it("rechaza uno que aún no empieza", () => {
    expect(motivoContratoInvalido({ ...BASE, tipo: "INDEFINIDO", fechaInicio: d("2026-11-04"), fechaFin: null })).toContain("día que empieza");
  });

  it("rechaza uno anterior al ingreso", () => {
    expect(motivoContratoInvalido({ ...BASE, tipo: "INDEFINIDO", fechaInicio: d("2023-12-31"), fechaFin: null })).toContain("ingreso");
  });

  it("debe empezar después del anterior", () => {
    const con = { ...BASE, ultimoInicio: d("2026-01-01") };
    expect(motivoContratoInvalido({ ...con, tipo: "INDEFINIDO", fechaInicio: d("2026-01-01"), fechaFin: null })).toContain("anterior");
    expect(motivoContratoInvalido({ ...con, tipo: "INDEFINIDO", fechaInicio: d("2026-01-02"), fechaFin: null })).toBeNull();
  });
});

describe("tras una reincorporación", () => {
  it("no se solapa con el contrato anterior ya cerrado", () => {
    const con = { ...BASE, ultimoInicio: d("2026-01-01"), ultimoFinCerrado: d("2026-06-30") };
    expect(motivoContratoInvalido({ ...con, tipo: "INDEFINIDO", fechaInicio: d("2026-06-30"), fechaFin: null })).toContain("terminó");
    expect(motivoContratoInvalido({ ...con, tipo: "INDEFINIDO", fechaInicio: d("2026-07-01"), fechaFin: null })).toBeNull();
  });
});

describe("fecha de fin", () => {
  it("temporal y de prueba la necesitan", () => {
    expect(motivoFinInvalido("TEMPORAL", d("2026-01-01"), null)).toContain("necesita");
    expect(motivoFinInvalido("PRUEBA", d("2026-01-01"), null)).toContain("necesita");
    expect(motivoFinInvalido("TEMPORAL", d("2026-01-01"), d("2026-06-30"))).toBeNull();
  });

  it("indefinido no la lleva y servicios es opcional", () => {
    expect(motivoFinInvalido("INDEFINIDO", d("2026-01-01"), d("2026-06-30"))).toContain("no lleva");
    expect(motivoFinInvalido("SERVICIO", d("2026-01-01"), null)).toBeNull();
    expect(motivoFinInvalido("SERVICIO", d("2026-01-01"), d("2026-06-30"))).toBeNull();
  });

  it("debe ser posterior al inicio", () => {
    expect(motivoFinInvalido("TEMPORAL", d("2026-01-01"), d("2026-01-01"))).toContain("posterior");
  });
});

describe("contrato anterior", () => {
  it("termina el día antes del nuevo", () => {
    expect(finDelAnterior({ fechaFin: null }, d("2026-07-01"))).toEqual(d("2026-06-30"));
  });

  it("si vencía después, se acorta", () => {
    expect(finDelAnterior({ fechaFin: d("2026-12-31") }, d("2026-07-01"))).toEqual(d("2026-06-30"));
  });

  it("si ya había terminado antes, conserva su fecha", () => {
    expect(finDelAnterior({ fechaFin: d("2026-03-31") }, d("2026-07-01"))).toEqual(d("2026-03-31"));
  });
});

describe("situación", () => {
  const hoy = d("2026-11-03");
  it("distingue vigente, vencido y terminado", () => {
    expect(situacionContrato({ activo: true, fechaFin: null }, hoy)).toBe("VIGENTE");
    expect(situacionContrato({ activo: true, fechaFin: d("2026-11-03") }, hoy)).toBe("VIGENTE");
    expect(situacionContrato({ activo: true, fechaFin: d("2026-11-02") }, hoy)).toBe("VENCIDO");
    expect(situacionContrato({ activo: false, fechaFin: d("2026-12-31") }, hoy)).toBe("TERMINADO");
  });
});
