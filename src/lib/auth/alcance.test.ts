import { describe, it, expect } from "vitest";
import { filtroEmpleados, filtroPorEmpleado, conAlcance, alcanzaEmpleado, alcanceEsTotal } from "./alcance";

const NINGUNA = { id: { in: [] } };

describe("filtroEmpleados", () => {
  it("TODO no restringe", () => {
    expect(filtroEmpleados({ alcance: "TODO" })).toEqual({});
  });

  it("sin alcance definido se comporta como TODO (compatibilidad)", () => {
    expect(filtroEmpleados({})).toEqual({});
  });

  it("SUCURSAL restringe a las asignadas", () => {
    expect(filtroEmpleados({ alcance: "SUCURSAL", sucursalesIds: ["s1", "s2"] })).toEqual({
      sucursalId: { in: ["s1", "s2"] },
    });
  });

  // El caso que decide si el sistema falla hacia abierto o hacia cerrado.
  it("SUCURSAL sin sucursales asignadas no ve NADA, no ve todo", () => {
    expect(filtroEmpleados({ alcance: "SUCURSAL", sucursalesIds: [] })).toEqual(NINGUNA);
    expect(filtroEmpleados({ alcance: "SUCURSAL" })).toEqual(NINGUNA);
    expect(filtroEmpleados({ alcance: "SUCURSAL", sucursalesIds: null })).toEqual(NINGUNA);
  });

  it("DEPARTAMENTO restringe al departamento del empleado vinculado", () => {
    expect(filtroEmpleados({ alcance: "DEPARTAMENTO", departamentoId: "d1" })).toEqual({
      departamentoId: "d1",
    });
  });

  it("DEPARTAMENTO sin empleado vinculado no ve nada", () => {
    expect(filtroEmpleados({ alcance: "DEPARTAMENTO" })).toEqual(NINGUNA);
  });

  it("PROPIO restringe al propio expediente", () => {
    expect(filtroEmpleados({ alcance: "PROPIO", empleadoId: "e1" })).toEqual({ id: "e1" });
  });

  it("PROPIO sin empleado vinculado no ve nada", () => {
    expect(filtroEmpleados({ alcance: "PROPIO", empleadoId: null })).toEqual(NINGUNA);
  });
});

describe("conAlcance", () => {
  it("con alcance TODO devuelve el where intacto", () => {
    const where = { estado: "ACTIVO" as const };
    expect(conAlcance(where, { alcance: "TODO" })).toBe(where);
  });

  /**
   * El motivo de que exista `conAlcance` en vez de fusionar objetos: un `where`
   * de búsqueda con `OR` fusionado por claves puede dejar el `sucursalId` fuera
   * de la disyunción y perder la restricción. El `AND` explícito no permite eso.
   */
  it("combina con AND y no deja que un OR de búsqueda anule la restricción", () => {
    const where = { OR: [{ codigo: { contains: "EMP" } }, { primerNombre: { contains: "EMP" } }] };
    const resultado = conAlcance(where, { alcance: "SUCURSAL", sucursalesIds: ["s1"] });

    expect(resultado).toEqual({ AND: [where, { sucursalId: { in: ["s1"] } }] });
    // La restricción sigue siendo una condición de primer nivel, no una rama del OR.
    expect(resultado.AND).toHaveLength(2);
  });

  it("un usuario sin sucursales asignadas no obtiene filas aunque busque", () => {
    const resultado = conAlcance({ estado: "ACTIVO" }, { alcance: "SUCURSAL", sucursalesIds: [] });
    expect(resultado).toEqual({ AND: [{ estado: "ACTIVO" }, NINGUNA] });
  });
});

describe("filtroPorEmpleado", () => {
  it("envuelve el filtro para entidades hijas", () => {
    expect(filtroPorEmpleado({ alcance: "SUCURSAL", sucursalesIds: ["s1"] })).toEqual({
      empleado: { sucursalId: { in: ["s1"] } },
    });
  });

  it("con alcance TODO no añade condición", () => {
    expect(filtroPorEmpleado({ alcance: "TODO" })).toEqual({});
  });
});

describe("alcanzaEmpleado", () => {
  const empleado = { id: "e1", sucursalId: "s1", departamentoId: "d1" };

  it("TODO alcanza a cualquiera", () => {
    expect(alcanzaEmpleado({ alcance: "TODO" }, empleado)).toBe(true);
  });

  it("SUCURSAL sólo dentro de las asignadas", () => {
    expect(alcanzaEmpleado({ alcance: "SUCURSAL", sucursalesIds: ["s1"] }, empleado)).toBe(true);
    expect(alcanzaEmpleado({ alcance: "SUCURSAL", sucursalesIds: ["s2"] }, empleado)).toBe(false);
    expect(alcanzaEmpleado({ alcance: "SUCURSAL", sucursalesIds: [] }, empleado)).toBe(false);
  });

  it("DEPARTAMENTO exige coincidencia y empleado vinculado", () => {
    expect(alcanzaEmpleado({ alcance: "DEPARTAMENTO", departamentoId: "d1" }, empleado)).toBe(true);
    expect(alcanzaEmpleado({ alcance: "DEPARTAMENTO", departamentoId: "d2" }, empleado)).toBe(false);
    expect(alcanzaEmpleado({ alcance: "DEPARTAMENTO" }, empleado)).toBe(false);
  });

  it("PROPIO sólo el propio expediente", () => {
    expect(alcanzaEmpleado({ alcance: "PROPIO", empleadoId: "e1" }, empleado)).toBe(true);
    expect(alcanzaEmpleado({ alcance: "PROPIO", empleadoId: "e2" }, empleado)).toBe(false);
    expect(alcanzaEmpleado({ alcance: "PROPIO", empleadoId: null }, empleado)).toBe(false);
  });
});

describe("alcanceEsTotal", () => {
  it("distingue TODO del resto", () => {
    expect(alcanceEsTotal({ alcance: "TODO" })).toBe(true);
    expect(alcanceEsTotal({})).toBe(true);
    expect(alcanceEsTotal({ alcance: "SUCURSAL", sucursalesIds: ["s1"] })).toBe(false);
  });
});
