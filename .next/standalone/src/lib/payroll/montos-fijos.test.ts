/**
 * Parámetros de ley en modo «monto fijo»: el administrador puede decidir que
 * IHSS (EM), IVM, RAP, Reserva Laboral o INFOP se calculen como un monto
 * mensual igual para todos en vez de un porcentaje del salario.
 *
 * Incluye también el cálculo por porcentaje del Fondo de Reserva Laboral, que
 * es el aporte patronal nuevo (Decreto 47-2024).
 */

import { describe, it, expect } from "vitest";
import {
  calcularIHSS,
  calcularRAP,
  calcularReservaLaboral,
  calcularPlanilla,
  construirParametros,
  PARAMETROS_DEFAULT,
  type EntradaCalculoPlanilla,
} from "@/lib/payroll/calculos-hn";
import { aNumero as n } from "@/lib/payroll/money";

function entrada(over: Partial<EntradaCalculoPlanilla> = {}): EntradaCalculoPlanilla {
  return {
    salarioMensual: 15000,
    tipoPlanilla: "MENSUAL",
    diasPagables: 30,
    diasMes: 30,
    horasExtra: 0,
    bonificaciones: 0,
    otrosIngresos: 0,
    diasAusentes: 0,
    otrosDeducciones: 0,
    afpEmpleado: 0,
    aniosTrabajados: 3,
    ...over,
  };
}

describe("sin montos fijos todo sigue por porcentaje", () => {
  it("construirParametros sin `fijos` equivale a los valores por defecto", () => {
    const p = construirParametros({});
    expect(p.fijos).toEqual({ ihss: null, ivm: null, rap: null, infop: null, reservaLaboral: null });
    expect(calcularIHSS(20000, p)).toEqual(calcularIHSS(20000, PARAMETROS_DEFAULT));
    expect(calcularPlanilla(entrada(), p)).toEqual(calcularPlanilla(entrada(), PARAMETROS_DEFAULT));
  });
});

describe("IHSS EM e IVM en monto fijo", () => {
  const p = construirParametros({
    fijos: { ihss: { empleado: 300, empleador: 600 }, ivm: { empleado: 250, empleador: 350 } },
  });

  it("cada régimen usa su monto, sin importar el salario", () => {
    for (const salario of [8000, 20000, 90000]) {
      const r = calcularIHSS(salario, p);
      expect(n(r.emEmpleado)).toBe(300);
      expect(n(r.emEmpleador)).toBe(600);
      expect(n(r.ivmEmpleado)).toBe(250);
      expect(n(r.ivmEmpleador)).toBe(350);
      expect(n(r.empleado)).toBe(550);
      expect(n(r.empleador)).toBe(950);
    }
  });

  it("el aporte del Estado al IVM sigue por porcentaje", () => {
    expect(n(calcularIHSS(10000, p).ivmEstado)).toBe(n(calcularIHSS(10000, PARAMETROS_DEFAULT).ivmEstado));
  });

  it("se puede fijar sólo uno de los regímenes", () => {
    const soloEM = construirParametros({ fijos: { ihss: { empleado: 300, empleador: 600 } } });
    const r = calcularIHSS(10000, soloEM);
    expect(n(r.emEmpleado)).toBe(300);
    expect(n(r.ivmEmpleado)).toBe(250); // 2.5 % de 10,000
  });

  it("el IHSS fijo de la ficha del empleado prevalece sobre el general", () => {
    const r = calcularIHSS(20000, p, 400);
    expect(r.fijo).toBe(true);
    expect(n(r.empleado)).toBe(400);
    expect(n(r.emEmpleado) + n(r.ivmEmpleado)).toBeCloseTo(400, 2);
    // La patronal sigue siendo la general.
    expect(n(r.empleador)).toBe(950);
  });

  it("en la planilla es mensual: la quincena descuenta la mitad", () => {
    const r = calcularPlanilla(entrada({ tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15 }), p);
    expect(n(r.ihssEmpleado)).toBe(275);
    expect(n(r.ihssEmpleador)).toBe(475);
  });
});

describe("RAP en monto fijo", () => {
  const p = construirParametros({ fijos: { rap: { empleado: 120, empleador: 150 } } });

  it("se descuenta a todos, incluso bajo el piso del RAP", () => {
    // Por porcentaje, 10,000 no llega al piso y no cotiza: con monto fijo sí.
    expect(n(calcularRAP(10000, PARAMETROS_DEFAULT).empleado)).toBe(0);
    const r = calcularRAP(10000, p);
    expect(n(r.empleado)).toBe(120);
    expect(n(r.empleador)).toBe(150);
  });

  it("el ISR resta el RAP fijo realmente descontado", () => {
    const salario = 60000;
    const porcentaje = calcularPlanilla(entrada({ salarioMensual: salario }), PARAMETROS_DEFAULT);
    const fijo = calcularPlanilla(entrada({ salarioMensual: salario }), p);
    // El RAP fijo (120) es menor que el calculado (~690): más base, más ISR.
    expect(n(fijo.rapEmpleado)).toBe(120);
    expect(n(fijo.isr)).toBeGreaterThan(n(porcentaje.isr));
  });
});

describe("Fondo de Reserva Laboral por porcentaje (Decreto 47-2024)", () => {
  it("es el 4 % del salario ordinario, sin piso", () => {
    // A diferencia del RAP/FOVIIF, un salario bajo SÍ genera aporte.
    expect(n(calcularReservaLaboral(8000).empleador)).toBe(320);
    expect(n(calcularReservaLaboral(15000).empleador)).toBe(600);
  });

  it("topa la base en tres salarios mínimos (L57,896.16)", () => {
    const r = calcularReservaLaboral(90000);
    expect(n(r.base)).toBe(57896.16);
    expect(n(r.empleador)).toBeCloseTo(57896.16 * 0.04, 2);
  });

  it("es sólo patronal: no aparece en las deducciones del empleado", () => {
    const r = calcularPlanilla(entrada(), PARAMETROS_DEFAULT);
    const sinReserva = calcularPlanilla(entrada(), construirParametros({ reservaLaboralEmpleador: 0 }));
    expect(n(r.reservaLaboral)).toBe(600);
    expect(n(r.totalDeducciones)).toBe(n(sinReserva.totalDeducciones));
    expect(n(r.salarioNeto)).toBe(n(sinReserva.salarioNeto));
  });

  it("se prorratea al período como los demás aportes", () => {
    const q = calcularPlanilla(entrada({ tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15 }), PARAMETROS_DEFAULT);
    expect(n(q.reservaLaboral)).toBe(300);
  });
});

describe("Fondo de Reserva Laboral en monto fijo", () => {
  it("reemplaza el 4 % patronal y se prorratea al período", () => {
    const p = construirParametros({ fijos: { reservaLaboral: { empleador: 500 } } });
    expect(n(calcularPlanilla(entrada(), PARAMETROS_DEFAULT).reservaLaboral)).toBe(600); // 4 % de 15,000
    expect(n(calcularPlanilla(entrada(), p).reservaLaboral)).toBe(500);
    const quincena = calcularPlanilla(entrada({ tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15 }), p);
    expect(n(quincena.reservaLaboral)).toBe(250);
  });

  it("no toca el neto del empleado: es sólo patronal", () => {
    const p = construirParametros({ fijos: { reservaLaboral: { empleador: 500 } } });
    expect(n(calcularPlanilla(entrada(), p).salarioNeto)).toBe(n(calcularPlanilla(entrada()).salarioNeto));
  });
});

describe("INFOP en monto fijo", () => {
  it("reemplaza el 1 % patronal y se prorratea al período", () => {
    const p = construirParametros({ fijos: { infop: { empleador: 200 } } });
    expect(n(calcularPlanilla(entrada(), PARAMETROS_DEFAULT).infop)).toBe(150);
    expect(n(calcularPlanilla(entrada(), p).infop)).toBe(200);
    const quincena = calcularPlanilla(entrada({ tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15 }), p);
    expect(n(quincena.infop)).toBe(100);
  });

  it("no toca el neto del empleado: es sólo patronal", () => {
    const p = construirParametros({ fijos: { infop: { empleador: 200 } } });
    expect(n(calcularPlanilla(entrada(), p).salarioNeto)).toBe(n(calcularPlanilla(entrada()).salarioNeto));
  });
});
