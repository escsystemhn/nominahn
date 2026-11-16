import { describe, expect, it } from "vitest";
import { motivoParaNoEliminarDepartamento, motivoParaNoEliminarSucursal, motivoParaNoMoverDivision } from "./eliminar";

const libreS = { empleados: 0, divisiones: 0, departamentos: 0, planillas: 0, lineasPlanilla: 0, traslados: 0 };
const libreD = { empleados: 0, puestos: 0, vacantes: 0, planillas: 0, lineasPlanilla: 0 };

describe("eliminar un grupo o sucursal", () => {
  it("vacía, se puede", () => expect(motivoParaNoEliminarSucursal(libreS)).toBeNull());
  it("con empleados, divisiones, departamentos, planillas o traslados, no; el empleado manda", () => {
    expect(motivoParaNoEliminarSucursal({ ...libreS, empleados: 1, departamentos: 2 })).toMatch(/tiene 1 empleado\./);
    expect(motivoParaNoEliminarSucursal({ ...libreS, divisiones: 2 })).toMatch(/2 empresas o divisiones/);
    expect(motivoParaNoEliminarSucursal({ ...libreS, departamentos: 1 })).toMatch(/1 departamento\./);
    expect(motivoParaNoEliminarSucursal({ ...libreS, lineasPlanilla: 3 })).toMatch(/planillas emitidas/);
    expect(motivoParaNoEliminarSucursal({ ...libreS, traslados: 1 })).toMatch(/traslados/);
  });
});

describe("eliminar un departamento", () => {
  it("vacío, se puede", () => expect(motivoParaNoEliminarDepartamento(libreD)).toBeNull());
  it("con empleados, puestos, vacantes o planillas, no", () => {
    expect(motivoParaNoEliminarDepartamento({ ...libreD, empleados: 4, puestos: 2 })).toMatch(/4 empleados/);
    expect(motivoParaNoEliminarDepartamento({ ...libreD, puestos: 1 })).toMatch(/1 puesto\. Elimínelos primero/);
    expect(motivoParaNoEliminarDepartamento({ ...libreD, vacantes: 1 })).toMatch(/Reclutamiento/);
    expect(motivoParaNoEliminarDepartamento({ ...libreD, planillas: 1 })).toMatch(/planillas emitidas/);
  });
});

describe("mover una empresa de grupo", () => {
  it("sin planillas, se puede", () => expect(motivoParaNoMoverDivision({ planillas: 0, lineasPlanilla: 0, coberturasPuestos: 0 })).toBeNull());
  it("con planillas o líneas de planilla, no", () => {
    expect(motivoParaNoMoverDivision({ planillas: 1, lineasPlanilla: 0, coberturasPuestos: 0 })).toMatch(/ya tiene planillas/);
    expect(motivoParaNoMoverDivision({ planillas: 0, lineasPlanilla: 5, coberturasPuestos: 0 })).toMatch(/ya tiene planillas/);
  });
  it("con cobertura de horarios de sus puestos en el grupo actual, no", () => {
    expect(motivoParaNoMoverDivision({ planillas: 0, lineasPlanilla: 0, coberturasPuestos: 2 })).toMatch(/cobertura de horarios/);
  });
});
