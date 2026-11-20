import { describe, expect, it } from "vitest";
import { COLUMNAS, NINGUNA_COLUMNA, columnasDisponibles, columnasPorOmision, leerColumnas, textoColumnas } from "./columnas-lista";
import { ESTADO_VIGENTES, filtroEstado, leerLista, ordenLista, textoLista } from "./lista";

const conTodo = { vePII: true, conDivisiones: true };
const directorio = { vePII: false, conDivisiones: false };

describe("columnas de la lista de empleados", () => {
  it("por omisión son las de siempre, más la sucursal de la jerarquía cuando existe", () => {
    expect(columnasPorOmision(directorio)).toEqual(["codigo", "sucursal", "departamento", "puesto", "ingreso", "estado"]);
    expect(columnasPorOmision(conTodo)).toEqual(["codigo", "sucursal", "division", "departamento", "puesto", "ingreso", "estado", "salario"]);
  });

  it("sin permiso de datos personales no se ofrece ninguna columna personal", () => {
    const claves = columnasDisponibles(directorio).map((c) => c.clave);
    for (const c of COLUMNAS.filter((x) => x.pii)) expect(claves).not.toContain(c.clave);
    expect(claves).toContain("correo"); // el corporativo es de directorio
    expect(claves).not.toContain("division"); // sin el nivel División no existe
  });

  it("la cookie no abre lo que el permiso cierra", () => {
    expect(leerColumnas("codigo,salario,identidad,cuenta", directorio)).toEqual(["codigo"]);
    expect(leerColumnas("codigo,salario,identidad,cuenta", conTodo)).toEqual(["codigo", "identidad", "salario", "cuenta"]);
  });

  it("ignora lo desconocido y, si no queda nada válido, vuelve a las de siempre", () => {
    expect(leerColumnas("inventada,puesto", directorio)).toEqual(["puesto"]);
    expect(leerColumnas("inventada", directorio)).toEqual(columnasPorOmision(directorio));
    expect(leerColumnas(undefined, directorio)).toEqual(columnasPorOmision(directorio));
    expect(leerColumnas("", directorio)).toEqual(columnasPorOmision(directorio));
  });

  it("se pueden quitar todas: queda sólo «Empleado»", () => {
    expect(leerColumnas(NINGUNA_COLUMNA, conTodo)).toEqual([]);
  });

  it("el orden es siempre el del catálogo, como se pidan", () => {
    expect(leerColumnas("estado,codigo,jefe", directorio)).toEqual(["codigo", "jefe", "estado"]);
    expect(textoColumnas(["estado", "codigo", "codigo", "x"])).toBe("codigo,estado");
  });

  it("cada columna ordenable apunta a un orden que existe", () => {
    const sp = (campo: string) => ordenLista({ orden: campo, dir: "asc" }, true).campo;
    for (const c of COLUMNAS.filter((x) => x.orden)) expect(sp(c.orden!)).toBe(c.orden);
  });
});

describe("filtros nuevos de la lista", () => {
  it("estado: uno concreto, «sin los dados de baja» o, si no se reconoce, ninguno", () => {
    expect(filtroEstado("ACTIVO")).toEqual({ estado: "ACTIVO" });
    expect(filtroEstado(ESTADO_VIGENTES)).toEqual({ estado: { not: "INACTIVO" } });
    expect(filtroEstado("INVENTADO")).toEqual({});
    expect(filtroEstado(undefined)).toEqual({});
  });

  it("sin permiso no se ordena por un dato personal", () => {
    for (const campo of ["salario", "identidad", "nacimiento", "salida"]) {
      expect(ordenLista({ orden: campo, dir: "desc" }, false).campo).toBe("empleado");
      expect(ordenLista({ orden: campo, dir: "desc" }, true).campo).toBe(campo);
    }
  });

  it("la sucursal y el estado viajan a la ficha para que las flechas recorran la misma lista", () => {
    const texto = textoLista({ sucursalId: "g1", divisionId: "s1", estado: "ACTIVO", page: "3" } as never);
    expect(leerLista(texto)).toEqual({ sucursalId: "g1", divisionId: "s1", estado: "ACTIVO" });
  });
});
