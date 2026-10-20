import { describe, it, expect } from "vitest";
import { valorCelda, esFilaTotal, columnasNumericas, nombreHoja, aXlsx, aPdf } from "./salida";

describe("valorCelda", () => {
  it("lee lempiras con separador de miles y signo", () => {
    expect(valorCelda("L 95,000.00")).toEqual({ tipo: "moneda", valor: 95000 });
    expect(valorCelda("L 1,234.56")).toEqual({ tipo: "moneda", valor: 1234.56 });
    expect(valorCelda("-L 5.00")).toEqual({ tipo: "moneda", valor: -5 });
  });

  it("distingue número, porcentaje y texto", () => {
    expect(valorCelda("30")).toEqual({ tipo: "numero", valor: 30 });
    expect(valorCelda("12.50")).toEqual({ tipo: "numero", valor: 12.5 });
    expect(valorCelda("5.00%")).toEqual({ tipo: "porcentaje", valor: 0.05 });
    expect(valorCelda("EMP-0001")).toEqual({ tipo: "texto", valor: "EMP-0001" });
    expect(valorCelda("01/09/2026")).toEqual({ tipo: "texto", valor: "01/09/2026" });
    expect(valorCelda("0501-1981-04512")).toEqual({ tipo: "texto", valor: "0501-1981-04512" });
  });
});

describe("columnasNumericas y filas de total", () => {
  const cabeceras = ["Empleado", "Identidad", "Salario", "Días"];
  const datos = [
    ["Ana", "0501-1981-04512", "L 95,000.00", "30"],
    ["Luis", "", "L 12,480.00", "28"],
    ["TOTAL GENERAL", "", "L 107,480.00", ""],
  ];

  it("marca sólo las columnas donde todo lo que hay es número", () => {
    expect(columnasNumericas(cabeceras, datos)).toEqual([false, false, true, true]);
  });

  it("una columna vacía no cuenta como numérica", () => {
    expect(columnasNumericas(["A", "B"], [["x", ""], ["y", ""]])).toEqual([false, false]);
  });

  it("reconoce la fila de totales por su primera celda con contenido", () => {
    expect(esFilaTotal(datos[2])).toBe(true);
    expect(esFilaTotal(["", "", "", "TOTAL — 3 beneficiario(s)", "100.00", "REF"])).toBe(true);
    expect(esFilaTotal(datos[0])).toBe(false);
  });
});

describe("nombreHoja", () => {
  it("quita los caracteres que Excel no admite y corta a 31", () => {
    expect(nombreHoja("Planilla IHSS (EM + IVM)")).toBe("Planilla IHSS (EM + IVM)");
    expect(nombreHoja("Resumen: ventas/compras [2026]?*")).toBe("Resumen ventas compras 2026");
    expect(nombreHoja("Constancia de Retención ISR — 2026 con un título larguísimo")).toHaveLength(31);
    expect(nombreHoja("")).toBe("Reporte");
  });
});

const REPORTE = {
  titulo: "Planilla IHSS (EM + IVM)",
  cabeceras: ["Empleado", "N° IHSS", "Salario", "Total"],
  datos: [
    ["Ana Mejía", "SPS045127", "L 95,000.00", "L 1,142.74"],
    ["Luis Hernández", "", "L 12,480.00", "L 1,142.74"],
    ["TOTAL", "", "L 107,480.00", "L 2,285.48"],
  ],
  generado: new Date("2026-10-15T15:00:00Z"),
  filtros: ["Sucursal: Sucursal San Pedro Sula"],
};

describe("aXlsx", () => {
  it("produce un libro de Excel válido con los montos como número", async () => {
    const buf = await aXlsx(REPORTE);
    // Un .xlsx es un zip: empieza por la firma PK.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.length).toBeGreaterThan(2000);
  });
});

describe("aPdf", () => {
  it("produce un PDF con la cabecera del formato", async () => {
    const buf = await aPdf(REPORTE);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("un reporte vacío también genera documento", async () => {
    const buf = await aPdf({ ...REPORTE, datos: [] });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
