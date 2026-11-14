import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { leerHojaRetencion } from "./acumulados-isr";

/** Libro con el formato de la hoja «Retención en la fuente», con datos INVENTADOS. */
async function libro(conCabeceras = true): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("DMR").getCell("A1").value = "DATOS PARA DMR";
  const ws = wb.addWorksheet("DATOS");
  ws.getCell("A1").value = "Año";
  ws.getCell("B1").value = 2026;
  ws.getCell("A2").value = "Mes";
  ws.getCell("B2").value = "Junio";
  if (conCabeceras) {
    ws.getRow(4).values = [
      "Nombre", "RTN", "Fecha Nacimiento",
      "Sueldo Enero", "Sueldo Febrero", "Comisiones y otros Enero", "Comisiones y otros Febrero",
      "Retención Enero", "Retencion Febrero",
    ];
  }
  ws.getRow(5).values = ["ANA PRUEBA LOPEZ", "0801-1990-123451", new Date("1990-01-01"), 18000, 9000, 5000, 0, { formula: "100+25.555", result: 125.555 } as ExcelJS.CellFormulaValue, 0];
  ws.getRow(6).values = ["LUIS SIN RTN", null, null, 15000, 15000, null, 1200, 0, 10];
  ws.getRow(7).values = ["Total general", null, null, 33000, 24000];
  // Una fila vacía y después otro empleado: la última fila también se lee.
  ws.getRow(9).values = ["MARTA AL FINAL", "08011985000011", null, 12000, 12000, 0, 0, 0, 0];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("lectura de la hoja «Retención en la fuente»", () => {
  it("encuentra la hoja DATOS, el año, el mes y las columnas por nombre", async () => {
    const r = await leerHojaRetencion(await libro());
    expect(r.hoja).toBe("DATOS");
    expect(r.anio).toBe(2026);
    expect(r.mesArchivo).toBe(6);
    expect(r.filas.map((f) => f.nombre)).toEqual(["ANA PRUEBA LOPEZ", "LUIS SIN RTN", "MARTA AL FINAL"]);
  });

  it("lee sueldo, comisiones e ISR de cada mes; las fórmulas por su resultado y las tildes no importan", async () => {
    const [ana, luis] = (await leerHojaRetencion(await libro())).filas;
    expect(ana.rtn).toBe("0801199012345" + "1");
    expect(ana.meses).toEqual([
      { mes: 1, sueldo: 18000, variables: 5000, isrRetenido: 125.555 },
      { mes: 2, sueldo: 9000, variables: 0, isrRetenido: 0 },
    ]);
    expect(luis.meses[0]).toEqual({ mes: 1, sueldo: 15000, variables: 0, isrRetenido: 0 });
    expect(luis.meses[1].isrRetenido).toBe(10);
  });

  it("avisa de quien no tiene RTN y salta la fila de totales", async () => {
    const r = await leerHojaRetencion(await libro());
    expect(r.errores).toEqual(["Fila 6 (LUIS SIN RTN): no tiene RTN; se buscará por nombre."]);
    expect(r.filas.some((f) => /total/i.test(f.nombre))).toBe(false);
  });

  it("un libro sin esas columnas o que no es Excel da un error claro", async () => {
    expect((await leerHojaRetencion(await libro(false))).errores[0]).toContain("No se encontró una hoja");
    expect((await leerHojaRetencion(new TextEncoder().encode("no soy excel"))).errores[0]).toContain("No se pudo leer el archivo");
  });
});
