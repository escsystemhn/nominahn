import { describe, expect, it } from "vitest";
import { calcularPlanilla, PARAMETROS_DEFAULT, type EntradaCalculoPlanilla } from "@/lib/payroll/calculos-hn";

/**
 * «Deducir IHSS» / «Deducir RAP» apagados en la ficha de quien ya cotiza en otra nómina
 * (decisión de Edbin, 2026-11-15): la ficha no calcula ni lo del trabajador ni lo
 * patronal de ese aporte, ni lo resta de la base del ISR; INFOP y Reserva siguen.
 */
const n = (x: { toString(): string }) => Number(x.toString());
const quincena = (o: Partial<EntradaCalculoPlanilla> = {}): EntradaCalculoPlanilla => ({
  salarioMensual: 45000, tipoPlanilla: "QUINCENAL", diasPagables: 15, diasMes: 15, horasExtra: 0, bonificaciones: 0,
  otrosIngresos: 0, diasAusentes: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 3, ...o,
});

describe("aportes que se apagan en la ficha", () => {
  const normal = calcularPlanilla(quincena(), PARAMETROS_DEFAULT);

  it("por omisión la ficha cotiza: hay IHSS y RAP del trabajador y del patrono", () => {
    expect(n(normal.ihssEmpleado)).toBeGreaterThan(0);
    expect(n(normal.ihssEmpleador)).toBeGreaterThan(0);
    expect(n(normal.rapEmpleado)).toBeGreaterThan(0);
    expect(n(normal.rapEmpleador)).toBeGreaterThan(0);
    expect(calcularPlanilla(quincena({ aplicaIhss: true, aplicaRap: true }), PARAMETROS_DEFAULT)).toEqual(normal);
  });

  it("sin IHSS: cero lo del trabajador, lo patronal y el IVM; el RAP, INFOP y la Reserva no cambian", () => {
    const r = calcularPlanilla(quincena({ aplicaIhss: false }), PARAMETROS_DEFAULT);
    expect([n(r.ihssEmpleado), n(r.ihssEmpleador), n(r.ivmEmpleado), n(r.ivmEmpleador), n(r.ivmEstado)]).toEqual([0, 0, 0, 0, 0]);
    expect(n(r.rapEmpleado)).toBe(n(normal.rapEmpleado));
    expect(n(r.infop)).toBe(n(normal.infop));
    expect(n(r.reservaLaboral)).toBe(n(normal.reservaLaboral));
  });

  it("sin RAP: cero lo del trabajador y lo patronal; el IHSS y la Reserva Laboral no cambian", () => {
    const r = calcularPlanilla(quincena({ aplicaRap: false }), PARAMETROS_DEFAULT);
    expect([n(r.rapEmpleado), n(r.rapEmpleador)]).toEqual([0, 0]);
    expect(n(r.ihssEmpleado)).toBe(n(normal.ihssEmpleado));
    expect(n(r.reservaLaboral)).toBe(n(normal.reservaLaboral));
  });

  it("lo que no se deduce tampoco se resta del ISR: el ISR sube y el neto baja sólo por eso", () => {
    const r = calcularPlanilla(quincena({ aplicaIhss: false, aplicaRap: false }), PARAMETROS_DEFAULT);
    expect(n(r.isr)).toBeGreaterThan(n(normal.isr));
    const sinAportes = n(normal.ihssEmpleado) + n(normal.rapEmpleado);
    expect(n(r.salarioNeto)).toBeCloseTo(n(normal.salarioNeto) + sinAportes - (n(r.isr) - n(normal.isr)), 2);
  });

  it("a mes vencido, sin RAP queda sólo la Reserva Laboral del mes anterior", () => {
    const vencido = { rapMesVencido: { base: 40000 } };
    const con = calcularPlanilla(quincena(vencido), PARAMETROS_DEFAULT);
    const sin = calcularPlanilla(quincena({ ...vencido, aplicaRap: false }), PARAMETROS_DEFAULT);
    expect(n(con.rapEmpleado)).toBeGreaterThan(0);
    expect([n(sin.rapEmpleado), n(sin.rapEmpleador)]).toEqual([0, 0]);
    expect(n(sin.reservaLaboral)).toBe(n(con.reservaLaboral));
  });
});
