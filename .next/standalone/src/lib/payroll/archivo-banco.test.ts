import { describe, it, expect } from "vitest";
import { generarArchivoBanco, validarFormato, FORMATO_GENERICO, type FormatoArchivoBanco, type FilaPago } from "./archivo-banco";

const meta = { fechaPago: new Date("2026-10-15T00:00:00Z"), referencia: "NOM-QUINCENAL-20261015", concepto: "Planilla quincenal" };
const filas: FilaPago[] = [
  { cuenta: "1234-5678 90", identidad: "0501-1990-01234", nombre: "José Ñúñez", codigo: "E-1", banco: "BAC Credomatic", monto: 12500.5 },
  { cuenta: "998877", identidad: "0801-1985-00001", nombre: "Ana López, hija", codigo: "E-2", banco: "Banco Atlántida", monto: 8000 },
  { cuenta: null, identidad: null, nombre: "Sin Cuenta", codigo: "E-3", banco: null, monto: 5000 },
  { cuenta: "111", identidad: null, nombre: "Cero", codigo: "E-4", banco: "BAC", monto: 0 },
];

describe("formato genérico", () => {
  it("CSV con encabezado, comillas donde hace falta y excluidos aparte", () => {
    const r = generarArchivoBanco(FORMATO_GENERICO, filas, meta);
    expect(r.errores).toEqual([]);
    expect(r.contenido.split("\r\n")).toEqual([
      "Banco,Cuenta,Identidad,Beneficiario,Monto,Referencia",
      "BAC Credomatic,1234567890,0501199001234,José Ñúñez,12500.50,NOM-QUINCENAL-20261015",
      'Banco Atlántida,998877,0801198500001,"Ana López, hija",8000.00,NOM-QUINCENAL-20261015',
      "",
    ]);
    expect(r.incluidos).toBe(2);
    expect(r.total).toBe(20500.5);
    expect(r.excluidos.map((e) => e.motivo)).toEqual(["Sin cuenta bancaria: pago manual", "Neto en cero"]);
  });
});

describe("ancho fijo y opciones", () => {
  const fijo: FormatoArchivoBanco = {
    tipo: "ANCHO_FIJO",
    delimitador: "",
    encabezado: true,
    finLinea: "LF",
    lineaTotal: true,
    filtroBanco: "bac",
    columnas: [
      { campo: "constante", valor: "D", ancho: 1 },
      { campo: "cuenta", ancho: 12, relleno: "CERO", alinear: "DERECHA" },
      { campo: "nombre", ancho: 10, formato: "MAYUSCULAS_SIN_ACENTOS" },
      { campo: "monto", ancho: 10, relleno: "CERO", formato: "CENTAVOS" },
      { campo: "fechaPago", ancho: 8, formato: "DDMMAAAA" },
    ],
  };

  it("rellena, alinea, quita acentos, filtra por banco sin distinguir acentos ni mayúsculas y agrega total", () => {
    const r = generarArchivoBanco(fijo, filas, meta);
    expect(r.errores).toEqual([]);
    const lineas = r.contenido.split("\n");
    expect(lineas[0]).toBe("D001234567890JOSE NUNEZ000125005015102026");
    expect(lineas[1]).toBe("D000000000000TOTAL     000125005015102026");
    expect(r.incluidos).toBe(1);
    expect(r.excluidos.find((e) => e.codigo === "E-2")?.motivo).toBe("Su banco no es bac");
    expect(r.avisos).toEqual([]);
  });

  it("un monto que no cabe es error; un nombre que no cabe se recorta con aviso", () => {
    const r = generarArchivoBanco({ ...fijo, filtroBanco: null, columnas: [{ campo: "cuenta", ancho: 12 }, { campo: "nombre", ancho: 4 }, { campo: "monto", ancho: 4, formato: "CENTAVOS" }] }, filas, meta);
    expect(r.errores.some((e) => /monto de José Ñúñez no cabe en 4/.test(e))).toBe(true);
    expect(r.avisos[0]).toMatch(/nombre \(ancho 4\)/);
  });

  it("separador distinto de coma: se quita el separador del dato", () => {
    const r = generarArchivoBanco({ ...FORMATO_GENERICO, delimitador: "|", encabezado: false, columnas: [{ campo: "nombre" }, { campo: "monto", formato: "DECIMAL_COMA" }] }, [{ ...filas[0], nombre: "A|B" }], meta);
    expect(r.contenido).toBe("A B|12500,50\r\n");
  });
});

describe("validación del formato", () => {
  it("exige cuenta, monto y anchos", () => {
    expect(validarFormato(FORMATO_GENERICO)).toEqual([]);
    const v = validarFormato({ ...FORMATO_GENERICO, tipo: "ANCHO_FIJO", columnas: [{ campo: "nombre" }] });
    expect(v).toEqual(["El archivo necesita una columna de monto.", "El archivo necesita una columna con el número de cuenta.", "La columna 1 necesita un ancho."]);
  });
});
