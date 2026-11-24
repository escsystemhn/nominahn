import { describe, it, expect } from "vitest";
import { cuotaPorPeriodo, evaluarSolicitud } from "./prestamos";

describe("evaluarSolicitud", () => {
  it("cuota redondeada hacia arriba al centavo", () => {
    expect(cuotaPorPeriodo(1000, 3)).toBe(333.34);
    expect(cuotaPorPeriodo(1000, 4)).toBe(250);
  });

  it("el monto es libre: RRHH lo analiza (decisión del cliente, 2026-11-21)", () => {
    // Antes se marcaba: en quincenal con 20,000 de salario y 12,000 de mínimo, 1,500 por quincena pasaba de 1,000.
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 6000, cuotas: 4 })).toEqual({ errores: [], cuotaPeriodo: 1500 });
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 250000, cuotas: 1 })).toEqual({ errores: [], cuotaPeriodo: 250000 });
  });

  it("un anticipo exige al menos 5 períodos", () => {
    expect(evaluarSolicitud({ tipo: "ADELANTO", monto: 3000, cuotas: 2 }).errores[0]).toMatch(/al menos 5 períodos/);
    expect(evaluarSolicitud({ tipo: "ADELANTO", monto: 3000, cuotas: 5 }).errores).toEqual([]);
  });

  it("datos imposibles", () => {
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 0, cuotas: 0 }).errores.length).toBe(2);
    expect(evaluarSolicitud({ tipo: "PRESTAMO", monto: 100, cuotas: 61 }).errores[0]).toMatch(/60 cuotas/);
  });
});
