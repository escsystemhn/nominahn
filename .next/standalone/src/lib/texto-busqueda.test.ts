import { describe, expect, it } from "vitest";
import { coincide, palabrasDeBusqueda, sinAcentos } from "./texto-busqueda";

describe("texto de búsqueda", () => {
  it("quita tildes y mayúsculas, incluida la eñe", () => {
    expect(sinAcentos("Núñez MEJÍA")).toBe("nunez mejia");
  });

  it("separa en palabras, sin vacíos y con un límite", () => {
    expect(palabrasDeBusqueda("  Ana   Mejía ")).toEqual(["ana", "mejia"]);
    expect(palabrasDeBusqueda("")).toEqual([]);
    expect(palabrasDeBusqueda("a b c d e f g h")).toHaveLength(6);
  });

  it("encuentra en cualquier orden y sin tildes", () => {
    expect(coincide("Ana Lucía Mejía Cruz", palabrasDeBusqueda("mejia ana"))).toBe(true);
    expect(coincide("Ana Lucía Mejía Cruz", palabrasDeBusqueda("mejia pedro"))).toBe(false);
  });

  it("sin palabras coincide todo: quien llama decide si eso tiene sentido", () => {
    expect(coincide("lo que sea", [])).toBe(true);
  });
});
