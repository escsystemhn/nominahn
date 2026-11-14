import { describe, expect, it } from "vitest";
import { aNumero as n, money } from "@/lib/payroll/money";
import { filasRapHistorico, type LineaRapReporte } from "./rap-historico";

const linea = (o: Partial<LineaRapReporte>): LineaRapReporte => ({
  empleadoId: "a", nombre: "Ana", rapNro: "R-1", mes: "2036-03",
  salarioBase: 15000, rapEmpleado: 0, rapEmpleador: 0, reservaLaboral: 0, ...o,
});

describe("Planilla RAP histórica", () => {
  it("suma las quincenas del período por empleado: lo descontado, no lo estimado", () => {
    const { filas, totales } = filasRapHistorico([
      linea({ rapEmpleado: 135.73, rapEmpleador: 135.73, reservaLaboral: 600 }),
      linea({ rapEmpleado: 135.72, rapEmpleador: 135.72, reservaLaboral: 600 }),
      linea({ empleadoId: "b", nombre: "Beto", salarioBase: 20000, rapEmpleado: 0 }),
    ], () => null);
    expect(filas.map((f) => f.nombre)).toEqual(["Ana", "Beto"]);
    expect([n(filas[0].salario), n(filas[0].rapEmpleado), n(filas[0].reserva), n(filas[0].total)]).toEqual([30000, 271.45, 1200, 1742.9]);
    // Sin mes vencido, la base declarada es lo devengado en el mes.
    expect(n(filas[0].base)).toBe(30000);
    expect(n(totales.total)).toBe(1742.9);
    expect(n(totales.salario)).toBe(50000);
  });

  it("a mes vencido, la base de cada mes es la que usó el cálculo, no el salario del mes", () => {
    const bases = new Map([["a|2036-03", money(40000)]]);
    const { filas } = filasRapHistorico([
      linea({ mes: "2036-03" }), linea({ mes: "2036-03" }),
      linea({ mes: "2036-04" }), linea({ mes: "2036-04" }),
    ], (id, mes) => bases.get(`${id}|${mes}`) ?? null);
    // Marzo con base importada de 40,000; abril sobre el mes en curso, 30,000.
    expect(n(filas[0].base)).toBe(70000);
    expect(n(filas[0].salario)).toBe(60000);
  });

  it("sin líneas no hay filas y los totales son cero", () => {
    const { filas, totales } = filasRapHistorico([], () => null);
    expect(filas).toEqual([]);
    expect(n(totales.total)).toBe(0);
  });
});
