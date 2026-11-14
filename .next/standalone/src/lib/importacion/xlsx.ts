/**
 * Plantillas de importación en Excel.
 *
 * El archivo .xlsx se convierte a texto CSV y entra por el mismo validador que un
 * CSV: una sola regla de negocio y un solo informe, venga de donde venga. Cada fila
 * de la hoja conserva su número de línea para que el informe coincida con lo que la
 * persona ve en Excel, incluso si dejó filas en blanco.
 */

import ExcelJS from "exceljs";
import { celdaCsv } from "@/lib/reportes/formato";
import { decodificar } from "./csv";
import { MAX_FILAS_ARCHIVO } from "./lote";
import type { ColumnaCsv } from "./tipos";

/** Para `leerArchivo`: un .xls antiguo es otro formato que no sabemos leer. */
export const ACEPTA_PLANTILLA = {
  patron: /\.(csv|txt|xlsx)$/i,
  descripcion: "archivos .xlsx o .csv. Si es un .xls antiguo, ábralo en Excel y guárdelo como .xlsx.",
};

/**
 * Tope de lo que puede ocupar el archivo ya descomprimido. Un .xlsx es un zip: unos
 * pocos MB pueden inflarse hasta tumbar el servidor, y exceljs lo carga en memoria.
 */
const MAX_DESCOMPRIMIDO = 200 * 1024 * 1024;

const ERROR_LECTURA = "No se pudo leer el archivo de Excel. Ábralo y guárdelo de nuevo como .xlsx, o use la plantilla CSV.";

export type LecturaArchivo = { ok: true; texto: string } | { ok: false; error: string };

/** Suma el tamaño descomprimido que declara el directorio central del zip; `null` si no es un zip. */
function tamanoDescomprimido(bytes: Uint8Array): number | null {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const FIN_DIRECTORIO = 0x06054b50;
  const ENTRADA = 0x02014b50;

  let fin = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65_535; i--) {
    if (vista.getUint32(i, true) === FIN_DIRECTORIO) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;

  let total = 0;
  let pos = vista.getUint32(fin + 16, true);
  const entradas = vista.getUint16(fin + 10, true);
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > bytes.length || vista.getUint32(pos, true) !== ENTRADA) return null;
    total += vista.getUint32(pos + 24, true);
    pos += 46 + vista.getUint16(pos + 28, true) + vista.getUint16(pos + 30, true) + vista.getUint16(pos + 32, true);
  }
  return total;
}

/** Fecha de Excel: exceljs la entrega en UTC, así que se leen las partes en UTC. */
function fechaComoTexto(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * Valor de una celda como lo leería una persona.
 *
 * Un número con decimales se escribe siempre con dos: como texto, «2.125» se leería
 * como dos mil ciento veinticinco (`normalizarNumero`, tres dígitos = agrupación),
 * y en una celda numérica no hay ambigüedad que resolver.
 */
export function textoDeCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return fechaComoTexto(valor);
  if (typeof valor === "number") return Number.isInteger(valor) ? String(valor) : valor.toFixed(2);
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "string") return valor;
  if ("richText" in valor) return valor.richText.map((t) => t.text).join("");
  if ("text" in valor) return textoDeCelda(valor.text as ExcelJS.CellValue);
  // Una fórmula aporta su último resultado; si nunca se calculó, no hay dato.
  if ("result" in valor) return textoDeCelda((valor.result ?? null) as ExcelJS.CellValue);
  return "";
}

/** Primera hoja, o la llamada «Datos» si la persona movió las pestañas de la plantilla. */
export async function xlsxATexto(bytes: Uint8Array): Promise<LecturaArchivo> {
  const tamano = tamanoDescomprimido(bytes);
  if (tamano === null) return { ok: false, error: ERROR_LECTURA };
  if (tamano > MAX_DESCOMPRIMIDO) return { ok: false, error: "El archivo de Excel es demasiado grande. Divídalo, por ejemplo por sucursal." };

  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(bytes as unknown as Parameters<typeof libro.xlsx.load>[0]);
  } catch {
    return { ok: false, error: ERROR_LECTURA };
  }

  const hoja = libro.getWorksheet("Datos") ?? libro.worksheets[0];
  if (!hoja) return { ok: false, error: "El archivo de Excel no tiene hojas." };
  if (hoja.rowCount - 1 > MAX_FILAS_ARCHIVO) {
    return { ok: false, error: `El archivo trae ${hoja.rowCount - 1} filas y el máximo por lote es ${MAX_FILAS_ARCHIVO}. Divídalo, por ejemplo por sucursal.` };
  }

  const lineas: string[] = [];
  for (let r = 1; r <= hoja.rowCount; r++) {
    const fila = hoja.getRow(r);
    const celdas: string[] = [];
    for (let c = 1; c <= hoja.columnCount; c++) {
      // Un salto de línea dentro de una celda descuadraría la numeración del informe.
      celdas.push(textoDeCelda(fila.getCell(c).value).replace(/\s*[\r\n]+\s*/g, " "));
    }
    // Línea vacía y no `"",""`: el lector descarta las primeras, y una fila en blanco
    // de Excel no debe contar como una fila a la que le faltan todos los datos.
    lineas.push(celdas.some((v) => v.trim() !== "") ? celdas.map(celdaCsv).join(",") : "");
  }
  return { ok: true, texto: lineas.join("\r\n") };
}

export async function textoDeArchivo(nombre: string, bytes: Uint8Array): Promise<LecturaArchivo> {
  return /\.xlsx$/i.test(nombre) ? xlsxATexto(bytes) : { ok: true, texto: decodificar(bytes) };
}

const COLUMNAS_NUMERO = new Set(["monto", "salario_base", "diurnas", "mixtas", "nocturnas", "feriado", "saldo"]);
const COLUMNAS_ENTERO = new Set(["cuotas_meses", "cuotas_pagadas"]);

/**
 * Formato de cada columna. Todo lo demás va como TEXTO, y eso incluye las fechas:
 * en un Windows en inglés, Excel convertiría 03/04/2026 en 4 de marzo sin avisar,
 * mientras que como texto llega tal cual y el validador lo lee con el día primero.
 * También conserva los ceros a la izquierda de un código o una identidad.
 */
function formatoColumna(c: ColumnaCsv): string {
  // Con separador de miles: una columna de montos por empleado se lee como planilla.
  if (c.formato === "monto") return "#,##0.00";
  if (c.formato === "entero" || COLUMNAS_ENTERO.has(c.clave)) return "0";
  if (COLUMNAS_NUMERO.has(c.clave)) return "0.00";
  return "@";
}

const esNumerica = (c: ColumnaCsv) => !!c.formato || COLUMNAS_NUMERO.has(c.clave) || COLUMNAS_ENTERO.has(c.clave);

/**
 * Plantilla vacía: hoja «Datos» sólo con cabeceras y hoja «Instrucciones» con el
 * ejemplo. Sin fila de ejemplo en los datos: su código podría ser el de un empleado
 * real y aplicarse si a alguien se le olvida borrarla.
 *
 * `filas` la llena al exportar personas reales: el mismo archivo se puede corregir
 * y volver a importar. Los montos van como número, para que Excel pueda sumarlos.
 */
export async function plantillaXlsx(
  columnas: readonly ColumnaCsv[],
  filas: readonly (readonly string[])[] = [],
  /**
   * `notas`: las primeras líneas de «Instrucciones», en lugar de la general.
   * `fijarColumnas`: las primeras quedan quietas al desplazarse.
   * `listas`: columnas que se llenan eligiendo de una lista desplegable (clave → valores).
   */
  opciones: { notas?: readonly string[]; fijarColumnas?: number; listas?: Record<string, readonly string[]> } = {}
): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  const datos = libro.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1, xSplit: opciones.fijarColumnas ?? 0 }] });
  datos.columns = columnas.map((c) => ({
    header: c.etiqueta,
    key: c.clave,
    width: Math.min(40, Math.max(14, c.etiqueta.length + 4)),
    style: { numFmt: formatoColumna(c) },
  }));
  const cabecera = datos.getRow(1);
  cabecera.eachCell((celda, n) => {
    celda.numFmt = "@";
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: columnas[n - 1].requerido ? "FF0B5A6E" : "FF4B5563" } };
    celda.alignment = { vertical: "middle" };
  });
  for (const fila of filas) {
    datos.addRow(fila.map((valor, i) => (esNumerica(columnas[i]) && valor !== "" ? Number(valor) : valor)));
  }
  // Lista desplegable: elegir es más rápido que escribir y no deja errores de tecleo.
  // Excel limita la lista escrita a 255 caracteres; los valores no pueden llevar comas.
  const hasta = Math.max(filas.length + 200, 300);
  for (const [clave, valores] of Object.entries(opciones.listas ?? {})) {
    const col = columnas.findIndex((c) => c.clave === clave) + 1;
    if (!col) continue;
    const formula = `"${valores.join(",")}"`;
    for (let r = 2; r <= hasta; r++) {
      datos.getCell(r, col).dataValidation = {
        type: "list", allowBlank: true, formulae: [formula],
        showErrorMessage: true, errorTitle: "Valor no válido", error: `Elija de la lista: ${valores.join(", ")}.`,
      };
    }
  }

  const ayuda = libro.addWorksheet("Instrucciones");
  for (const nota of opciones.notas ?? ["Llene la hoja Datos, una fila por registro. No cambie los nombres de las columnas. Las de color azul son obligatorias."]) {
    ayuda.addRow([nota]);
  }
  ayuda.addRow([]);
  const titulos = ayuda.addRow(["Columna", "¿Obligatoria?", "Qué poner", "Ejemplo"]);
  titulos.font = { bold: true };
  for (const c of columnas) {
    ayuda.addRow([c.etiqueta, c.requerido ? "Sí" : "No", c.descripcion, c.ejemplo ?? ""]);
  }
  ayuda.getColumn(1).width = 24;
  ayuda.getColumn(2).width = 14;
  ayuda.getColumn(3).width = 90;
  ayuda.getColumn(4).width = 20;
  ayuda.getColumn(3).alignment = { wrapText: true, vertical: "top" };

  return new Uint8Array(await libro.xlsx.writeBuffer());
}

/** Cabeceras HTTP de una plantilla en Excel. */
export function cabecerasXlsx(nombreArchivo: string): HeadersInit {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${nombreArchivo.replace(/[^a-zA-Z0-9_.-]/g, "")}"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}
