/**
 * Negociación de prestaciones y adelantos de décimos pagados aparte: cómo se rebajan
 * en la liquidación final (decisión de Edbin del 2026-11-14).
 */
import { describe, expect, it } from "vitest";
import { calcularLiquidacion, CONCEPTO_FONDO_RESERVA } from "@/lib/payroll/liquidacion";
import { CONCEPTO_ADELANTO_13, CONCEPTO_ADELANTO_14, CONCEPTO_NEGOCIACION } from "@/lib/prestaciones/anticipos";
import { aNumero as n } from "@/lib/payroll/money";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const base = {
  fechaIngreso: d("2020-01-01"),
  fechaSalida: d("2026-06-30"),
  causa: "DESPIDO_INJUSTIFICADO" as const,
  salarioPromedio: 15000,
};
const monto = (r: ReturnType<typeof calcularLiquidacion>, concepto: string) =>
  n(r.conceptos.find((c) => c.concepto.startsWith(concepto))?.monto ?? 0);

const sin = calcularLiquidacion(base);
const CESANTIA = monto(sin, "Auxilio de cesantía");

describe("negociación de prestaciones ya pagada", () => {
  it("se rebaja de la cesantía como línea negativa", () => {
    const r = calcularLiquidacion({ ...base, negociacionPrestaciones: 30000 });
    expect(monto(r, CONCEPTO_NEGOCIACION)).toBe(-30000);
    expect(n(r.rebajas.negociacion)).toBe(30000);
    expect(n(r.totalAPagar)).toBeCloseTo(n(sin.totalAPagar) - 30000, 2);
    // La cesantía sigue apareciendo completa: la rebaja es su propia línea, auditable.
    expect(monto(r, "Auxilio de cesantía")).toBe(CESANTIA);
  });

  it("no deja la cesantía en negativo ni toca los demás conceptos", () => {
    const r = calcularLiquidacion({ ...base, negociacionPrestaciones: CESANTIA + 50000 });
    expect(monto(r, CONCEPTO_NEGOCIACION)).toBe(-CESANTIA);
    expect(n(r.totalAPagar)).toBeCloseTo(n(sin.totalAPagar) - CESANTIA, 2);
    expect(monto(r, "Preaviso")).toBe(monto(sin, "Preaviso"));
    expect(r.observaciones.some((o) => o.includes("supera la cesantía en 50000.00"))).toBe(true);
  });

  it("va después del Fondo de Reserva: sólo rebaja lo que queda", () => {
    const r = calcularLiquidacion({ ...base, saldoFondoReserva: 24000, negociacionPrestaciones: CESANTIA });
    expect(monto(r, CONCEPTO_FONDO_RESERVA)).toBe(-24000);
    expect(monto(r, CONCEPTO_NEGOCIACION)).toBeCloseTo(-(CESANTIA - 24000), 2);
  });

  it("sin cesantía (renuncia con menos de 15 años) no rebaja nada y lo avisa", () => {
    const r = calcularLiquidacion({ ...base, causa: "RENUNCIA", negociacionPrestaciones: 10000 });
    expect(monto(r, CONCEPTO_NEGOCIACION)).toBe(0);
    expect(n(r.rebajas.negociacion)).toBe(0);
    expect(r.observaciones.some((o) => o.includes("no genera cesantía"))).toBe(true);
  });
});

describe("adelantos de décimos ya pagados", () => {
  it("se rebajan del proporcional", () => {
    const r = calcularLiquidacion({ ...base, decimoTerceroDevengado: 7500, adelantoDecimoTercero: 3000, decimoCuartoDevengado: 15000, adelantoDecimoCuarto: 15000 });
    expect(monto(r, CONCEPTO_ADELANTO_13)).toBe(-3000);
    expect(monto(r, CONCEPTO_ADELANTO_14)).toBe(-15000);
    expect(n(r.rebajas.adelanto13)).toBe(3000);
    expect(n(r.rebajas.adelanto14)).toBe(15000);
  });

  it("un adelanto mayor que el proporcional lo deja en cero y avisa", () => {
    const r = calcularLiquidacion({ ...base, decimoTerceroDevengado: 2000, adelantoDecimoTercero: 5000 });
    expect(monto(r, CONCEPTO_ADELANTO_13)).toBe(-2000);
    expect(r.observaciones.some((o) => o.includes("supera su proporcional en 3000.00"))).toBe(true);
  });

  it("sin anticipos el resultado no cambia", () => {
    expect(n(calcularLiquidacion({ ...base, negociacionPrestaciones: 0 }).totalAPagar)).toBe(n(sin.totalAPagar));
    expect(sin.rebajas.negociacion.isZero()).toBe(true);
  });
});
