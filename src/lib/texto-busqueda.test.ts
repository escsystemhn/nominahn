import { describe, expect, it } from "vitest";
import { coincide, palabrasDeBusqueda, sinAcentos, tramosResaltados } from "./texto-busqueda";

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

describe("tramosResaltados", () => {
  const marcados = (texto: string, q: string) =>
    tramosResaltados(texto, palabrasDeBusqueda(q)).filter((t) => t.marca).map((t) => t.texto);

  it("marca lo buscado tal como está escrito, sin importar tildes ni mayúsculas", () => {
    expect(marcados("Ana Lucía Mejía Cruz", "mejia ana")).toEqual(["Ana", "Mejía"]);
    expect(marcados("Óscar Núñez", "nunez")).toEqual(["Núñez"]);
  });

  it("une tramos vecinos y deja el resto sin marca", () => {
    expect(tramosResaltados("EMP-0154", ["emp-01"])).toEqual([
      { texto: "EMP-01", marca: true },
      { texto: "54", marca: false },
    ]);
  });

  it("sin palabras no marca nada y un texto vacío no da tramos", () => {
    expect(tramosResaltados("Ana", [])).toEqual([{ texto: "Ana", marca: false }]);
    expect(tramosResaltados("", ["ana"])).toEqual([]);
  });

  it("marca cada aparición", () => {
    expect(marcados("Ana Ana", "ana")).toEqual(["Ana", "Ana"]);
  });
});
