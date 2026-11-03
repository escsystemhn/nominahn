import { describe, it, expect } from "vitest";
import { motivoParaNoDesactivarSucursal, motivoSucursalRepetida } from "./sucursales";

describe("desactivar una sucursal", () => {
  it("se puede si no tiene empleados y queda otra activa", () => {
    expect(motivoParaNoDesactivarSucursal({ empleadosVigentes: 0, otrasActivas: 1 })).toBeNull();
  });

  it("no se puede con empleados vigentes, y dice cuántos", () => {
    expect(motivoParaNoDesactivarSucursal({ empleadosVigentes: 1, otrasActivas: 3 })).toContain("1 empleado.");
    expect(motivoParaNoDesactivarSucursal({ empleadosVigentes: 4, otrasActivas: 3 })).toContain("4 empleados.");
  });

  it("no se puede si es la única activa", () => {
    expect(motivoParaNoDesactivarSucursal({ empleadosVigentes: 0, otrasActivas: 0 })).toContain("única sucursal activa");
  });
});

describe("sucursales repetidas", () => {
  const otras = [{ nombre: "Sede Central", codigo: "SC-001" }];

  it("acepta nombre y código nuevos", () => {
    expect(motivoSucursalRepetida({ nombre: "Choloma", codigo: "CHO-001" }, otras)).toBeNull();
    expect(motivoSucursalRepetida({ nombre: "Choloma", codigo: "CHO-001" }, [])).toBeNull();
  });

  it("rechaza el mismo nombre, sin mirar mayúsculas ni acentos", () => {
    expect(motivoSucursalRepetida({ nombre: "SÉDE  central", codigo: "X" }, otras)).toContain("llamada");
  });

  it("rechaza el mismo código", () => {
    expect(motivoSucursalRepetida({ nombre: "Otra", codigo: "sc-001" }, otras)).toContain("código");
  });
});
