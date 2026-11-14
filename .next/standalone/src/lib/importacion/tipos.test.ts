import { describe, expect, it } from "vitest";
import { filasLeidas } from "./tipos";

describe("filasLeidas", () => {
  it("cuenta las filas con errores además de las de la vista previa", () => {
    expect(
      filasLeidas({
        previsualizacion: [{ linea: 2 }, { linea: 3 }, { linea: 5 }],
        incidencias: [
          { linea: 4, severidad: "ERROR", mensaje: "a" },
          { linea: 4, severidad: "ERROR", mensaje: "b" }, // dos errores en la misma fila: una fila
          { linea: 6, severidad: "AVISO", mensaje: "c" }, // un aviso solo no es una fila más
          { linea: 1, severidad: "ERROR", mensaje: "falta una columna" }, // la cabecera no es una fila de datos
        ],
      })
    ).toBe(4);
  });

  it("una fila omitida o con aviso que además tiene error se cuenta una vez", () => {
    expect(filasLeidas({ previsualizacion: [{ linea: 2 }], incidencias: [{ linea: 2, severidad: "ERROR", mensaje: "x" }] })).toBe(1);
  });
});
