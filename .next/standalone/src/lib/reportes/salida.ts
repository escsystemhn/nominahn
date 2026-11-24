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
import { valorCelda, columnasNumericas, metaFila, contarDetalles, conCifras, PAPELES, papelPorOmision, type HojaReporte, type Papel, type TipoCelda, type MetaFila } from "./salida-celdas";
import { PRODUCTO } from "@/lib/marca";

export { valorCelda, esFilaTotal, columnasNumericas, metaFila, contarDetalles, conCifras, PAPELES, leerPapel, papelPorOmision } from "./salida-celdas";
export type { HojaReporte, Papel, TipoCelda, TipoFila, MetaFila } from "./salida-celdas";

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
  /** Para imprimir por partes. Con hojas, el PDF y el Excel las usan en vez de `datos`. */
  hojas?: HojaReporte[];
  /** Papel del PDF y de la impresión desde Excel. Sin él, `papelPorOmision`. */
  papel?: Papel;
}

/**
 * Tamaño de letra para que las columnas quepan a lo ancho. Cada columna de montos
 * ocupa unas 6.1 veces el tamaño de letra («L 165,841.52» en Helvetica) más 8 puntos
 * de margen; la de nombres se lleva lo que sobre, al menos 12 veces. En carta se
 * conservan los tamaños de siempre (8, o 7 con más de 9 columnas) como máximo.
 */
export function tamanoLetra(columnas: number, anchoUtil: number, enCarta: boolean): number {
  const otras = Math.max(1, columnas - 1);
  const cabe = (anchoUtil - 8 * otras) / (6.1 * otras + 12);
  const tope = enCarta ? (columnas > 9 ? 7 : 8) : 9;
  return Math.max(6, Math.min(tope, Math.floor(cabe * 2) / 2));
}

function configurarImpresion(ws: ExcelJS.Worksheet, columnas: number, papel: Papel) {
  // Cada hoja se imprime a lo ancho de la página elegida, repitiendo sus cabeceras.
  ws.pageSetup = {
    orientation: columnas > 6 ? "landscape" : "portrait",
    paperSize: PAPELES[papel].excel as unknown as ExcelJS.PaperSize,
    fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4",
  };
}

// ─── Celdas ───────────────────────────────────────────────────────────────────

/** Nombre de hoja válido para Excel: sin `[]:*?/\` y hasta 31 caracteres. */
export function nombreHoja(titulo: string): string {
  const limpio = titulo.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim();
  return (limpio || "Reporte").slice(0, 31);
}

/** Excel no admite dos pestañas con el mismo nombre, y dos sucursales pueden tener una «Administración». */
function nombreHojaUnico(nombre: string, usados: Set<string>): string {
  const base = nombreHoja(nombre);
  let propuesto = base;
  for (let n = 2; usados.has(propuesto.toLowerCase()); n++) {
    const sufijo = ` (${n})`;
    propuesto = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(propuesto.toLowerCase());
  return propuesto;
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
  wb.creator = PRODUCTO;
  wb.created = r.generado;

  // Un mismo papel para todo el libro: el de la parte más ancha.
  const papel = r.papel ?? papelPorOmision(Math.max(r.cabeceras.length, ...(r.hojas ?? []).map((h) => h.cabeceras.length)));
  if (r.hojas?.length) {
    const usados = new Set<string>();
    for (const h of r.hojas) {
      const ws = escribirHoja(wb, nombreHojaUnico(h.pestana, usados), r, h, h.nombre);
      configurarImpresion(ws, Math.max(7, h.cabeceras.length), papel);
    }
  } else {
    const ws = escribirHoja(wb, nombreHoja(r.titulo), r, r);
    configurarImpresion(ws, r.cabeceras.length, papel);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function escribirHoja(
  wb: ExcelJS.Workbook,
  nombre: string,
  r: Pick<ReporteTabla, "titulo" | "generado" | "filtros">,
  tabla: Pick<ReporteTabla, "cabeceras" | "datos" | "filas"> & { descripcion?: string },
  subtitulo?: string
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 4 }] });
  const columnas = Math.max(1, tabla.cabeceras.length);
  const ultima = ws.getColumn(columnas).letter;

  ws.mergeCells(`A1:${ultima}1`);
  ws.getCell("A1").value = r.titulo;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0D2B38" } };

  ws.mergeCells(`A2:${ultima}2`);
  ws.getCell("A2").value = [`Generado el ${r.generado.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}`, tabla.descripcion ?? `${contarDetalles(tabla.datos, tabla.filas)} registros`, ...r.filtros].join(" · ");
  ws.getCell("A2").font = { size: 9, color: { argb: "FF637580" } };

  if (subtitulo) {
    ws.mergeCells(`A3:${ultima}3`);
    ws.getCell("A3").value = subtitulo;
    ws.getCell("A3").font = { bold: true, size: 11, color: { argb: "FF0D2B38" } };
  }

  const cabecera = ws.getRow(4);
  cabecera.values = tabla.cabeceras;
  cabecera.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cabecera.alignment = { vertical: "middle" };
  cabecera.height = 20;
  for (let c = 1; c <= columnas; c++) {
    cabecera.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D2B38" } };
  }

  const numericas = columnasNumericas(tabla.cabeceras, tabla.datos);
  const anchos = tabla.cabeceras.map((h) => h.length);

  tabla.datos.forEach((fila, f) => {
    const meta = metaFila(fila, tabla.filas?.[f]);
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
    if (tabla.filas) {
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
  if (!tabla.filas) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + tabla.datos.length, column: columnas } };

  return ws;
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

/**
 * La tabla de una parte del reporte. `rotulo` va dentro de la cabecera de la tabla
 * para que se repita en cada página: una división larga ocupa varias hojas, y una
 * hoja suelta debe poder decir de cuál es.
 */
function tablaPdf(t: Pick<ReporteTabla, "cabeceras" | "datos" | "filas">, tamano: number, rotulo?: string): Content {
  if (t.datos.length === 0) return { text: "Sin registros para los filtros elegidos.", fontSize: 9, color: TENUE, italics: true };

  // Una columna vacía (los días en un resumen) se alinea y se mide como las de números:
  // como texto se repartiría el ancho con la de nombres y los apretaría.
  const llenas = t.cabeceras.map((_, i) => t.datos.some((f) => String(f[i] ?? "").trim() !== ""));
  const numericas = columnasNumericas(t.cabeceras, t.datos).map((n, i) => n || !llenas[i]);

  const encabezado: TableCell[] = t.cabeceras.map((h, i) => ({
    text: h,
    bold: true,
    color: "#FFFFFF",
    fillColor: TINTA,
    fontSize: tamano,
    alignment: numericas[i] ? "right" : "left",
    margin: [4, 1, 4, 1],
  }));

  const cuerpo: TableCell[][] = t.datos.map((fila, f) => {
    const m = metaFila(fila, t.filas?.[f]);
    const sangria = t.filas ? m.nivel * 10 : 0;
    const fondoGrupo = FONDO_GRUPO_PDF[Math.min(m.nivel, FONDO_GRUPO_PDF.length - 1)];
    if (m.tipo === "grupo" && conCifras(fila)) {
      // Un encabezado con sus propios totales (la estructura organizacional) los lleva en sus columnas.
      return t.cabeceras.map((_, i) => ({
        text: String(fila[i] ?? ""), bold: true, color: TINTA, fontSize: tamano, fillColor: fondoGrupo,
        alignment: numericas[i] ? "right" : "left", margin: [4 + (i === 0 ? sangria : 0), 0, 4, 0],
      }));
    }
    if (m.tipo === "grupo") {
      // El encabezado de un grupo ocupa la fila entera: un nombre largo no
      // queda apretado en la primera columna.
      const fondo = fondoGrupo;
      return [
        { text: String(fila[0] ?? ""), colSpan: t.cabeceras.length, bold: true, color: TINTA, fontSize: tamano, fillColor: fondo, margin: [4 + sangria, 0, 4, 0] },
        ...t.cabeceras.slice(1).map(() => ({})),
      ];
    }
    const resaltada = m.tipo === "subtotal" || m.tipo === "total";
    return t.cabeceras.map((_, i) => ({
      text: String(fila[i] ?? ""),
      fontSize: tamano,
      bold: resaltada,
      alignment: numericas[i] ? "right" : "left",
      // En una tabla agrupada las bandas alternas competirían con los grupos.
      fillColor: m.tipo === "total" ? "#EBF0F2" : m.tipo === "subtotal" ? "#F1F5F7" : !t.filas && f % 2 === 1 ? PAPEL : undefined,
      margin: [4 + (i === 0 ? sangria : 0), 0, 4, 0],
    }));
  });

  const filaRotulo: TableCell[] | null = rotulo
    ? [
        { text: rotulo, colSpan: t.cabeceras.length, bold: true, color: TINTA, fontSize: tamano + 3, margin: [0, 0, 0, 2] },
        ...t.cabeceras.slice(1).map(() => ({})),
      ]
    : null;

  return {
    table: {
      headerRows: filaRotulo ? 2 : 1,
      widths: t.cabeceras.map((_, i) => (i === 0 || (!numericas[i] && i === 1) ? "*" : "auto")),
      body: [...(filaRotulo ? [filaRotulo] : []), encabezado, ...cuerpo],
    },
    layout: {
      hLineWidth: (i: number, nodo: { table: { body: unknown[] } }) => (i === 0 || i === nodo.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => LINEA,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
  };
}

export async function aPdf(r: ReporteTabla): Promise<Buffer> {
  prepararFuentes();
  const partes: Array<Pick<ReporteTabla, "cabeceras" | "datos" | "filas"> & { nombre?: string; descripcion?: string }> = r.hojas?.length ? r.hojas : [r];
  const columnas = Math.max(...partes.map((p) => p.cabeceras.length));
  const apaisado = columnas > 6;
  const papel = r.papel ?? papelPorOmision(columnas);
  const hoja = PAPELES[papel];
  const tamano = tamanoLetra(columnas, (apaisado ? hoja.largo : hoja.corto) - 72, papel === "CARTA");

  const contenido: Content[] = partes.flatMap((p, i) => {
    const meta = [
      `Generado el ${r.generado.toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}`,
      p.descripcion ?? `${contarDetalles(p.datos, p.filas)} registros`,
      ...r.filtros,
    ].join("  ·  ");
    const bloque: Content[] = [
      { text: r.titulo, fontSize: 14, bold: true, color: TINTA, margin: [0, 0, 0, 2], ...(i > 0 ? { pageBreak: "before" as const } : {}) },
      { text: meta, fontSize: 8, color: TENUE, margin: [0, 0, 0, 10] },
      tablaPdf(p, tamano, p.nombre),
    ];
    return bloque;
  });

  const definicion: TDocumentDefinitions = {
    pageSize: hoja.pdf,
    pageOrientation: apaisado ? "landscape" : "portrait",
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: "#142129" },
    info: { title: r.titulo, author: PRODUCTO, creator: PRODUCTO },
    content: contenido,
    footer: (pagina: number, total: number) => ({
      columns: [
        { text: PRODUCTO, fontSize: 8, color: TENUE, margin: [36, 10, 0, 0] },
        { text: `Página ${pagina} de ${total}`, fontSize: 8, color: TENUE, alignment: "right", margin: [0, 10, 36, 0] },
      ],
    }),
  };

  return pdfmake.createPdf(definicion).getBuffer();
}
