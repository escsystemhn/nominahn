import { describe, expect, it } from "vitest";
import { filtroBusquedaEmpleados } from "./busqueda";

const buscar = (texto: string, conIdentidad = false) =>
  filtroBusquedaEmpleados(texto, { conIdentidad }) as { AND?: Array<{ OR: Array<Record<string, { contains: string }>> }> };

describe("filtroBusquedaEmpleados", () => {
  it("sin texto no filtra", () => {
    expect(buscar("")).toEqual({});
    expect(buscar("   ")).toEqual({});
  });

  it("cada palabra se exige por separado", () => {
    const f = buscar("Ana  Mejía ");
    expect(f.AND).toHaveLength(2);
    expect(f.AND?.[0].OR[0].primerNombre.contains).toBe("Ana");
    expect(f.AND?.[1].OR[0].primerNombre.contains).toBe("Mejía");
  });

  it("busca también en el segundo nombre y el segundo apellido", () => {
    const columnas = buscar("Cruz").AND?.[0].OR.flatMap((o) => Object.keys(o));
    expect(columnas).toEqual(expect.arrayContaining(["segundoNombre", "segundoApellido", "codigo"]));
  });

  it("no busca por identidad si la persona no puede verla", () => {
    expect(buscar("0801").AND?.[0].OR.flatMap((o) => Object.keys(o))).not.toContain("identidad");
    expect(buscar("0801", true).AND?.[0].OR.flatMap((o) => Object.keys(o))).toContain("identidad");
  });

  it("no deja crecer la consulta sin límite", () => {
    expect(buscar("a b c d e f g h i j").AND).toHaveLength(6);
  });
});
