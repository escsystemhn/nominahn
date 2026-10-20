import { describe, it, expect } from "vitest";
import { calcularPlanilla, PARAMETROS_DEFAULT } from "./calculos-hn";
import { generarPartidaContable } from "./partida-contable";
import { construirBoleta } from "./boleta";
import { money } from "./money";

const entrada = {
  salarioMensual: 15000,
  tipoPlanilla: "MENSUAL" as const,
  diasPagables: 30,
  diasMes: 30,
  horasExtra: 0,
  bonificaciones: 0,
  otrosIngresos: 0,
  diasAusentes: 0,
  otrosDeducciones: 0,
  afpEmpleado: 0,
  aniosTrabajados: 2,
};

describe("incapacidad en la planilla", () => {
  it("es una línea propia que reduce el neto; sin ella, nada cambia", () => {
    const sin = calcularPlanilla(entrada, PARAMETROS_DEFAULT);
    const con = calcularPlanilla({ ...entrada, incapacidad: 3500 }, PARAMETROS_DEFAULT);
    expect(sin.incapacidad.toNumber()).toBe(0);
    expect(con.incapacidad.toNumber()).toBe(3500);
    expect(con.totalDeducciones.minus(sin.totalDeducciones).toNumber()).toBe(3500);
    expect(sin.salarioNeto.minus(con.salarioNeto).toNumber()).toBe(3500);
    // No altera las cotizaciones ni el ISR, igual que las ausencias.
    expect(con.ihssEmpleado.equals(sin.ihssEmpleado)).toBe(true);
    expect(con.isr.equals(sin.isr)).toBe(true);
  });

  it("la partida sigue cuadrando: la incapacidad va con las ausencias", () => {
    const r = calcularPlanilla({ ...entrada, incapacidad: 3500 }, PARAMETROS_DEFAULT);
    const detalle = { ...r, bonificaciones: r.salarioBase.minus(r.salarioBase), otrosIngresos: 0, cooperativa: 0, prestamos: 0, adelantos: 0 };
    const partida = generarPartidaContable([detalle]);
    expect(partida.cuadra).toBe(true);
    const descuento = partida.lineas.find((l) => l.clave === "descuentoAusencias");
    expect(descuento?.haber.toNumber()).toBe(3500);
  });

  it("la boleta muestra la línea con los días", () => {
    const r = calcularPlanilla({ ...entrada, incapacidad: 3500 }, PARAMETROS_DEFAULT);
    const b = construirBoleta(
      { ...r, bonificaciones: 0, otrosIngresos: 0, cooperativa: 0, prestamos: 0, adelantos: 0, diasTrabajados: 23, horasExtra: 0, diasIncapacidadIhss: 7, incapacidad: money(3500) },
      {
        empresa: { nombre: "Empresa", rtn: "0801" },
        empleado: { codigo: "E-1", identidad: null, primerNombre: "Ana", primerApellido: "López" },
        planilla: { tipo: "MENSUAL", fechaInicio: new Date("2026-10-01T00:00:00Z"), fechaFin: new Date("2026-10-31T00:00:00Z") },
      }
    );
    expect(b.deducciones.find(([n]) => n.startsWith("Incapacidad IHSS"))?.[0]).toBe("Incapacidad IHSS (7 días)");
  });
});
