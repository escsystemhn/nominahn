import { describe, expect, it } from "vitest";
import { leerOrden, ordenAlPulsar, type Orden } from "./orden";

const CAMPOS = ["nombre", "salario"] as const;
const OMISION: Orden<(typeof CAMPOS)[number]> = { campo: "nombre", dir: "asc" };

describe("leerOrden", () => {
  it("sin nada en la URL usa el orden de siempre", () => {
    expect(leerOrden({}, CAMPOS, OMISION)).toEqual(OMISION);
  });

  it("toma la columna y la dirección de la URL", () => {
    expect(leerOrden({ orden: "salario", dir: "desc" }, CAMPOS, OMISION)).toEqual({ campo: "salario", dir: "desc" });
  });

  it("una columna que no existe no llega a la consulta", () => {
    expect(leerOrden({ orden: "contrasena", dir: "desc" }, CAMPOS, OMISION)).toEqual(OMISION);
  });

  it("una dirección desconocida se lee como ascendente", () => {
    expect(leerOrden({ orden: "salario", dir: "x; drop" }, CAMPOS, OMISION)).toEqual({ campo: "salario", dir: "asc" });
  });
});

describe("ordenAlPulsar", () => {
  it("otra columna arranca en su dirección natural", () => {
    expect(ordenAlPulsar(OMISION, "salario", "desc")).toEqual({ campo: "salario", dir: "desc" });
  });

  it("la misma columna invierte", () => {
    expect(ordenAlPulsar({ campo: "salario", dir: "desc" }, "salario", "desc")).toEqual({ campo: "salario", dir: "asc" });
    expect(ordenAlPulsar({ campo: "salario", dir: "asc" }, "salario", "desc")).toEqual({ campo: "salario", dir: "desc" });
  });
});
