import { describe, it, expect } from "vitest";
import {
  REGLAS_POR_OMISION,
  diasEntre,
  normalizarReglas,
  validarReglas,
  diasPatronoParaNueva,
  diasEnPeriodo,
  fechasCubiertas,
  descuentoIncapacidades,
  subsidioEstimado,
} from "./incapacidades";

const f = (s: string) => new Date(`${s}T00:00:00Z`);

describe("reglas", () => {
  it("por omisión: 3 días del patrono (Art. 71 Reglamento IHSS 2020) y maternidad con complemento (Art. 136 C.T.)", () => {
    expect(REGLAS_POR_OMISION.ENFERMEDAD_COMUN.diasPatrono).toBe(3);
    expect(REGLAS_POR_OMISION.MATERNIDAD).toEqual({ diasPatrono: 0, porcentajeSubsidio: 66, porcentajeComplemento: 34 });
  });
  it("lee lo guardado sobre lo de omisión y descarta valores imposibles", () => {
    const r = normalizarReglas({ ENFERMEDAD_COMUN: { diasPatrono: 2, porcentajeSubsidio: 70 }, MATERNIDAD: { porcentajeComplemento: 150 }, BASURA: {} });
    expect(r.ENFERMEDAD_COMUN).toEqual({ diasPatrono: 2, porcentajeSubsidio: 70, porcentajeComplemento: 0 });
    expect(r.MATERNIDAD.porcentajeComplemento).toBe(34);
    expect(normalizarReglas(null)).toEqual(REGLAS_POR_OMISION);
  });
  it("subsidio más complemento no pasa de 100", () => {
    expect(validarReglas(REGLAS_POR_OMISION)).toEqual([]);
    expect(validarReglas({ ...REGLAS_POR_OMISION, MATERNIDAD: { diasPatrono: 0, porcentajeSubsidio: 66, porcentajeComplemento: 50 } })[0]).toMatch(/Maternidad/);
  });
  it("una prórroga no reinicia los días del patrono", () => {
    expect(diasPatronoParaNueva(REGLAS_POR_OMISION.ENFERMEDAD_COMUN, 0)).toBe(3);
    expect(diasPatronoParaNueva(REGLAS_POR_OMISION.ENFERMEDAD_COMUN, 3)).toBe(0);
    expect(diasPatronoParaNueva(REGLAS_POR_OMISION.ENFERMEDAD_COMUN, 1)).toBe(2);
  });
});

describe("reparto de días en el período", () => {
  const inc = { fechaInicio: f("2026-10-10"), fechaFin: f("2026-10-19"), diasPatrono: 3, porcentajeComplemento: 0 };

  it("10 días: 3 del patrono y 7 del IHSS", () => {
    expect(diasEntre(inc.fechaInicio, inc.fechaFin)).toBe(10);
    expect(diasEnPeriodo(inc, f("2026-10-01"), f("2026-10-31"))).toEqual({ patrono: 3, ihss: 7 });
  });

  it("partida entre dos quincenas", () => {
    expect(diasEnPeriodo(inc, f("2026-10-01"), f("2026-10-15"))).toEqual({ patrono: 3, ihss: 3 });
    expect(diasEnPeriodo(inc, f("2026-10-16"), f("2026-10-31"))).toEqual({ patrono: 0, ihss: 4 });
  });

  it("fuera del período, o sin días del patrono", () => {
    expect(diasEnPeriodo(inc, f("2026-11-01"), f("2026-11-15"))).toEqual({ patrono: 0, ihss: 0 });
    expect(diasEnPeriodo({ ...inc, diasPatrono: 0 }, f("2026-10-01"), f("2026-10-31"))).toEqual({ patrono: 0, ihss: 10 });
  });

  it("fechas cubiertas dentro del período (no cuentan como ausencia)", () => {
    expect(fechasCubiertas(inc, f("2026-10-16"), f("2026-10-31")).map((t) => new Date(t).toISOString().slice(0, 10))).toEqual([
      "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19",
    ]);
  });
});

describe("descuento en planilla y subsidio estimado", () => {
  it("salario diario × días del IHSS × (1 − complemento)", () => {
    const incs = [{ fechaInicio: f("2026-10-10"), fechaFin: f("2026-10-19"), diasPatrono: 3, porcentajeComplemento: 0 }];
    expect(descuentoIncapacidades(15000, incs, f("2026-10-01"), f("2026-10-31"))).toEqual({ diasIhss: 7, descuento: 3500 });
  });
  it("maternidad: el patrono sólo deja de pagar lo que cubre el IHSS", () => {
    const incs = [{ fechaInicio: f("2026-10-01"), fechaFin: f("2026-12-23"), diasPatrono: 0, porcentajeComplemento: 34 }];
    expect(descuentoIncapacidades(15000, incs, f("2026-10-01"), f("2026-10-15"))).toEqual({ diasIhss: 15, descuento: 4950 });
  });
  it("subsidio estimado con techo de cotización", () => {
    expect(subsidioEstimado(15000, 7, 66)).toBe(2310);
    expect(subsidioEstimado(15000, 7, 66, 10000)).toBe(1540);
  });
});
