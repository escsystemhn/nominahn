import { describe, it, expect } from "vitest";
import { compararPorAntiguedad, textoAntiguedad } from "@/lib/empleados/antiguedad";
import { tablaPlanillaDetallada, type LineaPlanilla } from "@/lib/reportes/planilla-estructura";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { CERO, money } from "@/lib/payroll/money";

const f = (s: string) => new Date(`${s}T00:00:00Z`);

describe("orden por antigüedad (pedido del 2026-11-23)", () => {
  it("quien entró primero va arriba; a igual fecha, por nombre; sin fecha, al final", () => {
    const lista = [
      { nombre: "Oslin Reyes", fechaIngreso: f("2019-05-02") },
      { nombre: "Sin Fecha", fechaIngreso: null },
      { nombre: "Alba García", fechaIngreso: f("2008-01-15") },
      { nombre: "Ana Zelaya", fechaIngreso: f("2019-05-02") },
    ];
    expect([...lista].sort(compararPorAntiguedad).map((x) => x.nombre)).toEqual(["Alba García", "Ana Zelaya", "Oslin Reyes", "Sin Fecha"]);
  });

  it("los años de servicio, al cierre del período", () => {
    expect(textoAntiguedad(f("2015-02-03"), f("2026-11-15"))).toBe("11 años");
    expect(textoAntiguedad(f("2025-10-01"), f("2026-11-15"))).toBe("1 año");
    expect(textoAntiguedad(f("2026-06-01"), f("2026-11-15"))).toBe("menos de un año");
  });

  it("el reporte de la planilla sale en el mismo orden que la pantalla", () => {
    const ubicacion = { sucursal: { id: "s", nombre: "Pagsa" }, division: null, departamento: { id: "d", nombre: "Administración" } };
    const linea = (empleadoId: string, nombre: string, ingreso: string): LineaPlanilla => ({
      empleadoId, nombre, fechaIngreso: f(ingreso), ubicacion, dias: 15,
      salario: money(1000), horasExtra: CERO, otrosIngresos: CERO, devengado: money(1000), ihss: CERO, rap: CERO, isr: CERO, vecinal: CERO,
      porTipo: new Map(), ausencias: CERO, incapacidad: CERO, deducciones: CERO, neto: money(1000), patronal: CERO,
    });
    const t = tablaPlanillaDetallada([linea("1", "Alma Sandoval", "2021-03-01"), linea("2", "Zoila Pérez", "2004-07-10"), linea("3", "Gelyn Acevedo", "2012-09-20")], etiquetasNiveles(false));
    const nombres = t.datos.map((r) => r[0]).filter((x) => ["Alma Sandoval", "Zoila Pérez", "Gelyn Acevedo"].includes(x.trim()));
    expect(nombres.map((x) => x.trim())).toEqual(["Zoila Pérez", "Gelyn Acevedo", "Alma Sandoval"]);
  });
});
