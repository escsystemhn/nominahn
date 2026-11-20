import { describe, expect, it } from "vitest";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { formatoRtn, leerDetalle, tablaEstructura, type DatosEstructura, type EmpleadoEst } from "./estructura-organizacional";

const niveles = etiquetasNiveles(true);

const emp = (codigo: string, nombre: string, departamentoId: string, puestoId: string | null = null): EmpleadoEst => ({
  codigo, nombre, departamentoId, puestoId, frecuencia: "Quincenal", ingreso: "01/02/2024", estado: "Activo",
  identidad: "0801199012345", salario: "L 20,000.00",
});

// Dos grupos genéricos: Norte (con dos sucursales y un departamento sin sucursal) y Sur.
const datos: DatosEstructura = {
  grupos: [
    { id: "gs", nombre: "Grupo Sur", codigo: "SUR", rtn: null, activo: true },
    { id: "gn", nombre: "Grupo Norte", codigo: "NOR", rtn: "05011999000099", activo: true },
    { id: "gx", nombre: "Grupo Cerrado", codigo: "CER", rtn: null, activo: false },
  ],
  divisiones: [
    { id: "s2", nombre: "Sucursal Oeste", codigo: "OES", rtn: "08011999000011", sucursalId: "gn", activo: true },
    { id: "s1", nombre: "Sucursal Centro", codigo: "CEN", rtn: null, sucursalId: "gn", activo: true },
    { id: "s3", nombre: "Sucursal Sur", codigo: "SS", rtn: null, sucursalId: "gs", activo: true },
  ],
  departamentos: [
    { id: "d1", nombre: "Ventas", codigo: "VEN", sucursalId: "gn", divisionId: "s1", activo: true },
    { id: "d2", nombre: "Bodega", codigo: null, sucursalId: "gn", divisionId: "s1", activo: true },
    { id: "d3", nombre: "Caja", codigo: null, sucursalId: "gn", divisionId: "s2", activo: true },
    { id: "d4", nombre: "Gerencia", codigo: null, sucursalId: "gn", divisionId: null, activo: true },
    { id: "d5", nombre: "Viejo sin gente", codigo: null, sucursalId: "gn", divisionId: "s1", activo: false },
    { id: "d6", nombre: "Viejo con gente", codigo: null, sucursalId: "gs", divisionId: "s3", activo: false },
  ],
  puestos: [
    { id: "p1", nombre: "Vendedor", departamentoId: "d1", activo: true },
    { id: "p2", nombre: "Supervisor", departamentoId: "d1", activo: true },
    { id: "p3", nombre: "Retirado", departamentoId: "d1", activo: false },
  ],
  empleados: [
    emp("E3", "Carla Paz", "d1", "p1"),
    emp("E1", "Ana López", "d1", "p1"),
    emp("E2", "Beto Ruiz", "d1", null),
    emp("E4", "Dina Mejía", "d3"),
    emp("E5", "Elsa Cruz", "d4"),
    emp("E6", "Fito Gómez", "d6"),
  ],
};

const primera = (t: { datos: string[][] }) => t.datos.map((f) => f[0]);

describe("estructura por grupos y sucursales", () => {
  it("árbol ordenado por nombre, con sus conteos, y el total general al final", () => {
    const t = tablaEstructura(datos, { detalle: "departamentos", niveles, conDivisiones: true, vePII: false });
    expect(t.cabeceras).toEqual(["Grupo / Sucursal / Departamento", "Código", "RTN", "Departamentos", "Puestos", "Empleados"]);
    expect(primera(t)).toEqual([
      "Grupo Norte", "Sucursal Centro", "Bodega", "Ventas", "Sucursal Oeste", "Caja", "Sin sucursal asignada", "Gerencia",
      "Grupo Sur", "Sucursal Sur", "Viejo con gente",
      "TOTAL GENERAL",
    ]);
    expect(t.datos[0]).toEqual(["Grupo Norte", "NOR", "0501-1999-000099", "4", "2", "5"]);
    expect(t.filas.slice(0, 3)).toEqual([{ tipo: "grupo", nivel: 0 }, { tipo: "grupo", nivel: 1 }, { tipo: "detalle", nivel: 2 }]);
    expect(t.datos.at(-1)).toEqual(["TOTAL GENERAL", "", "", "5", "2", "6"]);
    expect(t.totales).toEqual({ grupos: 2, divisiones: 3, departamentos: 5, puestos: 2, empleados: 6 });
  });

  it("lo inactivo sólo aparece si todavía tiene gente", () => {
    const t = tablaEstructura(datos, { detalle: "departamentos", niveles, conDivisiones: true, vePII: false });
    expect(primera(t)).not.toContain("Viejo sin gente");
    expect(primera(t)).not.toContain("Grupo Cerrado");
    expect(primera(t)).toContain("Viejo con gente");
  });

  it("la sucursal sin RTN propio dice que usa el del grupo", () => {
    const t = tablaEstructura(datos, { detalle: "departamentos", niveles, conDivisiones: true, vePII: false });
    const fila = (n: string) => t.datos.find((f) => f[0] === n)!;
    expect(fila("Sucursal Centro")[2]).toBe("0501-1999-000099 (del grupo)");
    expect(fila("Sucursal Oeste")[2]).toBe("0801-1999-000011");
    expect(fila("Sucursal Sur")[2]).toBe("");
  });

  it("con puestos: cada puesto activo con su gente y quien no tiene puesto aparte", () => {
    const t = tablaEstructura(datos, { detalle: "puestos", niveles, conDivisiones: true, vePII: false });
    const i = t.datos.findIndex((f) => f[0] === "Ventas");
    expect(t.filas[i]).toEqual({ tipo: "grupo", nivel: 2 });
    expect(t.datos.slice(i + 1, i + 4).map((f) => [f[0], f[5]])).toEqual([["Supervisor", "0"], ["Vendedor", "2"], ["Sin puesto asignado", "1"]]);
    expect(t.filas[i + 1]).toEqual({ tipo: "detalle", nivel: 3 });
  });

  it("con empleados: cada persona bajo su departamento, y la identidad y el salario sólo con permiso", () => {
    const sin = tablaEstructura(datos, { detalle: "empleados", niveles, conDivisiones: true, vePII: false });
    expect(sin.cabeceras).toEqual(["Grupo / Sucursal / Departamento / Empleado", "Código", "Puesto", "Frecuencia", "Ingreso", "Estado"]);
    expect(sin.datos[0][0]).toBe("Grupo Norte · RTN 0501-1999-000099 · 5 empleados");
    const i = sin.datos.findIndex((f) => f[0] === "Ventas · 3 empleados");
    expect(sin.datos.slice(i + 1, i + 4).map((f) => f[0])).toEqual(["Ana López", "Beto Ruiz", "Carla Paz"]);
    expect(sin.datos[i + 2][2]).toBe("Sin puesto");
    expect(sin.datos.find((f) => f[0] === "Bodega · sin empleados")).toBeTruthy();

    const con = tablaEstructura(datos, { detalle: "empleados", niveles, conDivisiones: true, vePII: true });
    expect(con.cabeceras.slice(-2)).toEqual(["Identidad", "Salario base"]);
    expect(con.datos.find((f) => f[0] === "Ana López")!.slice(-2)).toEqual(["0801-1990-12345", "L 20,000.00"]);
    expect(con.datos.at(-1)).toEqual(["TOTAL GENERAL", "", "", "", "", "", "", "6 empleados"]);
  });

  it("con varios grupos: resumen primero y una hoja por grupo, cada una con su total", () => {
    const t = tablaEstructura(datos, { detalle: "departamentos", niveles, conDivisiones: true, vePII: false });
    expect(t.hojas!.map((h) => h.pestana)).toEqual(["Resumen", "Grupo Norte", "Grupo Sur"]);
    expect(t.hojas![0].datos.map((f) => f[0])).toEqual(["Grupo Norte", "Sucursal Centro", "Sucursal Oeste", "Sin sucursal asignada", "Grupo Sur", "Sucursal Sur", "TOTAL GENERAL"]);
    expect(t.hojas![1].nombre).toBe("Grupo Norte, RTN 0501-1999-000099");
    expect(t.hojas![1].datos.at(-1)).toEqual(["TOTAL Grupo Norte", "", "", "4", "2", "5"]);
    const uno = tablaEstructura({ ...datos, grupos: datos.grupos.filter((g) => g.id === "gn") }, { detalle: "departamentos", niveles, conDivisiones: true, vePII: false });
    expect(uno.hojas).toBeUndefined();
  });

  it("sin divisiones: sucursal → departamento, con las palabras de siempre", () => {
    const t = tablaEstructura(datos, { detalle: "departamentos", niveles: etiquetasNiveles(false), conDivisiones: false, vePII: false });
    expect(t.titulo).toBe("Estructura por sucursales y departamentos");
    expect(t.cabeceras[0]).toBe("Sucursal / Departamento");
    expect(primera(t).slice(0, 5)).toEqual(["Grupo Norte", "Bodega", "Caja", "Gerencia", "Ventas"]);
    expect(t.filas[1]).toEqual({ tipo: "detalle", nivel: 1 });
  });

  it("un detalle desconocido se trata como «departamentos» y el RTN sale con guiones", () => {
    expect(leerDetalle("otro")).toBe("departamentos");
    expect(leerDetalle("empleados")).toBe("empleados");
    expect(formatoRtn("05011999000099")).toBe("0501-1999-000099");
    expect(formatoRtn("0501-1999-000099")).toBe("0501-1999-000099");
    expect(formatoRtn(null)).toBe("");
  });
});
