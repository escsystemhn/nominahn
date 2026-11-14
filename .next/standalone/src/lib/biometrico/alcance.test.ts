import { describe, it, expect } from "vitest";
import { alcanzaDispositivo, filtroEventos, filtroDispositivos } from "./alcance";

describe("filtroEventos", () => {
  it("con alcance TODO no acota nada", () => {
    expect(filtroEventos({ alcance: "TODO" })).toEqual({});
    expect(filtroEventos({})).toEqual({});
  });

  it("con alcance SUCURSAL suma las marcas sin dueño de sus equipos", () => {
    expect(filtroEventos({ alcance: "SUCURSAL", sucursalesIds: ["a"] })).toEqual({
      OR: [
        { empleado: { sucursalId: { in: ["a"] } } },
        { empleadoId: null, dispositivo: { sucursalId: { in: ["a"] } } },
      ],
    });
  });

  it("sin sucursales asignadas cierra, también para las marcas sin dueño", () => {
    expect(filtroEventos({ alcance: "SUCURSAL", sucursalesIds: [] })).toEqual({ empleado: { id: { in: [] } } });
  });

  it("departamento y expediente propio no ven marcas sin dueño", () => {
    expect(filtroEventos({ alcance: "DEPARTAMENTO", departamentoId: "d" })).toEqual({ empleado: { departamentoId: "d" } });
    expect(filtroEventos({ alcance: "PROPIO", empleadoId: "e" })).toEqual({ empleado: { id: "e" } });
  });
});

describe("alcanzaDispositivo", () => {
  it("con alcance TODO alcanza cualquier equipo, tenga sucursal o no", () => {
    expect(alcanzaDispositivo({ alcance: "TODO" }, { sucursalId: "a" })).toBe(true);
    expect(alcanzaDispositivo({}, { sucursalId: null })).toBe(true);
  });

  it("con alcance SUCURSAL sólo alcanza los equipos de sus sucursales", () => {
    const usuario = { alcance: "SUCURSAL" as const, sucursalesIds: ["a"] };
    expect(alcanzaDispositivo(usuario, { sucursalId: "a" })).toBe(true);
    expect(alcanzaDispositivo(usuario, { sucursalId: "b" })).toBe(false);
    expect(alcanzaDispositivo(usuario, { sucursalId: null })).toBe(false);
  });

  it("departamento y expediente propio no concilian marcas sin dueño", () => {
    expect(alcanzaDispositivo({ alcance: "DEPARTAMENTO", departamentoId: "d" }, { sucursalId: "a" })).toBe(false);
    expect(alcanzaDispositivo({ alcance: "PROPIO", empleadoId: "e" }, { sucursalId: "a" })).toBe(false);
  });
});

describe("filtroDispositivos", () => {
  it("con alcance total los ve todos", () => {
    expect(filtroDispositivos({ alcance: "TODO" })).toEqual({});
  });

  it("con alcance de sucursal, sólo los de sus sucursales: uno sin sucursal no entra", () => {
    expect(filtroDispositivos({ alcance: "SUCURSAL", sucursalesIds: ["s1"] })).toEqual({ sucursalId: { in: ["s1"] } });
  });

  it("los demás alcances no administran equipos", () => {
    expect(filtroDispositivos({ alcance: "DEPARTAMENTO", departamentoId: "d1" })).toEqual({ sucursalId: { in: [] } });
    expect(filtroDispositivos({ alcance: "PROPIO", empleadoId: "e1" })).toEqual({ sucursalId: { in: [] } });
  });
});
