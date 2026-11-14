import { describe, it, expect } from "vitest";
import { altoEstimadoCopia, pdfComprobante } from "./comprobante-pdf";
import type { DatosBoleta } from "./comprobante";

const datos: DatosBoleta = {
  empresa: "Comercial del Valle, S. de R.L.",
  empresaRtn: "05019025147852",
  sucursal: "Norte",
  direccion: "Barrio Guamilito",
  telefono: "2550-0000",
  departamento: "Finanzas",
  nombreEmpleado: "Ana Lucía Mejía",
  codigoEmpleado: "EMP-0001",
  identidad: "0501-1990-01234",
  periodo: "16/08/2026 al 31/08/2026",
  tipoPlanilla: "Planilla quincenal",
  fechaPago: "31/08/2026",
  diasTrabajados: "15",
  horasExtra: "4",
  ingresos: [["Salario base", "L 10,000.00"]],
  deducciones: [["IHSS — Enfermedad y Maternidad", "L 148.79"], ["IHSS — Invalidez, Vejez y Muerte", "L 148.79"]],
  totalBruto: "L 10,000.00",
  totalDeducciones: "L 297.58",
  salarioNeto: "L 9,702.42",
  netoEnLetras: "NUEVE MIL SETECIENTOS DOS LEMPIRAS CON 42/100",
  emitido: "3/11/2026 6:00 p. m.",
};

/** PNG real de 1 × 1, opaco, de 8 bits y sin entrelazar. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const paginas = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("pdfComprobante", () => {
  it("genera una hoja carta con las dos copias (empleado y empresa)", async () => {
    const pdf = await pdfComprobante(datos);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(paginas(pdf)).toBe(1);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 612 792\]/);
  });

  it("cada copia cabe en media hoja aun en el caso más largo (4 ingresos, 13 deducciones, aviso, logo)", () => {
    const largo = {
      ...datos, estado: "BORRADOR",
      ubicacion: ["Grupo PAGSA", "Sucursal San Pedro Sula"], puesto: "Supervisora de cajas", departamento: "Ventas al detalle",
      direccion: "Barrio Guamilito, 3 calle, 8 avenida N.O., frente al mercado, San Pedro Sula, Cortés",
      ingresos: Array.from({ length: 4 }, (_, i) => [`Ingreso ${i + 1}`, "L 10,000.00"] as [string, string]),
      deducciones: Array.from({ length: 13 }, (_, i) => [`Deducción ${i + 1}`, "L 1,000.00"] as [string, string]),
    };
    expect(altoEstimadoCopia(largo, true)).toBeLessThanOrEqual(396 - 2 * 20 + 6);
  });

  it("incrusta el logo", async () => {
    const sin = await pdfComprobante(datos);
    const con = await pdfComprobante(datos, { png: PNG, ancho: 1, alto: 1 });
    expect(con.toString("latin1")).toContain("/Subtype /Image");
    expect(sin.toString("latin1")).not.toContain("/Subtype /Image");
  });

  it("cabe en una página con todas las deducciones posibles", async () => {
    const deducciones: Array<[string, string]> = Array.from({ length: 12 }, (_, i) => [`Concepto de deducción número ${i + 1}`, "L 1,000.00"]);
    const ingresos: Array<[string, string]> = Array.from({ length: 4 }, (_, i) => [`Ingreso ${i + 1}`, "L 1,000.00"]);
    const pdf = await pdfComprobante({ ...datos, deducciones, ingresos }, { png: PNG, ancho: 1, alto: 1 });
    expect(paginas(pdf)).toBe(1);
  });

  it("no falla con listas vacías ni sin datos opcionales", async () => {
    const pdf = await pdfComprobante({ ...datos, ingresos: [], deducciones: [], sucursal: null, direccion: null, telefono: null, departamento: null, fechaPago: null, netoEnLetras: null, emitido: undefined });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it.each(["BORRADOR", "CALCULADA", "ANULADA", "APROBADA", "PAGADA"])("genera el de una planilla %s", async (estado) => {
    const pdf = await pdfComprobante({ ...datos, estado });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(paginas(pdf)).toBe(1);
  });
});
