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
