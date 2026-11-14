import { describe, it, expect } from "vitest";
import { revisarCambioEstado } from "./baja";

const INGRESO = new Date("2024-01-01");
const SALIDA = new Date("2027-01-15");

describe("inactivar", () => {
  it("exige la fecha de salida", () => {
    const r = revisarCambioEstado({ estadoActual: "ACTIVO", estadoNuevo: "INACTIVO", salidaActual: null, ingreso: INGRESO });
    expect(r.error).toContain("fecha de salida");
  });

  it("acepta la fecha que viene con el cambio y avisa que cierra el contrato", () => {
    const r = revisarCambioEstado({ estadoActual: "ACTIVO", estadoNuevo: "INACTIVO", salidaActual: null, salidaNueva: SALIDA, ingreso: INGRESO });
    expect(r.error).toBeUndefined();
    expect(r.seDaDeBaja).toBe(true);
    expect(r.salida).toEqual(SALIDA);
  });

  it("acepta una fecha que ya tenía", () => {
    expect(revisarCambioEstado({ estadoActual: "ACTIVO", estadoNuevo: "INACTIVO", salidaActual: SALIDA, ingreso: INGRESO }).error).toBeUndefined();
  });

  it("no acepta borrar la fecha de quien sigue inactivo", () => {
    expect(revisarCambioEstado({ estadoActual: "INACTIVO", salidaActual: SALIDA, salidaNueva: null, ingreso: INGRESO }).error).toContain("fecha de salida");
  });

  it("no acepta una salida anterior al ingreso", () => {
    const r = revisarCambioEstado({ estadoActual: "ACTIVO", estadoNuevo: "INACTIVO", salidaActual: null, salidaNueva: new Date("2023-01-01"), ingreso: INGRESO });
    expect(r.error).toContain("anterior");
  });
});

describe("otros cambios", () => {
  it("reincorporar borra la salida anterior", () => {
    const r = revisarCambioEstado({ estadoActual: "INACTIVO", estadoNuevo: "ACTIVO", salidaActual: SALIDA, ingreso: INGRESO });
    expect(r.limpiarSalida).toBe(true);
    expect(r.salida).toBeNull();
    expect(r.seDaDeBaja).toBe(false);
  });

  it("reincorporar con una fecha nueva respeta esa fecha", () => {
    const nueva = new Date("2027-06-30");
    const r = revisarCambioEstado({ estadoActual: "INACTIVO", estadoNuevo: "ACTIVO", salidaActual: SALIDA, salidaNueva: nueva, ingreso: INGRESO });
    expect(r.limpiarSalida).toBe(false);
    expect(r.salida).toEqual(nueva);
  });

  it("un inactivo antiguo sin fecha se puede seguir editando", () => {
    expect(revisarCambioEstado({ estadoActual: "INACTIVO", salidaActual: null, ingreso: INGRESO }).error).toBeUndefined();
  });

  it("vacaciones no pide fecha ni cierra el contrato", () => {
    const r = revisarCambioEstado({ estadoActual: "ACTIVO", estadoNuevo: "VACACIONES", salidaActual: null, ingreso: INGRESO });
    expect(r.error).toBeUndefined();
    expect(r.seDaDeBaja).toBe(false);
  });

  it("seguir inactivo no vuelve a cerrar el contrato", () => {
    expect(revisarCambioEstado({ estadoActual: "INACTIVO", estadoNuevo: "INACTIVO", salidaActual: SALIDA, ingreso: INGRESO }).seDaDeBaja).toBe(false);
  });
});
