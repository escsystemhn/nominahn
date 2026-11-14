import { describe, expect, it } from "vitest";
import { describirLugares, lugaresParaDepartamento, lugaresSinDepartamento, mensajeCreacion } from "./destinos-departamento";

// Como la base de Edbin: un grupo con 3 empresas (una inactiva), otro con 2, y uno sin empresas.
const sucursales = [
  { id: "pagsa", activa: true },
  { id: "conf", activa: true },
  { id: "prasa", activa: true },
  { id: "vieja", activa: false },
];
const divisiones = [
  { id: "sps", sucursalId: "pagsa", activa: true },
  { id: "tgu", sucursalId: "pagsa", activa: true },
  { id: "ceiba", sucursalId: "pagsa", activa: false },
  { id: "mayoreo", sucursalId: "conf", activa: true },
  { id: "electro", sucursalId: "conf", activa: true },
  { id: "suelta", sucursalId: "vieja", activa: true },
];
const nombres = {
  sucursal: new Map([["pagsa", "Grupo PAGSA"], ["conf", "Confidencial"], ["prasa", "PRASA"]]),
  division: new Map([["sps", "San Pedro Sula"], ["tgu", "Tegucigalpa"], ["mayoreo", "MAYOREO"], ["electro", "ELECTRONICA"]]),
};
const palabras = { sucursal: "grupo", sucursales: "grupos", division: "empresa", divisiones: "empresas" };

describe("lugaresParaDepartamento", () => {
  it("toma cada empresa activa de cada grupo activo, y el grupo sin empresas directo", () => {
    expect(lugaresParaDepartamento(sucursales, divisiones)).toEqual([
      { sucursalId: "pagsa", divisionId: "sps" },
      { sucursalId: "pagsa", divisionId: "tgu" },
      { sucursalId: "conf", divisionId: "mayoreo" },
      { sucursalId: "conf", divisionId: "electro" },
      { sucursalId: "prasa", divisionId: null },
    ]);
  });

  it("se limita a un grupo", () => {
    expect(lugaresParaDepartamento(sucursales, divisiones, "conf").map((l) => l.divisionId)).toEqual(["mayoreo", "electro"]);
    expect(lugaresParaDepartamento(sucursales, divisiones, "vieja")).toEqual([]);
  });

  it("con las divisiones apagadas, cada sucursal activa es un lugar", () => {
    expect(lugaresParaDepartamento(sucursales, [])).toEqual([
      { sucursalId: "pagsa", divisionId: null },
      { sucursalId: "conf", divisionId: null },
      { sucursalId: "prasa", divisionId: null },
    ]);
  });

  it("un grupo cuyas empresas están todas inactivas recibe el departamento directo", () => {
    expect(lugaresParaDepartamento([{ id: "x", activa: true }], [{ id: "y", sucursalId: "x", activa: false }])).toEqual([{ sucursalId: "x", divisionId: null }]);
  });
});

describe("lugaresSinDepartamento", () => {
  const existentes = [
    { nombre: "Ventas", sucursalId: "pagsa", divisionId: "tgu" },
    { nombre: "Administración", sucursalId: "prasa", divisionId: null },
    // Mismo nombre de empresa en otro grupo: no la ocupa.
    { nombre: "Ventas", sucursalId: "conf", divisionId: "otra" },
  ];
  const todos = lugaresParaDepartamento(sucursales, divisiones);

  it("salta donde ya existe y crea en el resto", () => {
    const r = lugaresSinDepartamento("ventas", todos, existentes);
    expect(r.omitir).toEqual([{ sucursalId: "pagsa", divisionId: "tgu" }]);
    expect(r.crear).toHaveLength(4);
  });

  it("compara sin acentos ni mayúsculas, también en un grupo sin empresas", () => {
    expect(lugaresSinDepartamento("  ADMINISTRACION ", todos, existentes).omitir).toEqual([{ sucursalId: "prasa", divisionId: null }]);
  });

  it("un destino repetido cuenta una vez", () => {
    const r = lugaresSinDepartamento("Nuevo", [{ sucursalId: "pagsa", divisionId: "sps" }, { sucursalId: "pagsa", divisionId: "sps" }], existentes);
    expect(r).toEqual({ crear: [{ sucursalId: "pagsa", divisionId: "sps" }], omitir: [] });
  });

  it("un nombre vacío no choca con nada", () => {
    expect(lugaresSinDepartamento("  ", [{ sucursalId: "prasa", divisionId: null }], [{ nombre: "", sucursalId: "prasa", divisionId: null }]).omitir).toEqual([]);
  });
});

describe("describirLugares y mensajeCreacion", () => {
  it("un solo lugar: grupo / empresa, o el grupo si no tiene empresas", () => {
    expect(describirLugares([{ sucursalId: "pagsa", divisionId: "tgu" }], nombres, palabras)).toBe("Grupo PAGSA / Tegucigalpa");
    expect(describirLugares([{ sucursalId: "prasa", divisionId: null }], nombres, palabras)).toBe("PRASA");
  });

  it("varias empresas de un grupo, con «las» cuando son todas", () => {
    const dos = lugaresParaDepartamento(sucursales, divisiones, "pagsa");
    expect(describirLugares(dos, nombres, palabras, true)).toBe("las 2 empresas de Grupo PAGSA: San Pedro Sula y Tegucigalpa");
    expect(describirLugares(dos, nombres, palabras)).toBe("2 empresas de Grupo PAGSA: San Pedro Sula y Tegucigalpa");
  });

  it("varios grupos: cuenta por grupo", () => {
    const todos = lugaresParaDepartamento(sucursales, divisiones);
    expect(describirLugares(todos, nombres, palabras)).toBe("3 grupos: Grupo PAGSA (2 empresas), Confidencial (2 empresas) y PRASA");
    expect(describirLugares([{ sucursalId: "pagsa", divisionId: "sps" }, { sucursalId: "conf", divisionId: "mayoreo" }], nombres, palabras))
      .toBe("2 grupos: Grupo PAGSA (San Pedro Sula) y Confidencial (MAYOREO)");
  });

  it("el aviso dice dónde se creó y dónde ya existía", () => {
    expect(mensajeCreacion(" Compras ", [{ sucursalId: "pagsa", divisionId: "sps" }], [{ sucursalId: "pagsa", divisionId: "tgu" }], nombres, palabras, true))
      .toBe("Se creó «Compras» en Grupo PAGSA / San Pedro Sula. Ya existía en Tegucigalpa, y ahí no se tocó.");
    expect(mensajeCreacion("Compras", lugaresParaDepartamento(sucursales, divisiones, "conf"), [], nombres, palabras, true))
      .toBe("Se creó «Compras» en las 2 empresas de Confidencial: MAYOREO y ELECTRONICA.");
  });
});
