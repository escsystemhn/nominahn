import { describe, it, expect } from "vitest";
import {
  accionesDisponibles,
  motivoOmitida,
  nombresDeUnidades,
  repartirLote,
  unidadesSinPlanilla,
  unirNombres,
  type EmpleadoDelPeriodo,
  type PlanillaDelPeriodo,
} from "@/lib/payroll/lote-planillas";

describe("acciones por lote (fase 2, 2026-11-24)", () => {
  const marcadas = [
    { id: "a", estado: "BORRADOR" as const, neto: 1000.1 },
    { id: "b", estado: "BORRADOR" as const, neto: 2000.2 },
    { id: "c", estado: "CALCULADA" as const, neto: 500 },
    { id: "d", estado: "APROBADA" as const, neto: 700 },
    { id: "e", estado: "PAGADA" as const, neto: 900 },
  ];

  it("confirmar toma los borradores, suma su neto al centavo y dice por qué omite los demás", () => {
    const r = repartirLote("confirmar", marcadas);
    expect(r.van.map((m) => m.id)).toEqual(["a", "b"]);
    expect(r.neto).toBe(3000.3);
    expect(r.omitidas.map((m) => [m.id, m.motivo])).toEqual([
      ["c", "ya está confirmada"], ["d", "ya está aprobada"], ["e", "ya está pagada"],
    ]);
  });

  it("aprobar sólo las confirmadas; pagar sólo las aprobadas", () => {
    expect(repartirLote("aprobar", marcadas).van.map((m) => m.id)).toEqual(["c"]);
    expect(motivoOmitida("aprobar", "BORRADOR")).toBe("todavía está en borrador");
    expect(repartirLote("pagar", marcadas).van.map((m) => m.id)).toEqual(["d"]);
    expect(motivoOmitida("pagar", "CALCULADA")).toBe("todavía no está aprobada");
    expect(motivoOmitida("pagar", "ANULADA")).toBe("está anulada");
  });

  it("la barra ofrece sólo lo que la cuenta puede hacer y tiene algo que hacer", () => {
    expect(accionesDisponibles(marcadas, ["planillas.calcular", "planillas.aprobar", "planillas.pagar"])).toEqual([
      { accion: "recalcular", cuantas: 2 }, { accion: "confirmar", cuantas: 2 }, { accion: "aprobar", cuantas: 1 }, { accion: "pagar", cuantas: 1 },
    ]);
    // Quien aprueba no paga: separación de funciones.
    expect(accionesDisponibles(marcadas, ["planillas.aprobar"]).map((x) => x.accion)).toEqual(["aprobar"]);
    expect(accionesDisponibles([{ id: "x", estado: "PAGADA", neto: 1 }], ["planillas.calcular", "planillas.aprobar", "planillas.pagar"])).toEqual([]);
  });

  it("une los nombres como se dicen", () => {
    expect(unirNombres([])).toBe("");
    expect(unirNombres(["Norte"])).toBe("Norte");
    expect(unirNombres(["Norte", "Sur"])).toBe("Norte y Sur");
    expect(unirNombres(["Centro", "Norte", "Sur"])).toBe("Centro, Norte y Sur");
  });
});

describe("sucursales sin planilla en un período", () => {
  const emp = (id: string, divisionId: string | null, division: string | null, sucursalId = "g1", sucursal = "Grupo Uno"): EmpleadoDelPeriodo =>
    ({ id, empresaId: "e1", sucursalId, sucursal, divisionId, division });
  const empleados = [
    emp("1", "dN", "Norte"), emp("2", "dN", "Norte"),
    emp("3", "dS", "Sur"), emp("4", "dS", "Sur"),
    emp("5", "dC", "Centro"),
    emp("6", null, null, "g2", "Grupo Dos"),
  ];
  const planillas: PlanillaDelPeriodo[] = [
    { id: "pN", estado: "BORRADOR", empresaId: "e1", sucursalId: "g1", divisionId: "dN", departamentoId: null },
  ];

  it("agrupa a quien no está en ninguna planilla por su sucursal; si la sucursal ya tiene la suya, son personas que quedaron fuera", () => {
    // 1 está en la planilla de Norte; 2 entró después.
    const u = unidadesSinPlanilla(empleados, new Set(["1"]), planillas, true);
    expect(u.map((x) => [x.grupo, x.nombre, x.empleados, x.planilla?.id ?? null])).toEqual([
      ["Grupo Dos", "Grupo Dos", 1, null],
      ["Grupo Uno", "Centro", 1, null],
      ["Grupo Uno", "Norte", 1, "pN"],
      ["Grupo Uno", "Sur", 2, null],
    ]);
    expect(u.find((x) => x.nombre === "Sur")).toMatchObject({ empresaId: "e1", sucursalId: "g1", divisionId: "dS" });
  });

  it("sin el nivel División, la unidad es el grupo", () => {
    const u = unidadesSinPlanilla(empleados, new Set(), [], false);
    expect(u.map((x) => [x.nombre, x.empleados, x.divisionId])).toEqual([["Grupo Dos", 1, null], ["Grupo Uno", 5, null]]);
  });

  it("todos en alguna planilla: no falta nada, sea cual sea el alcance de esa planilla", () => {
    expect(unidadesSinPlanilla(empleados, new Set(empleados.map((e) => e.id)), [], true)).toEqual([]);
  });

  it("los nombres llevan el grupo sólo si hay más de uno", () => {
    const u = unidadesSinPlanilla(empleados, new Set(), [], true);
    expect(nombresDeUnidades(u)).toEqual(["Grupo Dos", "Grupo Uno / Centro", "Grupo Uno / Norte", "Grupo Uno / Sur"]);
    expect(nombresDeUnidades(u.filter((x) => x.grupo === "Grupo Uno"))).toEqual(["Centro", "Norte", "Sur"]);
  });
});
