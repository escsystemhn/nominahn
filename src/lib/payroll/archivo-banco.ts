/**
 * Archivo de pago para el banco, según un formato configurable. PURO.
 *
 * Cada banco exige su propia disposición (columnas, separador o ancho fijo,
 * relleno, formato del monto y de la fecha). No se programa un formato por
 * banco: se describe en `FormatoBanco` y este generador lo aplica. Los formatos
 * reales los entrega cada banco al cliente; aquí no se inventa ninguno.
 */

export type CampoBanco =
  | "cuenta"
  | "identidad"
  | "nombre"
  | "codigo"
  | "banco"
  | "monto"
  | "referencia"
  | "concepto"
  | "fechaPago"
  | "secuencia"
  | "constante";

export const CAMPOS_BANCO: { v: CampoBanco; l: string }[] = [
  { v: "cuenta", l: "Número de cuenta" },
  { v: "identidad", l: "Identidad del beneficiario" },
  { v: "nombre", l: "Nombre del beneficiario" },
  { v: "codigo", l: "Código de empleado" },
  { v: "banco", l: "Banco del empleado" },
  { v: "monto", l: "Monto" },
  { v: "referencia", l: "Referencia del pago" },
  { v: "concepto", l: "Concepto" },
  { v: "fechaPago", l: "Fecha de pago" },
  { v: "secuencia", l: "Número de línea" },
  { v: "constante", l: "Valor fijo" },
];

/**
 * Formato del valor:
 *   · monto: "DECIMAL" (1234.50), "DECIMAL_COMA" (1234,50), "CENTAVOS" (123450)
 *   · fechaPago: "AAAAMMDD", "DDMMAAAA", "DD/MM/AAAA", "AAAA-MM-DD"
 *   · texto: "MAYUSCULAS", "MAYUSCULAS_SIN_ACENTOS"
 */
export interface ColumnaBanco {
  campo: CampoBanco;
  titulo?: string;
  /** Sólo en ANCHO_FIJO. */
  ancho?: number;
  alinear?: "IZQUIERDA" | "DERECHA";
  relleno?: "ESPACIO" | "CERO";
  /** Para `constante`. */
  valor?: string;
  formato?: string;
}

export interface FormatoArchivoBanco {
  tipo: "DELIMITADO" | "ANCHO_FIJO";
  delimitador: string;
  encabezado: boolean;
  columnas: ColumnaBanco[];
  finLinea: "CRLF" | "LF";
  lineaTotal: boolean;
  filtroBanco?: string | null;
}

export interface FilaPago {
  cuenta: string | null;
  identidad: string | null;
  nombre: string;
  codigo: string;
  banco: string | null;
  monto: number;
}

export interface MetaPago {
  fechaPago: Date;
  referencia: string;
  concepto: string;
}

export interface ResultadoArchivo {
  contenido: string;
  incluidos: number;
  total: number;
  excluidos: { nombre: string; codigo: string; motivo: string; monto: number }[];
  avisos: string[];
  errores: string[];
}

export const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normal = (s: string | null | undefined) => sinAcentos((s ?? "").toLowerCase()).trim();

function formatoFecha(d: Date, formato: string | undefined): string {
  const a = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  switch (formato) {
    case "DDMMAAAA": return `${dd}${m}${a}`;
    case "DD/MM/AAAA": return `${dd}/${m}/${a}`;
    case "AAAA-MM-DD": return `${a}-${m}-${dd}`;
    default: return `${a}${m}${dd}`;
  }
}

function formatoMonto(n: number, formato: string | undefined): string {
  const c = Math.round(n * 100);
  if (formato === "CENTAVOS") return String(c);
  const txt = (c / 100).toFixed(2);
  return formato === "DECIMAL_COMA" ? txt.replace(".", ",") : txt;
}

function formatoTexto(s: string, formato: string | undefined): string {
  if (formato === "MAYUSCULAS") return s.toUpperCase();
  if (formato === "MAYUSCULAS_SIN_ACENTOS") return sinAcentos(s).toUpperCase().replace(/Ñ/g, "N");
  return s;
}

export function valorCampo(col: ColumnaBanco, fila: FilaPago | null, meta: MetaPago, secuencia: number, total?: number): string {
  switch (col.campo) {
    case "cuenta": return fila ? (fila.cuenta ?? "").replace(/[\s-]/g, "") : "";
    case "identidad": return fila ? (fila.identidad ?? "").replace(/[\s-]/g, "") : "";
    case "nombre": return formatoTexto(fila ? fila.nombre : "TOTAL", col.formato);
    case "codigo": return fila ? fila.codigo : "";
    case "banco": return formatoTexto(fila?.banco ?? "", col.formato);
    case "monto": return formatoMonto(fila ? fila.monto : total ?? 0, col.formato);
    case "referencia": return formatoTexto(meta.referencia, col.formato);
    case "concepto": return formatoTexto(meta.concepto, col.formato);
    case "fechaPago": return formatoFecha(meta.fechaPago, col.formato);
    case "secuencia": return fila ? String(secuencia) : String(secuencia - 1);
    case "constante": return col.valor ?? "";
  }
}

function celdaFija(valor: string, col: ColumnaBanco): { texto: string; recortado: boolean } {
  const ancho = Math.max(1, col.ancho ?? valor.length);
  const recortado = valor.length > ancho;
  const v = recortado ? valor.slice(0, ancho) : valor;
  const relleno = col.relleno === "CERO" ? "0" : " ";
  const alinear = col.alinear ?? (col.campo === "monto" || col.campo === "secuencia" ? "DERECHA" : "IZQUIERDA");
  return { texto: alinear === "DERECHA" ? v.padStart(ancho, relleno) : v.padEnd(ancho, relleno), recortado };
}

function celdaDelimitada(valor: string, delimitador: string): string {
  if (delimitador === ",") {
    return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
  }
  // Con otros separadores no hay convención de comillas: se quita el separador del dato.
  return valor.split(delimitador).join(" ").replace(/[\r\n]/g, " ");
}

export function validarFormato(f: FormatoArchivoBanco): string[] {
  const errores: string[] = [];
  if (f.columnas.length === 0) errores.push("Agregue al menos una columna.");
  if (!f.columnas.some((c) => c.campo === "monto")) errores.push("El archivo necesita una columna de monto.");
  if (!f.columnas.some((c) => c.campo === "cuenta")) errores.push("El archivo necesita una columna con el número de cuenta.");
  if (f.tipo === "DELIMITADO" && !f.delimitador) errores.push("Indique el separador.");
  if (f.tipo === "ANCHO_FIJO") {
    f.columnas.forEach((c, i) => {
      if (!(Number(c.ancho) >= 1)) errores.push(`La columna ${i + 1} necesita un ancho.`);
    });
  }
  f.columnas.forEach((c, i) => {
    if (c.campo === "constante" && c.valor === undefined) errores.push(`La columna ${i + 1} es un valor fijo sin valor.`);
  });
  return errores;
}

export function generarArchivoBanco(formato: FormatoArchivoBanco, filas: FilaPago[], meta: MetaPago): ResultadoArchivo {
  const errores = validarFormato(formato);
  const avisos: string[] = [];
  const excluidos: ResultadoArchivo["excluidos"] = [];
  const filtro = normal(formato.filtroBanco);

  const incluidas: FilaPago[] = [];
  for (const f of filas) {
    if (!(f.monto > 0)) {
      excluidos.push({ nombre: f.nombre, codigo: f.codigo, motivo: "Neto en cero", monto: f.monto });
      continue;
    }
    if (!f.cuenta?.trim()) {
      excluidos.push({ nombre: f.nombre, codigo: f.codigo, motivo: "Sin cuenta bancaria: pago manual", monto: f.monto });
      continue;
    }
    if (filtro && !normal(f.banco).includes(filtro)) {
      excluidos.push({ nombre: f.nombre, codigo: f.codigo, motivo: `Su banco no es ${formato.filtroBanco}`, monto: f.monto });
      continue;
    }
    incluidas.push(f);
  }

  const total = Math.round(incluidas.reduce((s, f) => s + f.monto, 0) * 100) / 100;
  const lineas: string[] = [];
  const recortes = new Set<string>();

  const linea = (fila: FilaPago | null, secuencia: number) => {
    const celdas = formato.columnas.map((c) => {
      const v = valorCampo(c, fila, meta, secuencia, total);
      if (formato.tipo === "ANCHO_FIJO") {
        const r = celdaFija(v, c);
        if (r.recortado) recortes.add(`${c.titulo || c.campo} (ancho ${c.ancho})`);
        if (r.recortado && (c.campo === "monto" || c.campo === "cuenta")) {
          errores.push(`El ${c.campo === "monto" ? "monto" : "número de cuenta"} de ${fila?.nombre ?? "la línea de total"} no cabe en ${c.ancho} posiciones.`);
        }
        return r.texto;
      }
      return celdaDelimitada(v, formato.delimitador);
    });
    return formato.tipo === "ANCHO_FIJO" ? celdas.join("") : celdas.join(formato.delimitador);
  };

  if (formato.encabezado && formato.tipo === "DELIMITADO") {
    lineas.push(formato.columnas.map((c) => celdaDelimitada(c.titulo || c.campo, formato.delimitador)).join(formato.delimitador));
  }
  incluidas.forEach((f, i) => lineas.push(linea(f, i + 1)));
  if (formato.lineaTotal) lineas.push(linea(null, incluidas.length + 1));

  if (recortes.size) avisos.push(`Se recortaron datos que no cabían: ${[...recortes].join(", ")}.`);
  const fin = formato.finLinea === "LF" ? "\n" : "\r\n";
  return {
    contenido: lineas.join(fin) + (lineas.length ? fin : ""),
    incluidos: incluidas.length,
    total,
    excluidos,
    avisos,
    errores: [...new Set(errores)],
  };
}

/** Formato de partida: el mismo CSV que daba el reporte «Dispersión bancaria». */
export const FORMATO_GENERICO: FormatoArchivoBanco & { nombre: string; extension: string; codificacion: string } = {
  nombre: "Genérico (CSV)",
  extension: "csv",
  codificacion: "utf8",
  tipo: "DELIMITADO",
  delimitador: ",",
  encabezado: true,
  finLinea: "CRLF",
  lineaTotal: false,
  filtroBanco: null,
  columnas: [
    { campo: "banco", titulo: "Banco" },
    { campo: "cuenta", titulo: "Cuenta" },
    { campo: "identidad", titulo: "Identidad" },
    { campo: "nombre", titulo: "Beneficiario" },
    { campo: "monto", titulo: "Monto", formato: "DECIMAL" },
    { campo: "referencia", titulo: "Referencia" },
  ],
};
