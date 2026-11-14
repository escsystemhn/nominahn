import { describe, it, expect } from "vitest";
import { cuotaPorPeriodo, limiteDescuento, evaluarSolicitud, periodosPorMes } from "./prestamos";

describe("límite de descuento (Arts. 371 y 372)", () => {
  it("el salario mínimo no se toca; del excedente, una cuarta parte", () => {
    const l = limiteDescuento({ salarioMensual: 20000, salarioMinimo: 12000, tipoPlanilla: "MENSUAL", cuotasVigentesPeriodo: 0 });
    expect(l.embargableMensual).toBe(2000);
    expect(l.disponiblePeriodo).toBe(2000);
  });

  it("se lleva al período de pago y descuenta lo ya comprometido", () => {
    const l = limiteDescuento({ salarioMensual: 20000, salarioMinimo: 12000, tipoPlanilla: "QUINCENAL", cuotasVigentesPeriodo: 400 });
    expect(l.embargablePeriodo).toBe(1000);
    expect(l.disponiblePeriodo).toBe(600);
    expect(periodosPorMes("SEMANAL")).toBeCloseTo(4.333, 3);
  });

  it("quien gana el mínimo o menos no tiene parte embargable", () => {
    const l = limiteDescuento({ salarioMensual: 11000, salarioMinimo: 12000, tipoPlanilla: "MENSUAL", cuotasVigentesPeriodo: 0 });
    expect(l.disponiblePeriodo).toBe(0);
  });
});

describe("evaluarSolicitud", () => {
  const limite = limiteDescuento({ salarioMensual: 20000, salarioMinimo: 12000, tipoPlanilla: "QUINCENAL", cuotasVigentesPeriodo: 0 });

  it("cuota redondeada hacia arriba al centavo", () => {
    expect(cuotaPorPeriodo(1000, 3)).toBe(333.34);
    expect(cuotaPorPeriodo(1000, 4)).toBe(250);
  });

  it("préstamo dentro del límite: sin aviso", () => {
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 6000, cuotas: 12, limite })).toEqual({ errores: [], cuotaPeriodo: 500, excedeLimite: false, aviso: null });
  });

  it("préstamo que pasa de lo embargable: se marca, no se bloquea", () => {
    const r = evaluarSolicitud({ tipo: "PRESTAMO", monto: 6000, cuotas: 4, limite });
    expect(r.errores).toEqual([]);
    expect(r.excedeLimite).toBe(true);
    expect(r.aviso).toMatch(/1000\.00 por período/);
  });

  it("un anticipo exige al menos 5 períodos", () => {
    expect(evaluarSolicitud({ tipo: "ADELANTO", monto: 3000, cuotas: 2, limite }).errores[0]).toMatch(/al menos 5 períodos/);
    expect(evaluarSolicitud({ tipo: "ADELANTO", monto: 3000, cuotas: 5, limite }).errores).toEqual([]);
  });

  it("datos imposibles y sin salario mínimo", () => {
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 0, cuotas: 0, limite }).errores.length).toBe(2);
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 100, cuotas: 61, limite }).errores[0]).toMatch(/60 cuotas/);
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 1000, cuotas: 2, limite: null }).aviso).toMatch(/salario mínimo/);
  });
});
