/**
 * Salidas de un reporte: Excel (.xlsx) y PDF, a partir de la misma tabla de
 * celdas ya formateadas que alimenta el visor y el CSV.
 *
 * Las celdas llegan como texto («L 1,234.56», «30», «12.50%»). Para Excel se
 * convierten a número con su formato, de modo que la hoja se pueda sumar; en el
 * PDF se alinean a la derecha. Lo que no es número se deja tal cual.
 *
 * Tipografía del PDF: las fuentes estándar del formato (Helvetica), que no se
 * incrustan ni requieren archivos y cubren el español. Mismo criterio que el
 * generador de documentos de Gestión360.
 */

import ExcelJS from "exceljs";
import * as pdfmakeModulo from "pdfmake";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
// La lectura de celdas y filas tiene una sola definición, compartida con el
// visor del navegador (que no puede importar este archivo por exceljs y pdfmake).
import { valorCelda, columnasNumericas, metaFila, contarDetalles, type TipoCelda, type MetaFila } from "./salida-celdas";

export { valorCelda, esFilaTotal, columnasNumericas, metaFila, contarDetalles } from "./salida-celdas";
export type { TipoCelda, TipoFila, MetaFila } from "./salida-celdas";

/**
 * pdfmake 0.3 exporta UNA instancia (module.exports = new pdfmake()). Según cómo
 * se cargue el módulo (Node, Vitest, el empaquetador de Next) esa instancia llega
 * como `default` o como el propio espacio de nombres; con `this` apuntando a un
 * espacio de nombres congelado, `setUrlAccessPolicy` fallaría al asignar.
 */
type Pdfmake = typeof pdfmakeModulo;
const pdfmake: Pdfmake =
  (pdfmakeModulo as unknown as { default?: Pdfmake }).default ?? pdfmakeModulo;

export interface ReporteTabla {
  titulo: string;
  cabeceras: string[];
  datos: string[][];
  generado: Date;
  /** Filtros aplicados, ya en palabras («Desde 01/09/2026», «Sucursal: Norte»). */
  filtros: string[];
  /**
   * Sólo en reportes agrupados: qué es cada fila de `datos` (encabezado de
   * grupo, detalle, subtotal o total) y su nivel de sangría. Sin esto, la tabla
   * es plana y una fila que empieza por «TOTAL» se trata como total.
   */
  filas?: MetaFila[];
}

// ─── Celdas ───────────────────────────────────────────────────────────────────

/** Nombre de hoja válido para Excel: sin `[]:*?/\` y hasta 31 caracteres. */
export function nombreHoja(titulo: string): string {
  const limpio = titulo.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim();
  return (limpio || "Reporte").slice(0, 31);
}

const FORMATO_EXCEL: Record<Exclude<TipoCelda, "texto">, string> = {
  moneda: '"L" #,##0.00',
  numero: "#,##0.##",
  porcentaje: "0.00%",
};

/** Fondo del encabezado de grupo por nivel: sucursal, división, departamento. */
const FONDO_GRUPO_EXCEL = ["FFDCE6EA", "FFE9EFF2", "FFF3F6F8"];

// ─── Excel ────────────────────────────────────────────────────────────────────

export async function aXlsx(r: ReporteTabla): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NominaHN";
  wb.created = r.generado;
  const ws = wb.addWorksheet(nombreHoja(r.titulo), { views: [{ state: "frozen", ySplit: 4 }] });
  const columnas = Math.max(1, r.cabeceras.length);
  const ultima = ws.getColumn(columnas).letter;

  ws.mergeCells(`A1:${ultima}1`);
  ws.getCell("A1").value = r.titulo;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0D2B38" } };

  ws.mergeCells(`A2:${ultima}2`);
  ws.getCell("A2").value = [`Generado el ${r.generado.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}`, `${contarDetalles(r.datos, r.filas)} registros`, ...r.filtros].join(" · ");
  ws.getCell("A2").font = { size: 9, color: { argb: "FF637580" } };

  const cabecera = ws.getRow(4);
  cabecera.values = r.cabeceras;
  cabecera.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cabecera.alignment = { vertical: "middle" };
  cabecera.height = 20;
  for (let c = 1; c <= columnas; c++) {
    cabecera.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D2B38" } };
  }

  const numericas = columnasNumericas(r.cabeceras, r.datos);
  const anchos = r.cabeceras.map((h) => h.length);

  r.datos.forEach((fila, f) => {
    const meta = metaFila(fila, r.filas?.[f]);
    const row = ws.addRow(
      fila.map((texto, i) => {
        const v = valorCelda(texto);
        if (numericas[i] && v.tipo !== "texto") return v.valor;
        return v.tipo === "texto" ? v.valor : texto;
      })
    );
    fila.forEach((texto, i) => {
      anchos[i] = Math.max(anchos[i] ?? 0, String(texto ?? "").length);
      const v = valorCelda(texto);
      if (numericas[i] && v.tipo !== "texto") row.getCell(i + 1).numFmt = FORMATO_EXCEL[v.tipo];
    });
    if (r.filas) {
      // Sangría de la primera celda y agrupación plegable: al cerrar una
      // sucursal quedan a la vista su encabezado y su subtotal.
      row.getCell(1).alignment = { indent: meta.nivel * 2 };
      anchos[0] = Math.max(anchos[0] ?? 0, String(fila[0] ?? "").length + meta.nivel * 2);
      if (meta.tipo !== "total" && meta.nivel > 0) row.outlineLevel = Math.min(7, meta.nivel);
    }
    if (meta.tipo === "grupo") {
      row.font = { bold: true, color: { argb: "FF0D2B38" } };
      const fondo = FONDO_GRUPO_EXCEL[Math.min(meta.nivel, FONDO_GRUPO_EXCEL.length - 1)];
      for (let c = 1; c <= columnas; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } };
    }
    if (meta.tipo === "subtotal" || meta.tipo === "total") {
      row.font = { bold: true };
      for (let c = 1; c <= columnas; c++) row.getCell(c).border = { top: { style: "thin", color: { argb: "FFC3CED4" } } };
    }
  });

  ws.columns.forEach((col, i) => {
    col.width = Math.min(50, Math.max(10, (anchos[i] ?? 10) + 2));
  });
  // El autofiltro de una tabla agrupada separaría encabezados y subtotales de
  // sus filas: sólo en las tablas planas.
  if (!r.filas) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + r.datos.length, column: columnas } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

const FUENTES_ESTANDAR = new Set(["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"]);
let fuentesListas = false;

function prepararFuentes() {
  if (fuentesListas) return;
  // Un reporte se arma sólo con lo que ya está en memoria: nada de descargar una
  // URL ni leer un archivo del disco que llegue dentro de una celda. Las fuentes
  // estándar se resuelven por la misma vía que un archivo local, así que se
  // permiten explícitamente.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((ruta: string) => FUENTES_ESTANDAR.has(ruta));
  pdfmake.addFonts({
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  });
  fuentesListas = true;
}

/** La instancia de pdfmake ya con las fuentes estándar y sin acceso a URL ni disco. La usan también los documentos. */
export function pdfmakeListo(): Pdfmake {
  prepararFuentes();
  return pdfmake;
}

const TINTA = "#0D2B38";
const LINEA = "#DCE3E7";
const PAPEL = "#F5F8F9";
const TENUE = "#637580";
/** Fondo del encabezado de grupo por nivel: sucursal, división, departamento. */
const FONDO_GRUPO_PDF = ["#DCE6EA", "#E9EFF2", "#F3F6F8"];

export async function aPdf(r: ReporteTabla): Promise<Buffer> {
  prepararFuentes();
  const numericas = columnasNumericas(r.cabeceras, r.datos);
  const apaisado = r.cabeceras.length > 6;
  const tamano = r.cabeceras.length > 9 ? 7 : 8;

  const encabezado: TableCell[] = r.cabeceras.map((h, i) => ({
    text: h,
    bold: true,
    color: "#FFFFFF",
    fillColor: TINTA,
    fontSize: tamano,
    alignment: numericas[i] ? "right" : "left",
    margin: [4, 4, 4, 4],
  }));

  const cuerpo: TableCell[][] = r.datos.map((fila, f) => {
    const m = metaFila(fila, r.filas?.[f]);
    const sangria = r.filas ? m.nivel * 10 : 0;
    if (m.tipo === "grupo") {
      // El encabezado de un grupo ocupa la fila entera: un nombre largo no
      // queda apretado en la primera columna.
      const fondo = FONDO_GRUPO_PDF[Math.min(m.nivel, FONDO_GRUPO_PDF.length - 1)];
      return [
        { text: String(fila[0] ?? ""), colSpan: r.cabeceras.length, bold: true, color: TINTA, fontSize: tamano, fillColor: fondo, margin: [4 + sangria, 3, 4, 3] },
        ...r.cabeceras.slice(1).map(() => ({})),
      ];
    }
    const resaltada = m.tipo === "subtotal" || m.tipo === "total";
    return r.cabeceras.map((_, i) => ({
      text: String(fila[i] ?? ""),
      fontSize: tamano,
      bold: resaltada,
      alignment: numericas[i] ? "right" : "left",
      // En una tabla agrupada las bandas alternas competirían con los grupos.
      fillColor: m.tipo === "total" ? "#EBF0F2" : m.tipo === "subtotal" ? "#F1F5F7" : !r.filas && f % 2 === 1 ? PAPEL : undefined,
      margin: [4 + (i === 0 ? sangria : 0), 3, 4, 3],
    }));
  });

  const meta = [
    `Generado el ${r.generado.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}`,
    `${contarDetalles(r.datos, r.filas)} registros`,
    ...r.filtros,
  ].join("  ·  ");

  const contenido: Content[] = [
    { text: r.titulo, fontSize: 14, bold: true, color: TINTA, margin: [0, 0, 0, 2] },
    { text: meta, fontSize: 8, color: TENUE, margin: [0, 0, 0, 10] },
    r.datos.length === 0
      ? { text: "Sin registros para los filtros elegidos.", fontSize: 9, color: TENUE, italics: true }
      : {
          table: {
            headerRows: 1,
            widths: r.cabeceras.map((_, i) => (i === 0 || (!numericas[i] && i === 1) ? "*" : "auto")),
            body: [encabezado, ...cuerpo],
          },
          layout: {
            hLineWidth: (i: number, nodo: { table: { body: unknown[] } }) => (i === 0 || i === nodo.table.body.length ? 0.8 : 0.4),
            vLineWidth: () => 0,
            hLineColor: () => LINEA,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
          },
        },
  ];

  const definicion: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageOrientation: apaisado ? "landscape" : "portrait",
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#142129" },
    info: { title: r.titulo, author: "NominaHN", creator: "NominaHN" },
    content: contenido,
    footer: (pagina: number, total: number) => ({
      columns: [
        { text: "NominaHN", fontSize: 8, color: TENUE, margin: [36, 10, 0, 0] },
        { text: `Página ${pagina} de ${total}`, fontSize: 8, color: TENUE, alignment: "right", margin: [0, 10, 36, 0] },
      ],
    }),
  };

  return pdfmake.createPdf(definicion).getBuffer();
}
