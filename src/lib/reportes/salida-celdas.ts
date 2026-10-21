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
