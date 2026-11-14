import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parsearCsv } from "./csv";
import { plantillaXlsx, textoDeArchivo, textoDeCelda, xlsxATexto } from "./xlsx";
import type { ColumnaCsv } from "./tipos";

async function libroCon(filas: ExcelJS.CellValue[][], nombreHoja = "Hoja1"): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(nombreHoja);
  filas.forEach((f, i) => { hoja.getRow(i + 1).values = f; });
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

async function leer(bytes: Uint8Array) {
  const r = await xlsxATexto(bytes);
  if (!r.ok) throw new Error(r.error);
  return parsearCsv(r.texto);
}

describe("celdas", () => {
  it("una fecha de Excel sale como día/mes/año, sin correrse de día", () => {
    expect(textoDeCelda(new Date(Date.UTC(2026, 3, 3)))).toBe("03/04/2026");
  });

  it("REGRESIÓN: un número con tres decimales no se confunde con miles", () => {
    expect(textoDeCelda(2.125)).toBe("2.13");
    expect(textoDeCelda(12)).toBe("12");
  });

  it("toma el resultado de una fórmula, y nada si nunca se calculó", () => {
    expect(textoDeCelda({ formula: "A1*2", result: 5 } as ExcelJS.CellValue)).toBe("5");
    expect(textoDeCelda({ formula: "A1*2" } as ExcelJS.CellValue)).toBe("");
  });

  it("texto enriquecido y enlaces dan su texto", () => {
    expect(textoDeCelda({ richText: [{ text: "EMP" }, { text: "-1" }] })).toBe("EMP-1");
    expect(textoDeCelda({ text: "correo", hyperlink: "mailto:a@b.hn" })).toBe("correo");
  });
});

describe("leer una hoja", () => {
  it("conserva la numeración de Excel aunque haya filas en blanco", async () => {
    const r = await leer(await libroCon([["Codigo", "Monto"], ["A", 1], [], [], ["B", 2]]));
    expect(r.cabeceras).toEqual(["Codigo", "Monto"]);
    expect(r.filas.map((f) => [f.linea, f.celdas[0]])).toEqual([[2, "A"], [5, "B"]]);
  });

  it("un salto de línea dentro de una celda no descuadra la numeración", async () => {
    const r = await leer(await libroCon([["Codigo", "Nota"], ["A", "uno\ndos"], ["B", "x"]]));
    expect(r.filas.map((f) => f.linea)).toEqual([2, 3]);
    expect(r.filas[0].celdas[1]).toBe("uno dos");
  });

  it("lee comas y comillas sin partir la celda", async () => {
    const r = await leer(await libroCon([["Codigo", "Nota"], ["A", 'Col. Las Colinas, "C"']]));
    expect(r.filas[0].celdas[1]).toBe('Col. Las Colinas, "C"');
  });

  it("prefiere la hoja Datos si alguien movió las pestañas", async () => {
    const libro = new ExcelJS.Workbook();
    libro.addWorksheet("Instrucciones").addRow(["No soy datos"]);
    libro.addWorksheet("Datos").addRow(["Codigo"]);
    const r = await leer(new Uint8Array(await libro.xlsx.writeBuffer()));
    expect(r.cabeceras).toEqual(["Codigo"]);
  });

  it("rechaza lo que no es un .xlsx de verdad", async () => {
    const r = await xlsxATexto(new TextEncoder().encode("esto no es un zip, aunque se llame .xlsx"));
    expect(r.ok).toBe(false);
  });

  it("rechaza más filas de las permitidas", async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Datos");
    hoja.getRow(5002).values = ["fuera"];
    const r = await xlsxATexto(new Uint8Array(await libro.xlsx.writeBuffer()));
    expect(r).toMatchObject({ ok: false });
  });
});

describe("textoDeArchivo", () => {
  it("un CSV sigue entrando por el decodificador", async () => {
    const r = await textoDeArchivo("a.csv", new TextEncoder().encode("Codigo\nA"));
    expect(r).toEqual({ ok: true, texto: "Codigo\nA" });
  });
});

describe("plantilla", () => {
  const COLUMNAS: ColumnaCsv[] = [
    { clave: "empleado_codigo", etiqueta: "Codigo Empleado", descripcion: "Código.", requerido: true, ejemplo: "EMP-0001" },
    { clave: "fecha", etiqueta: "Fecha", descripcion: "DD/MM/AAAA.", requerido: true },
    { clave: "diurnas", etiqueta: "Extra 25%", descripcion: "Horas." },
    { clave: "cuotas_meses", etiqueta: "Cuotas", descripcion: "Número." },
  ];

  it("trae las cabeceras y ninguna fila que se pueda aplicar por accidente", async () => {
    const r = await leer(await plantillaXlsx(COLUMNAS));
    expect(r.cabeceras).toEqual(["Codigo Empleado", "Fecha", "Extra 25%", "Cuotas"]);
    expect(r.filas).toEqual([]);
  });

  it("guarda el formato de cada columna e incluye las instrucciones", async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await plantillaXlsx(COLUMNAS)) as unknown as Parameters<typeof libro.xlsx.load>[0]);
    const datos = libro.getWorksheet("Datos")!;
    expect(datos.getColumn(1).numFmt).toBe("@");
    expect(datos.getColumn(2).numFmt).toBe("@"); // la fecha como texto: Excel no la voltea
    expect(datos.getColumn(3).numFmt).toBe("0.00");
    expect(datos.getColumn(4).numFmt).toBe("0");
    const ayuda = libro.getWorksheet("Instrucciones")!;
    expect(ayuda.getRow(4).values).toEqual([undefined, "Codigo Empleado", "Sí", "Código.", "EMP-0001"]);
  });

  describe("con filas de personas reales", () => {
    const COLS: ColumnaCsv[] = [
      { clave: "codigo", etiqueta: "Codigo", descripcion: "Código." },
      { clave: "fecha_ingreso", etiqueta: "Ingreso", descripcion: "Fecha." },
      { clave: "salario_base", etiqueta: "Salario", descripcion: "Monto." },
    ];
    const FILAS = [["0012", "03/04/2026", "15000.50"], ["=SUMA(A1)", "01/02/2026", ""]];

    async function datos() {
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load((await plantillaXlsx(COLS, FILAS)) as unknown as Parameters<typeof libro.xlsx.load>[0]);
      return libro.getWorksheet("Datos")!;
    }

    it("los códigos y fechas quedan como texto, y el salario como número", async () => {
      const hoja = await datos();
      expect(hoja.getCell("A2").value).toBe("0012");
      expect(hoja.getCell("B2").value).toBe("03/04/2026");
      expect(hoja.getCell("C2").value).toBe(15000.5);
      expect(hoja.getCell("A2").numFmt).toBe("@");
    });

    it("un texto que parece fórmula no se ejecuta", async () => {
      expect((await datos()).getCell("A3").value).toBe("=SUMA(A1)");
    });

    it("el mismo archivo se puede volver a importar", async () => {
      const r = await leer(await plantillaXlsx(COLS, FILAS));
      expect(r.filas.map((f) => f.celdas)).toEqual([["0012", "03/04/2026", "15000.50"], ["=SUMA(A1)", "01/02/2026", ""]]);
    });
  });
});
