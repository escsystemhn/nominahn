import { describe, it, expect } from "vitest";
import {
  parsearCsv,
  generarCsv,
  decodificar,
  detectarDelimitador,
  desproteger,
  normalizarCabecera,
  mapearColumnas,
  delimitadorPedido,
} from "./csv";

const bytes = (...b: number[]) => new Uint8Array(b);
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("decodificar", () => {
  it("quita el BOM UTF-8 en vez de dejarlo en la primera cabecera", () => {
    expect(decodificar(bytes(0xef, 0xbb, 0xbf, 0x61, 0x62))).toBe("ab");
  });

  it("lee UTF-8 sin BOM", () => {
    expect(decodificar(utf8("Núñez"))).toBe("Núñez");
  });

  it("lee UTF-16LE con BOM", () => {
    expect(decodificar(bytes(0xff, 0xfe, 0x61, 0x00, 0x62, 0x00))).toBe("ab");
  });

  /**
   * El caso real: Excel en un Windows en español guarda el CSV en ANSI. En
   * windows-1252 la ñ es 0xF1, un byte que NO es UTF-8 válido por sí solo.
   * Si el respaldo no funcionara, "Núñez" entraría a la base como mojibake.
   */
  it("cae a windows-1252 cuando los bytes no son UTF-8 válido", () => {
    // "Núñez" en windows-1252: N ú(0xFA) ñ(0xF1) e z
    expect(decodificar(bytes(0x4e, 0xfa, 0xf1, 0x65, 0x7a))).toBe("Núñez");
  });

  it("no confunde UTF-8 válido con windows-1252", () => {
    expect(decodificar(utf8("José Ángel Peña"))).toBe("José Ángel Peña");
  });
});

describe("detectarDelimitador", () => {
  it("reconoce la coma", () => {
    expect(detectarDelimitador("a,b,c\n1,2,3")).toBe(",");
  });

  it("reconoce el punto y coma que produce Excel en español", () => {
    expect(detectarDelimitador("a;b;c\n1;2;3")).toBe(";");
  });

  it("reconoce el tabulador", () => {
    expect(detectarDelimitador("a\tb\tc")).toBe("\t");
  });

  // Sin esto, una sola cabecera entrecomillada con comas ganaría la votación.
  it("no cuenta separadores que están dentro de comillas", () => {
    expect(detectarDelimitador('"Apellido, Nombre";Salario;Puesto')).toBe(";");
  });

  it("sin separadores, asume coma", () => {
    expect(detectarDelimitador("columna_unica")).toBe(",");
  });
});

describe("parsearCsv", () => {
  it("separa cabeceras de filas", () => {
    const r = parsearCsv("codigo,nombre\nEMP-0001,Ana");
    expect(r.cabeceras).toEqual(["codigo", "nombre"]);
    expect(r.filas).toEqual([{ linea: 2, celdas: ["EMP-0001", "Ana"] }]);
  });

  it("respeta las comas dentro de comillas", () => {
    const r = parsearCsv('codigo,direccion\nEMP-1,"Col. Las Colinas, Bloque C, #12"');
    expect(r.filas[0].celdas).toEqual(["EMP-1", "Col. Las Colinas, Bloque C, #12"]);
  });

  it("desescapa las comillas dobles", () => {
    const r = parsearCsv('obs\n"Dijo ""urgente"" dos veces"');
    expect(r.filas[0].celdas).toEqual(['Dijo "urgente" dos veces']);
  });

  it("acepta saltos de línea dentro de un campo entrecomillado", () => {
    const r = parsearCsv('codigo,obs\nEMP-1,"linea uno\nlinea dos"');
    expect(r.filas[0].celdas[1]).toBe("linea uno\nlinea dos");
  });

  it("normaliza el CRLF de Windows dentro de un campo", () => {
    const r = parsearCsv('obs\r\n"uno\r\ndos"');
    expect(r.filas[0].celdas[0]).toBe("uno\ndos");
  });

  it("acepta finales de línea LF, CRLF y CR sueltos", () => {
    expect(parsearCsv("a,b\n1,2").filas).toHaveLength(1);
    expect(parsearCsv("a,b\r\n1,2").filas).toHaveLength(1);
    expect(parsearCsv("a,b\r1,2").filas).toHaveLength(1);
  });

  /**
   * El número de línea del informe tiene que ser el que el usuario ve al abrir
   * el archivo. Un campo multilínea descuadra la cuenta si se numera contando
   * registros en lugar de saltos de línea reales.
   */
  it("reporta el número de línea REAL, aunque haya campos multilínea", () => {
    const r = parsearCsv('codigo,obs\nEMP-1,"a\nb\nc"\nEMP-2,simple');
    expect(r.filas[0].linea).toBe(2);
    expect(r.filas[1].linea).toBe(5);
  });

  it("ignora la línea vacía final que deja Excel", () => {
    expect(parsearCsv("a,b\n1,2\n").filas).toHaveLength(1);
    expect(parsearCsv("a,b\n1,2\n\n\n").filas).toHaveLength(1);
  });

  it("conserva una fila con campos vacíos si el usuario la escribió", () => {
    const r = parsearCsv('a,b\n"",""');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].celdas).toEqual(["", ""]);
  });

  it("recorta espacios sobrantes alrededor de cada valor", () => {
    expect(parsearCsv("a,b\n  EMP-1  ,  Ana  ").filas[0].celdas).toEqual(["EMP-1", "Ana"]);
  });

  it("quita el BOM aunque llegue ya como texto", () => {
    expect(parsearCsv("﻿codigo,nombre\nEMP-1,Ana").cabeceras).toEqual(["codigo", "nombre"]);
  });

  it("con archivo vacío no revienta", () => {
    const r = parsearCsv("");
    expect(r.cabeceras).toEqual([]);
    expect(r.filas).toEqual([]);
  });
});

describe("desproteger", () => {
  it("quita el apóstrofo que antepone celdaCsv a las fórmulas", () => {
    expect(desproteger("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(desproteger("'+50422334455")).toBe("+50422334455");
  });

  it("no toca apóstrofos que forman parte del dato", () => {
    expect(desproteger("O'Brien")).toBe("O'Brien");
    expect(desproteger("'texto")).toBe("'texto");
  });
});

describe("ida y vuelta", () => {
  /**
   * La propiedad que hace útil el par exportar/importar: lo exportado tiene que
   * volver a entrar idéntico. Aquí es donde se detecta que la protección
   * anti-fórmula del CSV no puede dejar residuo en el dato.
   */
  it("lo que se exporta se vuelve a leer igual", () => {
    const cabeceras = ["codigo", "nombre", "direccion", "telefono", "obs"];
    const filas = [
      ["EMP-0001", "José Núñez", "Col. Las Colinas, Bloque C", "+504 2233-4455", 'Dijo "sí"'],
      ["EMP-0002", "Ana Peña", "Barrio El Centro", "=2+2", "linea uno\nlinea dos"],
    ];

    const texto = generarCsv(cabeceras, filas);
    const leido = parsearCsv(texto);

    expect(leido.cabeceras).toEqual(cabeceras);
    expect(leido.filas.map((f) => f.celdas)).toEqual(filas);
  });

  it("sobrevive al punto y coma como separador", () => {
    const filas = [["EMP-1", "Col. A, B"]];
    const leido = parsearCsv(generarCsv(["codigo", "dir"], filas, ";"));
    expect(leido.delimitador).toBe(";");
    expect(leido.filas.map((f) => f.celdas)).toEqual(filas);
  });
});

describe("generarCsv", () => {
  it("emite BOM y CRLF", () => {
    const csv = generarCsv(["a"], [["1"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
  });

  // La protección que ya traía celdaCsv, verificada desde este lado.
  it("neutraliza las fórmulas de Excel", () => {
    expect(generarCsv(["a"], [["=HYPERLINK(\"http://x\")"]])).toContain("'=HYPERLINK");
  });
});

describe("normalizarCabecera", () => {
  it("iguala mayúsculas, tildes y separadores", () => {
    for (const variante of ["Salario Base", "salario_base", "SALARIO  BASE", "Salário-Base"]) {
      expect(normalizarCabecera(variante)).toBe("salario_base");
    }
  });
});

describe("mapearColumnas", () => {
  it("localiza cada columna esperada sin importar el orden", () => {
    const { indices } = mapearColumnas(["Nombre", "Código", "Salario Base"], [
      "codigo",
      "salario_base",
    ]);
    expect(indices).toEqual({ codigo: 1, salario_base: 2 });
  });

  /**
   * Delatar las columnas no reconocidas es lo que convierte un "Salaio Base" mal
   * escrito en un aviso, en vez de en una actualización que ignora el salario en
   * silencio.
   */
  it("delata las columnas que no reconoce", () => {
    const { desconocidas } = mapearColumnas(["codigo", "Salaio Base"], ["codigo", "salario_base"]);
    expect(desconocidas).toEqual(["Salaio Base"]);
  });

  it("no cuenta como desconocidas las columnas en blanco", () => {
    const { desconocidas } = mapearColumnas(["codigo", "", "  "], ["codigo"]);
    expect(desconocidas).toEqual([]);
  });
});

describe("delimitadorPedido", () => {
  it("acepta los alias y cae en coma por omisión", () => {
    expect(delimitadorPedido(";")).toBe(";");
    expect(delimitadorPedido("punto_y_coma")).toBe(";");
    expect(delimitadorPedido("tab")).toBe("\t");
    expect(delimitadorPedido(null)).toBe(",");
    expect(delimitadorPedido("cualquier-cosa")).toBe(",");
  });
});
