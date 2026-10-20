import { describe, it, expect } from "vitest";
import { origenAceptado, origenesPermitidos } from "./origen";

const NINGUNO = new Set<string>();
const HOST = "nominahn.seenode.app";

describe("origen — defensa CSRF de las rutas que escriben", () => {
  it("deja pasar las lecturas aunque vengan de otro origen", () => {
    for (const metodo of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(origenAceptado({ metodo, origen: "https://otra.seenode.app", host: HOST, permitidos: NINGUNO })).toBe(true);
    }
  });

  it("acepta un POST del mismo servidor", () => {
    expect(origenAceptado({ metodo: "POST", origen: `https://${HOST}`, host: HOST, permitidos: NINGUNO })).toBe(true);
  });

  it("rechaza un POST de una app hermana en seenode.app", () => {
    expect(origenAceptado({ metodo: "POST", origen: "https://otra.seenode.app", host: HOST, permitidos: NINGUNO })).toBe(false);
  });

  it("rechaza también PUT, PATCH y DELETE ajenos", () => {
    for (const metodo of ["PUT", "PATCH", "DELETE"]) {
      expect(origenAceptado({ metodo, origen: "https://atacante.example", host: HOST, permitidos: NINGUNO })).toBe(false);
    }
  });

  it("sin Origin no es un navegador: decide la guardia de la ruta", () => {
    expect(origenAceptado({ metodo: "POST", origen: null, host: HOST, permitidos: NINGUNO })).toBe(true);
  });

  it("rechaza Origin: null y los valores que no son URL", () => {
    expect(origenAceptado({ metodo: "POST", origen: "null", host: HOST, permitidos: NINGUNO })).toBe(false);
    expect(origenAceptado({ metodo: "POST", origen: "no es una url", host: HOST, permitidos: NINGUNO })).toBe(false);
  });

  it("compara el puerto: otro puerto del mismo equipo es otro origen", () => {
    expect(origenAceptado({ metodo: "POST", origen: "http://localhost:3009", host: "localhost:3009", permitidos: NINGUNO })).toBe(true);
    expect(origenAceptado({ metodo: "POST", origen: "http://localhost:4000", host: "localhost:3009", permitidos: NINGUNO })).toBe(false);
  });

  it("sin host conocido sólo valen los orígenes declarados", () => {
    const permitidos = origenesPermitidos(undefined, `https://${HOST}`);
    expect(origenAceptado({ metodo: "POST", origen: `https://${HOST}`, host: null, permitidos })).toBe(true);
    expect(origenAceptado({ metodo: "POST", origen: "https://otra.seenode.app", host: null, permitidos })).toBe(false);
  });
});

describe("origen — lista de permitidos", () => {
  it("junta AUTH_URL y ORIGENES_PERMITIDOS, reducidos a su origen", () => {
    const p = origenesPermitidos(" http://localhost:3009/ , https://nomina.cliente.hn/login", "https://nominahn.seenode.app/algo");
    expect([...p].sort()).toEqual(["http://localhost:3009", "https://nomina.cliente.hn", "https://nominahn.seenode.app"]);
  });

  it("ignora vacíos y valores que no son URL", () => {
    expect([...origenesPermitidos(",, basura ,", undefined)]).toEqual([]);
  });
});
