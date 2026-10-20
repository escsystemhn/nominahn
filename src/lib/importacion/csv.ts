/**
 * Lectura y escritura de CSV para exportar e importar.
 *
 * POR QUÉ UN PARSER PROPIO Y NO `split(",")`: los datos reales de una nómina
 * hondureña rompen el atajo el primer día. Una dirección lleva comas ("Col. Las
 * Colinas, Bloque C"), una observación lleva comillas, y un motivo de deducción
 * puede llevar un salto de línea. RFC 4180 contempla los tres casos; `split` no.
 *
 * POR QUÉ DETECTAR CODIFICACIÓN Y DELIMITADOR: el archivo que va a subir RRHH no
 * lo produce esta aplicación, lo produce Excel. Y Excel en un Windows en español
 * guarda "CSV (delimitado por comas)" con PUNTO Y COMA como separador —porque la
 * coma es el separador decimal de la configuración regional— y con codificación
 * ANSI (windows-1252), no UTF-8. Un importador que asuma "coma + UTF-8" rechaza
 * el archivo entero o, peor, mete "Núñez" en la base como "NÃºÃ±ez".
 *
 * Se aceptan por tanto: coma, punto y coma o tabulador; UTF-8 con o sin BOM,
 * UTF-16LE, y windows-1252 como último recurso.
 */

import { celdaCsv, BOM_UTF8 } from "@/lib/reportes/formato";

/** Delimitadores que sabemos leer, por orden de preferencia al desempatar. */
const DELIMITADORES = [",", ";", "\t"] as const;
export type Delimitador = (typeof DELIMITADORES)[number];

export interface CsvParseado {
  cabeceras: string[];
  /** Filas de datos. Cada una conserva su número de línea REAL del archivo. */
  filas: Array<{ linea: number; celdas: string[] }>;
  delimitador: Delimitador;
}

// ─── DECODIFICACIÓN ───────────────────────────────────────────────────────────

/**
 * Bytes → texto, adivinando la codificación.
 *
 * El orden importa: primero las marcas BOM, que son inequívocas; después UTF-8
 * en modo estricto, que FALLA ante bytes inválidos; y sólo si falla, windows-1252,
 * que nunca falla porque cualquier byte es un carácter válido. Intentar
 * windows-1252 antes convertiría todo UTF-8 correcto en mojibake silencioso.
 */
export function decodificar(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Lo que guarda Excel en un Windows con configuración regional española.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ─── DELIMITADOR ──────────────────────────────────────────────────────────────

/**
 * Cuenta apariciones de un carácter FUERA de comillas, en la primera línea
 * lógica. Contar dentro de comillas haría ganar al delimitador equivocado en
 * cuanto una cabecera llevara una coma entrecomillada.
 */
function contarFuera(texto: string, caracter: string): number {
  let dentro = false;
  let total = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (dentro && texto[i + 1] === '"') i++; // comilla escapada
      else dentro = !dentro;
    } else if (!dentro && c === caracter) {
      total++;
    } else if (!dentro && (c === "\n" || c === "\r")) {
      break; // fin de la primera línea lógica
    }
  }
  return total;
}

/** Delimitador con más apariciones en la cabecera. Empate → coma. */
export function detectarDelimitador(texto: string): Delimitador {
  let mejor: Delimitador = ",";
  let maximo = 0;
  for (const d of DELIMITADORES) {
    const n = contarFuera(texto, d);
    if (n > maximo) {
      maximo = n;
      mejor = d;
    }
  }
  return mejor;
}

// ─── LECTURA ──────────────────────────────────────────────────────────────────

/**
 * Deshace la protección anti-fórmula que aplica `celdaCsv` al exportar.
 *
 * `celdaCsv` antepone un apóstrofo a los valores que empiezan por `= + - @` para
 * que Excel no los ejecute. Sin esta función, exportar y volver a importar
 * convertiría un teléfono "+504 2233-4455" en "'+504 2233-4455" — el archivo
 * dejaría de ser de ida y vuelta, que es justo lo que se le pide.
 */
export function desproteger(valor: string): string {
  return /^'[=+\-@\t\r]/.test(valor) ? valor.slice(1) : valor;
}

/**
 * Parser RFC 4180.
 *
 * Máquina de estados de un solo recorrido: soporta comillas, comillas escapadas
 * (`""`), saltos de línea dentro de campos entrecomillados y finales de línea
 * LF, CRLF o CR sueltos.
 *
 * Cada fila lleva su número de línea real del archivo (1 = cabecera), porque el
 * informe de validación tiene que decir "línea 47" y esa cuenta se descuadra en
 * cuanto un campo contiene un salto de línea.
 */
export function parsearCsv(texto: string, delimitadorForzado?: Delimitador): CsvParseado {
  // Un BOM que sobreviviera a la decodificación quedaría pegado a la primera
  // cabecera y ningún nombre de columna coincidiría.
  const limpio = texto.replace(/^\uFEFF/, "");
  const delimitador = delimitadorForzado ?? detectarDelimitador(limpio);

  const registros: Array<{ linea: number; celdas: string[] }> = [];
  let celdas: string[] = [];
  let actual = "";
  let dentro = false;
  let linea = 1;
  let lineaRegistro = 1;
  let hayContenido = false;

  const cerrarCelda = () => {
    celdas.push(desproteger(actual.trim()));
    actual = "";
  };

  const cerrarRegistro = () => {
    cerrarCelda();
    // Se descartan las líneas totalmente vacías: Excel deja una al final del
    // archivo y no debe contar como una fila con todos los campos en blanco.
    if (hayContenido || celdas.some((c) => c !== "")) {
      registros.push({ linea: lineaRegistro, celdas });
    }
    celdas = [];
    hayContenido = false;
    lineaRegistro = linea;
  };

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];

    if (dentro) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          dentro = false;
        }
      } else if (c === "\r") {
        // CRLF dentro de un campo entrecomillado: se normaliza a un solo salto
        // para que el valor guardado no arrastre el retorno de carro de Windows.
        if (limpio[i + 1] === "\n") continue;
        linea++;
        actual += "\n";
      } else {
        if (c === "\n") linea++;
        actual += c;
      }
      continue;
    }

    if (c === '"') {
      dentro = true;
      hayContenido = true;
    } else if (c === delimitador) {
      cerrarCelda();
    } else if (c === "\r") {
      // CRLF cuenta como un único final de línea.
      if (limpio[i + 1] === "\n") i++;
      linea++;
      cerrarRegistro();
    } else if (c === "\n") {
      linea++;
      cerrarRegistro();
    } else {
      actual += c;
      if (c.trim() !== "") hayContenido = true;
    }
  }

  // Última línea sin salto final.
  if (actual !== "" || celdas.length > 0 || hayContenido) cerrarRegistro();

  const [cabecera, ...resto] = registros;
  return {
    cabeceras: cabecera ? cabecera.celdas : [],
    filas: resto,
    delimitador,
  };
}

// ─── ESCRITURA ────────────────────────────────────────────────────────────────

/**
 * Serializa a CSV, reutilizando `celdaCsv` de los reportes (que ya neutraliza la
 * inyección de fórmulas) y el BOM UTF-8 que evita que Excel en Windows destroce
 * las eñes y las tildes.
 *
 * Se emite con CRLF porque es lo que manda RFC 4180 y lo que Excel espera.
 */
export function generarCsv(
  cabeceras: readonly string[],
  filas: readonly (readonly string[])[],
  delimitador: Delimitador = ","
): string {
  const lineas = [
    cabeceras.map(celdaCsv).join(delimitador),
    ...filas.map((fila) => fila.map(celdaCsv).join(delimitador)),
  ];
  return BOM_UTF8 + lineas.join("\r\n") + "\r\n";
}

/**
 * Normaliza el delimitador que llega por query.
 *
 * Existe porque Excel abre un `.csv` usando el separador de listas de la
 * configuracion regional: en un Windows en espanol suele ser `;`, y entonces un
 * archivo separado por comas se ve como una sola columna. Poder pedir `;` evita
 * ese tropiezo sin renunciar a la coma por omision, que es lo interoperable.
 */
export function delimitadorPedido(valor: string | null): Delimitador {
  if (valor === ";" || valor === "punto_y_coma") return ";";
  if (valor === "\t" || valor === "tab") return "\t";
  return ",";
}

/** Cabeceras HTTP de una descarga CSV. `no-store`: lleva datos personales. */
export function cabecerasDescarga(nombreArchivo: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${nombreArchivo.replace(/[^a-zA-Z0-9_.-]/g, "")}"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

// ─── NORMALIZACIÓN DE CABECERAS ───────────────────────────────────────────────

/**
 * Reduce una cabecera a su forma comparable: sin tildes, sin espacios, en
 * minúsculas. Así "Salario Base", "salario_base" y "SALARIO BASE" son la misma
 * columna — y quien edite el archivo en Excel no tiene que respetar la
 * tipografía exacta para que la importación funcione.
 */
export function normalizarCabecera(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Columna que el importador sabe reconocer. */
export interface ColumnaEsperada {
  /** Nombre interno con el que se consulta la celda. */
  clave: string;
  /** Cabecera que escribe el exportador. */
  etiqueta?: string;
  /** Otras formas de escribirla que se aceptan al importar. */
  alias?: readonly string[];
}

/**
 * Asocia cada columna esperada con su índice en el archivo.
 *
 * SE BUSCA POR CLAVE **Y** POR ETIQUETA. Es imprescindible para que el archivo
 * sea de ida y vuelta: el exportador escribe la etiqueta ("Codigo Supervisor")
 * mientras que el código consulta la clave (`supervisor_codigo`), y las dos
 * normalizan distinto. Buscando sólo por la clave, catorce columnas exportadas
 * volvían a entrar como "no reconocidas" y sus valores se perdían en silencio.
 *
 * Devuelve además las cabeceras que no corresponden a ninguna columna conocida,
 * para poder avisar de un "Salaio Base" mal escrito en vez de aplicar un cambio
 * a medias.
 */
export function mapearColumnas(
  cabeceras: readonly string[],
  esperadas: readonly (string | ColumnaEsperada)[]
): { indices: Record<string, number>; desconocidas: string[] } {
  const normalizadas = cabeceras.map(normalizarCabecera);
  const indices: Record<string, number> = {};
  const usadas = new Set<number>();

  for (const esperada of esperadas) {
    const columna: ColumnaEsperada = typeof esperada === "string" ? { clave: esperada } : esperada;
    const candidatos = [columna.clave, columna.etiqueta, ...(columna.alias ?? [])].filter(
      (x): x is string => !!x
    );

    for (const candidato of candidatos) {
      const i = normalizadas.indexOf(normalizarCabecera(candidato));
      // `usadas` evita que dos columnas distintas reclamen la misma cabecera
      // cuando sus nombres normalizan igual.
      if (i >= 0 && !usadas.has(i)) {
        indices[columna.clave] = i;
        usadas.add(i);
        break;
      }
    }
  }

  const desconocidas = cabeceras.filter((c, i) => !usadas.has(i) && c.trim() !== "");
  return { indices, desconocidas };
}
