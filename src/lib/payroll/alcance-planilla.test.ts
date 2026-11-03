import { describe, expect, it, vi } from "vitest";
import { accesoAPlanilla, alcanceCubreUnidad, filtroPlanillas, filtroPlanillasCompletas, rechazoDeAcceso } from "./alcance-planilla";

const SUPERVISOR = { alcance: "SUCURSAL" as const, sucursalesIds: ["s1"] };

/** Base falsa: la primera cuenta da los de dentro, la segunda los de fuera. */
function base(dentro: number, fuera: number) {
  const count = vi.fn().mockResolvedValueOnce(dentro).mockResolvedValueOnce(fuera);
  return { planillaDetalle: { count } } as never as { planillaDetalle: { count: typeof count } };
}

describe("accesoAPlanilla", () => {
  it("con alcance total no consulta nada", async () => {
    const db = base(0, 0);
    expect(await accesoAPlanilla(db as never, { alcance: "TODO" }, "p")).toBe("total");
    expect(db.planillaDetalle.count).not.toHaveBeenCalled();
  });

  it("sin nadie de su alcance, no tiene acceso", async () => {
    expect(await accesoAPlanilla(base(0, 5) as never, SUPERVISOR, "p")).toBe("ninguno");
  });

  it("una planilla vacía tampoco: falla cerrado", async () => {
    expect(await accesoAPlanilla(base(0, 0) as never, SUPERVISOR, "p")).toBe("ninguno");
  });

  it("con parte de la gente, sólo consulta", async () => {
    expect(await accesoAPlanilla(base(2, 3) as never, SUPERVISOR, "p")).toBe("parcial");
  });

  it("con toda la gente, puede actuar", async () => {
    expect(await accesoAPlanilla(base(4, 0) as never, SUPERVISOR, "p")).toBe("total");
  });
});

describe("rechazoDeAcceso", () => {
  it("deja pasar sólo el acceso total", () => {
    expect(rechazoDeAcceso("total")).toBeNull();
  });

  it("sin acceso responde que no existe", () => {
    expect(rechazoDeAcceso("ninguno")?.status).toBe(404);
  });

  it("con acceso parcial explica por qué", () => {
    expect(rechazoDeAcceso("parcial")?.status).toBe(403);
  });
});

describe("filtros de planillas", () => {
  it("con alcance total no filtran", () => {
    expect(filtroPlanillas({ alcance: "TODO" })).toEqual({});
    expect(filtroPlanillasCompletas({})).toEqual({});
  });

  it("con alcance limitado, las que pagan a alguien suyo", () => {
    expect(filtroPlanillas(SUPERVISOR)).toEqual({ detalles: { some: { empleado: { sucursalId: { in: ["s1"] } } } } });
  });

  it("para actuar, además, que no haya nadie de fuera", () => {
    const filtro = { empleado: { sucursalId: { in: ["s1"] } } };
    expect(filtroPlanillasCompletas(SUPERVISOR)).toEqual({ AND: [{ detalles: { some: filtro } }, { detalles: { none: { NOT: filtro } } }] });
  });
});

describe("alcanceCubreUnidad", () => {
  const unidad = { sucursalId: "s1", departamentoId: "d1" };

  it("con alcance total cubre cualquier unidad, también toda la empresa", () => {
    expect(alcanceCubreUnidad({ alcance: "TODO" }, { sucursalId: null, departamentoId: null })).toBe(true);
  });

  it("con alcance limitado, sólo lo suyo", () => {
    expect(alcanceCubreUnidad(SUPERVISOR, unidad)).toBe(true);
    expect(alcanceCubreUnidad({ alcance: "SUCURSAL", sucursalesIds: ["s2"] }, unidad)).toBe(false);
    expect(alcanceCubreUnidad({ alcance: "DEPARTAMENTO", departamentoId: "d1" }, unidad)).toBe(true);
    expect(alcanceCubreUnidad({ alcance: "DEPARTAMENTO", departamentoId: "d2" }, unidad)).toBe(false);
  });

  it("quien no alcanza a toda la empresa no genera la de toda la empresa", () => {
    expect(alcanceCubreUnidad(SUPERVISOR, { sucursalId: null, departamentoId: null })).toBe(false);
  });

  it("quien sólo alcanza su expediente no genera ninguna", () => {
    expect(alcanceCubreUnidad({ alcance: "PROPIO", empleadoId: "e1" }, unidad)).toBe(false);
  });
});
