/**
 * Serialización de los reportes descargables.
 *
 * El endpoint /api/reportes genera la tabla en JSON (para verla en la aplicacion),
 * Excel, PDF, CSV y HTML. Estas funciones blindan la salida en texto y viven aparte
 * de la ruta para poder probarlas directamente.
 */

/**
 * Escapa texto antes de incrustarlo en el HTML del reporte.
 *
 * Las celdas salen de la base (nombres, motivos, observaciones: campos que
 * editan los usuarios) y el título incluye el `reporteId` que llega por query.
 * Sin escapar, un valor con etiquetas se ejecutaría al abrir en el navegador el
 * archivo descargado.
 */
export function escaparHtml(valor: string): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serializa una celda de CSV.
 *
 * Además del entrecomillado estándar, antepone un apóstrofo a los valores que
 * empiezan por `= + - @` (o tab/retorno): Excel y LibreOffice los interpretan
 * como fórmula, de modo que un dato guardado como `=HYPERLINK(...)` se
 * ejecutaría al abrir el archivo.
 */
export function celdaCsv(valor: string): string {
  const s = String(valor);
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * Limita `reporteId` a caracteres seguros para usarlo como nombre de archivo en
 * la cabecera Content-Disposition. Llega por query, así que sin sanear podría
 * inyectar comillas o saltos de línea en la cabecera.
 */
export function nombreArchivoSeguro(reporteId: string): string {
  return reporteId.replace(/[^a-zA-Z0-9_-]/g, "") || "reporte";
}

/**
 * Marca de agua UTF-8 al inicio del CSV. Sin ella Excel en Windows abre el
 * archivo con la codificación ANSI del sistema y corrompe acentos y eñes de los
 * nombres — algo que en una nómina hondureña se nota en casi cada fila.
 */
export const BOM_UTF8 = "﻿";

/** Formatos que sabe emitir el endpoint: tabla JSON para verlo en la aplicacion, Excel, PDF, CSV y HTML. */
export type FormatoReporte = "CSV" | "HTML" | "XLSX" | "PDF" | "JSON";

/**
 * Normaliza el parámetro `formato`. "EXCEL" y "PDF" se siguen aceptando como
 * valores heredados —eran los que mandaba la UI antigua— para no romper enlaces
 * guardados, pero se mapean a lo que de verdad se genera.
 */
export function normalizarFormato(valor: string | null): FormatoReporte {
  const v = (valor ?? "").toUpperCase();
  if (v === "CSV") return "CSV";
  if (v === "XLSX" || v === "EXCEL") return "XLSX";
  if (v === "PDF") return "PDF";
  if (v === "JSON") return "JSON";
  return "HTML";
}
