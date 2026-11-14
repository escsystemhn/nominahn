import { describe, expect, it } from "vitest";
import { resumenDeRevision, revisarPlanilla, type LineaRevision } from "./revision-planilla";
import { sumar } from "./money";

function linea(empleadoId: string, neto: number, cambios: Partial<LineaRevision> = {}): LineaRevision {
  return {
    empleadoId,
    nombre: empleadoId,
    salarioBase: 10000,
    diasTrabajados: 15,
    horasExtra: 0,
    totalBruto: neto + 1000,
    totalDeducciones: 1000,
    salarioNeto: neto,
    tieneCuenta: true,
    tieneCorreo: true,
    ...cambios,
  };
}

/** El puente debe llevar del neto anterior al actual, al centavo. */
function cuadra(r: ReturnType<typeof revisarPlanilla>) {
  const suma = sumar(r.netoAnterior, ...r.puente.map((p) => p.monto));
  expect(suma.toFixed(2)).toBe(r.netoActual.toFixed(2));
}

describe("revisarPlanilla: el puente", () => {
  it("sin anterior no compara, pero sigue revisando la planilla", () => {
    const r = revisarPlanilla([linea("a", 1000, { tieneCuenta: false })], null);
    expect(r.hayAnterior).toBe(false);
    expect(r.puente).toEqual([]);
    expect(r.proporcion).toBeNull();
    expect(r.entran).toEqual([]);
    expect(r.puntos.map((p) => p.clave)).toEqual(["sin-cuenta"]);
  });

  it("una planilla idéntica no tiene partidas", () => {
    const r = revisarPlanilla([linea("a", 1000)], [linea("a", 1000)]);
    expect(r.puente).toEqual([]);
    expect(r.diferencia.isZero()).toBe(true);
    expect(r.sinCambio).toBe(1);
    expect(r.cambios).toEqual([]);
  });

  it("explica quién entra, quién sale y qué cambió en quienes siguen", () => {
    const r = revisarPlanilla(
      [linea("sigue", 1200, { totalBruto: 2400, totalDeducciones: 1200 }), linea("entra", 500)],
      [linea("sigue", 1000, { totalBruto: 2000, totalDeducciones: 1000 }), linea("sale", 700)]
    );
    expect(r.puente.map((p) => [p.clave, p.personas, p.monto.toFixed(2)])).toEqual([
      ["entran", 1, "500.00"],
      ["salen", 1, "-700.00"],
      ["ingresos", undefined, "400.00"],
      ["deducciones", undefined, "-200.00"],
    ]);
    expect(r.netoAnterior.toFixed(2)).toBe("1700.00");
    expect(r.netoActual.toFixed(2)).toBe("1700.00");
    cuadra(r);
  });

  it("cuadra al centavo con montos que en coma flotante se descuadran", () => {
    const actual = [0.1, 0.2, 1234.57, 9999.99].map((n, i) => linea(`e${i}`, n + 0.03, { totalBruto: n + 500.03, totalDeducciones: 500 }));
    const anterior = [0.3, 0.1, 1200.01, 10000.1].map((n, i) => linea(`e${i}`, n, { totalBruto: n + 450, totalDeducciones: 450 }));
    cuadra(revisarPlanilla(actual, anterior));
  });

  it("lo que neto, bruto y deducciones no explican queda como otros ajustes", () => {
    const r = revisarPlanilla(
      [linea("a", 1100, { totalBruto: 2000, totalDeducciones: 1000 })],
      [linea("a", 1000, { totalBruto: 2000, totalDeducciones: 1000 })]
    );
    expect(r.puente.map((p) => [p.clave, p.monto.toFixed(2)])).toEqual([["otros", "100.00"]]);
    cuadra(r);
  });
});

describe("revisarPlanilla: quién cambió", () => {
  it("ordena de mayor a menor cambio, sin importar el signo", () => {
    const r = revisarPlanilla([linea("a", 1100), linea("b", 500), linea("c", 1010)], [linea("a", 1000), linea("b", 1000), linea("c", 1000)]);
    expect(r.cambios.map((c) => c.empleadoId)).toEqual(["b", "a", "c"]);
    expect(r.cambios[0].diferencia.toFixed(2)).toBe("-500.00");
  });

  it("dice por qué cambió cada persona", () => {
    const r = revisarPlanilla(
      [linea("a", 1500, { salarioBase: 12000, diasTrabajados: 12, horasExtra: 5, totalBruto: 2600, totalDeducciones: 1100 })],
      [linea("a", 1000, { salarioBase: 10000, diasTrabajados: 15, horasExtra: 0, totalBruto: 2000, totalDeducciones: 1000 })]
    );
    expect(r.cambios[0].motivos).toEqual([
      expect.stringMatching(/^Salario de L\s10,000\.00 a L\s12,000\.00$/),
      "12 días, antes 15",
      "5.0 h extra, antes 0.0",
      expect.stringMatching(/^Deducciones suben L\s100\.00$/),
    ]);
  });

  it("si sólo cambió el bruto, lo nombra como ingresos", () => {
    const r = revisarPlanilla([linea("a", 1300, { totalBruto: 2300 })], [linea("a", 1000, { totalBruto: 2000 })]);
    expect(r.cambios[0].motivos).toEqual([expect.stringMatching(/^Ingresos suben L\s300\.00$/)]);
  });

  it("marca los cambios grandes, incluso desde cero", () => {
    const r = revisarPlanilla([linea("a", 1260), linea("b", 1240), linea("c", 100)], [linea("a", 1000), linea("b", 1000), linea("c", 0)]);
    const grande = Object.fromEntries(r.cambios.map((c) => [c.empleadoId, c.grande]));
    expect(grande).toEqual({ a: true, b: false, c: true });
    expect(r.puntos.find((p) => p.clave === "cambio-grande")?.personas.map((p) => p.empleadoId)).toEqual(["a", "c"]);
  });
});

describe("revisarPlanilla: puntos por revisar", () => {
  it("señala neto en cero, deducciones altas, sin cuenta y sin correo", () => {
    const r = revisarPlanilla(
      [
        linea("cero", 0, { totalBruto: 1000, totalDeducciones: 1000 }),
        linea("negativo", -5, { totalBruto: 1000, totalDeducciones: 1005 }),
        linea("alta", 400, { totalBruto: 1000, totalDeducciones: 600 }),
        linea("mitad", 500, { totalBruto: 1000, totalDeducciones: 500 }),
        linea("nocuenta", 900, { tieneCuenta: false }),
        linea("nocorreo", 900, { tieneCorreo: false }),
      ],
      null
    );
    const de = (clave: string) => r.puntos.find((p) => p.clave === clave)?.personas.map((p) => p.empleadoId);
    expect(de("neto-cero")).toEqual(["cero", "negativo"]);
    expect(de("deducciones-altas")).toEqual(expect.arrayContaining(["alta", "cero", "negativo"]));
    expect(de("deducciones-altas")).not.toContain("mitad");
    expect(de("sin-cuenta")).toEqual(["nocuenta"]);
    expect(de("sin-correo")).toEqual(["nocorreo"]);
  });

  it("una planilla sin novedades no tiene puntos", () => {
    expect(revisarPlanilla([linea("a", 1000)], [linea("a", 1000)]).puntos).toEqual([]);
  });
});

describe("resumenDeRevision", () => {
  it("dice cuánto sube o baja", () => {
    expect(resumenDeRevision(revisarPlanilla([linea("a", 1100)], [linea("a", 1000)]))).toMatch(/el neto sube L\s100\.00\.$/);
    expect(resumenDeRevision(revisarPlanilla([linea("a", 9900)], [linea("a", 10000)]))).toMatch(/el neto baja L\s100\.00\.$/);
    expect(resumenDeRevision(revisarPlanilla([linea("a", 1000)], [linea("a", 1000)]))).toBe("Frente a la planilla anterior, el neto no cambia.");
  });

  it("cuenta los puntos, sin alarmar por la falta de un correo", () => {
    expect(resumenDeRevision(revisarPlanilla([linea("a", 1000, { tieneCuenta: false })], null))).toBe("Hay 1 punto por revisar.");
    expect(resumenDeRevision(revisarPlanilla([linea("a", 1000, { tieneCorreo: false })], null))).toBe("");
  });
});
