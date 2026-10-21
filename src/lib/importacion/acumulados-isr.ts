/**
 * Lectura de la hoja «Retención en la fuente» (formato de Excel que usan algunos
 * clientes para calcular la retención del ISR) para importar los acumulados de
 * los meses anteriores: sueldo, comisiones e ISR retenido por empleado y mes.
 *
 * Se buscan las columnas por su NOMBRE, no por su posición: «Nombre», «RTN»,
 * «Sueldo Enero» … «Sueldo Diciembre», «Comisiones y otros Enero» … y
 * «Retencion Enero» …, en la primera hoja que las tenga (normalmente DATOS). El
 * año y el mes del archivo salen de las celdas «Año» y «Mes» de arriba.
 */

import ExcelJS from "exceljs";

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface MesAcumulado {
  mes: number;
  sueldo: number;
  variables: number;
  isrRetenido: number;
}

export interface FilaAcumuladoIsr {
  /** Fila de la hoja, para los mensajes. */
  fila: number;
  nombre: string;
  /** Sólo dígitos. */
  rtn: string;
  meses: MesAcumulado[];
}

export interface LecturaAcumuladosIsr {
  hoja: string | null;
  anio: number | null;
  /** Mes en curso del archivo (1–12): sus retenciones de ese mes aún son cálculo, no lo retenido. */
  mesArchivo: number | null;
  filas: FilaAcumuladoIsr[];
  errores: string[];
}

/** Para comparar cabeceras: sin tildes, en minúscula, espacios simples. */
export const normalizarTexto = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const vacia = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Valor de una celda: el resultado si es fórmula; texto enriquecido unido. */
function valor(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object") {
    if ("result" in v) return v.result ?? null;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return v.text;
    if ("error" in v) return null;
  }
  return v;
}

const numero = (v: unknown): number | null => {
  if (vacia(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function leerHojaRetencion(bytes: ArrayBuffer | Uint8Array): Promise<LecturaAcumuladosIsr> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    return { hoja: null, anio: null, mesArchivo: null, filas: [], errores: ["No se pudo leer el archivo: debe ser un libro de Excel (.xlsx)."] };
  }

  for (const ws of wb.worksheets) {
    // Fila de cabeceras: la primera (de las 20 de arriba) que tenga «Nombre», «RTN» y algún «Sueldo <mes>».
    let filaCab = 0;
    const col = new Map<string, number>();
    for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
      const textos = new Map<string, number>();
      ws.getRow(r).eachCell((c, i) => { textos.set(normalizarTexto(valor(c.value)), i); });
      if (textos.has("nombre") && textos.has("rtn") && [...textos.keys()].some((k) => k.startsWith("sueldo "))) {
        filaCab = r;
        textos.forEach((i, k) => col.set(k, i));
        break;
      }
    }
    if (!filaCab) continue;

    // Año y mes: celdas «Año» y «Mes» encima de las cabeceras (valor a la derecha).
    let anio: number | null = null;
    let mesArchivo: number | null = null;
    for (let r = 1; r < filaCab; r++) {
      const row = ws.getRow(r);
      const etiqueta = normalizarTexto(valor(row.getCell(1).value));
      const v = valor(row.getCell(2).value);
      if (etiqueta === "ano" || etiqueta === "año") anio = numero(v);
      if (etiqueta === "mes") {
        const i = MESES.indexOf(normalizarTexto(v));
        mesArchivo = i >= 0 ? i + 1 : numero(v);
      }
    }

    const columna = (prefijos: string[], mes: string) => {
      for (const p of prefijos) {
        const i = col.get(`${p} ${mes}`);
        if (i) return i;
      }
      return 0;
    };
    const filas: FilaAcumuladoIsr[] = [];
    const errores: string[] = [];
    for (let r = filaCab + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nombre = String(valor(row.getCell(col.get("nombre")!).value) ?? "").replace(/\s+/g, " ").trim();
      if (!nombre) continue;
      if (/^total/i.test(nombre)) continue;
      const rtn = String(valor(row.getCell(col.get("rtn")!).value) ?? "").replace(/\D/g, "");
      const meses: MesAcumulado[] = [];
      MESES.forEach((m, i) => {
        const cS = columna(["sueldo"], m);
        const cV = columna(["comisiones y otros", "comisiones", "variables"], m);
        const cR = columna(["retencion", "isr retenido"], m);
        const vS = cS ? valor(row.getCell(cS).value) : null;
        const vV = cV ? valor(row.getCell(cV).value) : null;
        const vR = cR ? valor(row.getCell(cR).value) : null;
        if (vacia(vS) && vacia(vV) && vacia(vR)) return;
        meses.push({ mes: i + 1, sueldo: numero(vS) ?? 0, variables: numero(vV) ?? 0, isrRetenido: numero(vR) ?? 0 });
      });
      if (!rtn) errores.push(`Fila ${r} (${nombre}): no tiene RTN; se buscará por nombre.`);
      filas.push({ fila: r, nombre, rtn, meses });
    }
    return { hoja: ws.name, anio, mesArchivo, filas, errores };
  }
  return {
    hoja: null, anio: null, mesArchivo: null, filas: [],
    errores: ["No se encontró una hoja con las columnas «Nombre», «RTN» y «Sueldo <mes>» (como la hoja DATOS de la retención en la fuente)."],
  };
}
