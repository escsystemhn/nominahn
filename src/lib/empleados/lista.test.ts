import { describe, expect, it } from "vitest";
import { leerLista, textoLista, vecinosEn } from "./lista";

const lista = [
  { id: "a", nombre: "Ana" },
  { id: "b", nombre: "Beto" },
  { id: "c", nombre: "Carla" },
];

describe("vecinos en la lista", () => {
  it("el del medio tiene anterior y siguiente", () => {
    expect(vecinosEn(lista, "b")).toEqual({ anterior: lista[0], siguiente: lista[2], posicion: 2, total: 3 });
  });
  it("el primero no tiene anterior y el último no tiene siguiente", () => {
    expect(vecinosEn(lista, "a")).toMatchObject({ anterior: null, siguiente: lista[1], posicion: 1 });
    expect(vecinosEn(lista, "c")).toMatchObject({ anterior: lista[1], siguiente: null, posicion: 3 });
  });
  it("quien no está en la lista no tiene vecinos", () => {
    expect(vecinosEn(lista, "z")).toBeNull();
  });
});

describe("los filtros que viajan a la ficha", () => {
  it("van sin la página ni claves ajenas, y se leen igual", () => {
    const texto = textoLista({ search: "ana maría", sucursalId: "suc-1", orden: "codigo", dir: "desc" });
    expect(texto).toBe("search=ana+mar%C3%ADa&sucursalId=suc-1&orden=codigo&dir=desc");
    expect(leerLista(texto)).toEqual({ search: "ana maría", sucursalId: "suc-1", orden: "codigo", dir: "desc" });
    expect(leerLista("page=3&tab=laboral&search=x")).toEqual({ search: "x" });
  });
  it("sin filtros, nada", () => {
    expect(textoLista({})).toBe("");
    expect(leerLista(undefined)).toEqual({});
  });
});
