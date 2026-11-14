/**
 * Lectura de las celdas de un reporte: lo que comparten el visor en pantalla,
 * el Excel y el PDF. Sin dependencias de servidor, para que el componente
 * cliente pueda importarlo.
 */

export type TipoCelda = "moneda" | "numero" | "porcentaje" | "texto";

const RE_MONEDA = /^-?L\s?-?[\d,]+\.\d{2}$/;
const RE_NUMERO = /^-?\d+(\.\d+)?$/;
const RE_PORCENTAJE = /^-?\d+(\.\d+)?%$/;

/** Interpreta el texto de una celda: moneda en lempiras, número, porcentaje o texto. */
export function valorCelda(texto: string): { tipo: TipoCelda; valor: number | string } {
  const s = String(texto ?? "").trim();
  if (RE_MONEDA.test(s)) {
    const negativo = s.startsWith("-") || /L\s?-/.test(s);
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return { tipo: "moneda", valor: negativo ? -n : n };
  }
  if (RE_NUMERO.test(s)) return { tipo: "numero", valor: parseFloat(s) };
  if (RE_PORCENTAJE.test(s)) return { tipo: "porcentaje", valor: parseFloat(s) / 100 };
  return { tipo: "texto", valor: s };
}

/** Una fila de totales empieza por «TOTAL» en su primera celda con contenido. */
export function esFilaTotal(fila: string[]): boolean {
  const primera = fila.find((c) => String(c ?? "").trim() !== "") ?? "";
  return /^TOTAL/i.test(primera.trim());
}

/** Columnas en las que todas las celdas con contenido son numéricas. */
export function columnasNumericas(cabeceras: string[], datos: string[][]): boolean[] {
  return cabeceras.map((_, i) => {
    let conContenido = 0;
    for (const fila of datos) {
      const s = String(fila[i] ?? "").trim();
      if (s === "") continue;
      conContenido++;
      if (valorCelda(s).tipo === "texto") return false;
    }
    return conContenido > 0;
  });
}

// ─── Papel ────────────────────────────────────────────────────────────────────

/**
 * Tamaños de papel para imprimir. La planilla detallada lleva quince columnas: en
 * carta la letra queda en 6 puntos; en legal o doble carta se lee sin lupa. Medidas en
 * puntos (72 por pulgada); `excel` es el código de tamaño de la hoja de Excel.
 */
export type Papel = "CARTA" | "OFICIO" | "LEGAL" | "DOBLE_CARTA";

export const PAPELES: Record<Papel, { etiqueta: string; pdf: "LETTER" | "FOLIO" | "LEGAL" | "TABLOID"; corto: number; largo: number; excel: number }> = {
  CARTA: { etiqueta: "Carta (8.5 × 11 pulg.)", pdf: "LETTER", corto: 612, largo: 792, excel: 1 },
  OFICIO: { etiqueta: "Oficio (8.5 × 13 pulg.)", pdf: "FOLIO", corto: 612, largo: 936, excel: 14 },
  LEGAL: { etiqueta: "Legal (8.5 × 14 pulg.)", pdf: "LEGAL", corto: 612, largo: 1008, excel: 5 },
  DOBLE_CARTA: { etiqueta: "Doble carta (11 × 17 pulg.)", pdf: "TABLOID", corto: 792, largo: 1224, excel: 3 },
};

export function leerPapel(valor: string | null | undefined): Papel | undefined {
  return valor && valor in PAPELES ? (valor as Papel) : undefined;
}

/** Sin papel elegido: carta, salvo los reportes muy anchos, que van en legal. */
export function papelPorOmision(columnas: number): Papel {
  return columnas > 12 ? "LEGAL" : "CARTA";
}

// ─── Filas de un reporte jerárquico ───────────────────────────────────────────

/**
 * Qué es cada fila en un reporte agrupado (Sucursal → División → Departamento):
 * el encabezado de un grupo, una línea de detalle, el subtotal de un grupo o el
 * total general. `nivel` es la profundidad y da la sangría de la primera celda.
 */
export type TipoFila = "grupo" | "detalle" | "subtotal" | "total";
export interface MetaFila {
  tipo: TipoFila;
  nivel: number;
}

/** Parte de un reporte que se imprime aparte: en el PDF empieza en otra página y en Excel es otra pestaña. */
export interface HojaReporte {
  /** Se imprime bajo el título: «Sucursal / División». */
  nombre: string;
  /** Nombre corto para la pestaña de Excel. */
  pestana: string;
  /** Lo que se dice debajo del título en lugar de «N registros» (en un resumen no hay registros). */
  descripcion?: string;
  cabeceras: string[];
  datos: string[][];
  filas: MetaFila[];
}

/**
 * Tipo y nivel de una fila: los que declara el reporte, o —en los reportes
 * planos, que no declaran nada— «total» si empieza por TOTAL y si no «detalle».
 */
export function metaFila(fila: string[], meta?: MetaFila): MetaFila {
  return meta ?? { tipo: esFilaTotal(fila) ? "total" : "detalle", nivel: 0 };
}

/** Cuántas filas son registros de verdad (no encabezados, subtotales ni totales). */
export function contarDetalles(datos: string[][], filas?: MetaFila[]): number {
  return datos.filter((f, i) => metaFila(f, filas?.[i]).tipo === "detalle").length;
}
