import { describe, it, expect } from "vitest";
import {
  agruparPorEstructura,
  aplanarEstructura,
  describirAlcance,
  etiquetaDepartamento,
  filtroDetallesOrg,
  filtroEmpleadosOrg,
  normalizarAlcance,
  SIN_DIVISION,
  ALCANCE_TOTAL,
  type Ubicacion,
} from "./estructura";

/** El ejemplo del cliente: una nómina confidencial con dos empresas (divisiones). */
const CONF = { id: "conf", nombre: "NOMINA CONFIDENCIAL" };
const MAY = { id: "may", nombre: "PAGSA MAYOREO" };
const TGU = { id: "tgu", nombre: "PAGSA TEGUCIGALPA" };
const u = (division: typeof MAY | null, departamento: string, depId: string): Ubicacion =>
  ({ sucursal: CONF, division, departamento: { id: depId, nombre: departamento } });

const PERSONAS: Array<{ nombre: string; ubicacion: Ubicacion }> = [
  { nombre: "GONZALO CARIAS", ubicacion: u(TGU, "Ventas", "tgu-ven") },
  { nombre: "JUAN PEREZ", ubicacion: u(MAY, "Administracion", "may-adm") },
  { nombre: "ROGER FLORES", ubicacion: u(TGU, "Administracion", "tgu-adm") },
  { nombre: "FIDEL BULNES", ubicacion: u(MAY, "Ventas", "may-ven") },
  { nombre: "CARLOS MEJIA", ubicacion: u(MAY, "Administracion", "may-adm") },
  { nombre: "MARIA MEDINA", ubicacion: u(TGU, "Administracion", "tgu-adm") },
];

describe("agrupación Sucursal → División → Departamento", () => {
  const arbol = agruparPorEstructura(PERSONAS, (p) => p.ubicacion);

  it("reproduce la jerarquía del requerimiento", () => {
    const texto = aplanarEstructura(arbol, false).map((e) =>
      "  ".repeat(e.nivel) + (e.tipo === "detalle" ? e.item.nombre : e.grupo.nombre)
    );
    expect(texto).toEqual([
      "NOMINA CONFIDENCIAL",
      "  PAGSA MAYOREO",
      "    Administracion",
      "      JUAN PEREZ",
      "      CARLOS MEJIA",
      "    Ventas",
      "      FIDEL BULNES",
      "  PAGSA TEGUCIGALPA",
      "    Administracion",
      "      ROGER FLORES",
      "      MARIA MEDINA",
      "    Ventas",
      "      GONZALO CARIAS",
    ]);
  });

  it("cada grupo conoce todo lo que tiene debajo, para sus subtotales", () => {
    expect(arbol[0].items).toHaveLength(6);
    expect(arbol[0].hijos.map((d) => [d.nombre, d.items.length])).toEqual([["PAGSA MAYOREO", 3], ["PAGSA TEGUCIGALPA", 3]]);
  });

  it("el subtotal cierra cada grupo, de adentro hacia afuera", () => {
    const fin = aplanarEstructura(arbol).slice(-4).map((e) => `${e.tipo} ${e.nivel} ${e.tipo === "detalle" ? e.item.nombre : e.grupo.nombre}`);
    expect(fin).toEqual([
      "detalle 3 GONZALO CARIAS",
      "subtotal 2 Ventas",
      "subtotal 1 PAGSA TEGUCIGALPA",
      "subtotal 0 NOMINA CONFIDENCIAL",
    ]);
  });

  it("sin divisiones, el nivel no aparece: Sucursal → Departamento como antes", () => {
    const sinDiv = PERSONAS.map((p) => ({ ...p, ubicacion: { ...p.ubicacion, division: null } }));
    const g = agruparPorEstructura(sinDiv, (p) => p.ubicacion);
    expect(g[0].hijos.map((h) => h.nivel)).toEqual(["DEPARTAMENTO", "DEPARTAMENTO", "DEPARTAMENTO", "DEPARTAMENTO"]);
    expect(aplanarEstructura(g, false).find((e) => e.tipo === "detalle")?.nivel).toBe(2);
  });

  it("si en una sucursal sólo algunos tienen división, el resto va a «Sin división», al final", () => {
    const mezcla = [...PERSONAS, { nombre: "ANA SUELTA", ubicacion: u(null, "Bodega", "bod") }];
    const hijos = agruparPorEstructura(mezcla, (p) => p.ubicacion)[0].hijos;
    expect(hijos.map((h) => h.nombre)).toEqual(["PAGSA MAYOREO", "PAGSA TEGUCIGALPA", SIN_DIVISION]);
    expect(hijos[2].id).toBeNull();
  });
});

describe("filtros por alcance organizacional", () => {
  it("normaliza lo que llega de un formulario", () => {
    expect(normalizarAlcance({ sucursalId: "", divisionId: undefined, departamentoId: " d1 " })).toEqual({ sucursalId: null, divisionId: null, departamentoId: "d1" });
  });

  it("alcance total = sin condición", () => {
    expect(filtroEmpleadosOrg(ALCANCE_TOTAL)).toEqual({});
    expect(filtroDetallesOrg(ALCANCE_TOTAL)).toEqual({});
  });

  it("aplica los tres niveles a la vez (antes, con sucursal se perdía el departamento)", () => {
    expect(filtroEmpleadosOrg({ sucursalId: "s", divisionId: "v", departamentoId: "d" })).toEqual({
      AND: [{ sucursalId: "s" }, { departamento: { divisionId: "v" } }, { departamentoId: "d" }],
    });
  });

  it("en las líneas de planilla usa dónde estaba la persona al pagarse, y la actual sólo en líneas viejas", () => {
    expect(filtroDetallesOrg({ sucursalId: null, divisionId: "v", departamentoId: null })).toEqual({
      AND: [{ OR: [{ divisionId: "v" }, { departamentoId: null, empleado: { departamento: { divisionId: "v" } } }] }],
    });
  });
});

describe("textos", () => {
  it("describe el alcance de una planilla", () => {
    expect(describirAlcance({})).toBe("Toda la empresa");
    expect(describirAlcance({ sucursal: CONF, division: MAY, departamento: null })).toBe("NOMINA CONFIDENCIAL / PAGSA MAYOREO");
  });

  it("distingue departamentos homónimos", () => {
    expect(etiquetaDepartamento({ nombre: "Ventas", division: TGU, sucursal: CONF })).toBe("Ventas (PAGSA TEGUCIGALPA, NOMINA CONFIDENCIAL)");
    expect(etiquetaDepartamento({ nombre: "Ventas", division: null, sucursal: CONF })).toBe("Ventas (NOMINA CONFIDENCIAL)");
  });
});
