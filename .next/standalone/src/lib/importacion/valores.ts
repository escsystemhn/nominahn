/**
 * Conversión de las celdas de un CSV a los tipos que espera la base.
 *
 * Cada función devuelve `{ ok, valor }` o `{ ok: false, error }` en vez de
 * lanzar: la importación tiene que poder decir "línea 47, columna salario_base:
 * ..." y seguir revisando el resto del archivo. Una excepción abortaría la
 * validación en el primer error y obligaría al usuario a corregir de uno en uno.
 *
 * Ninguna de estas funciones acepta un valor dudoso "haciendo lo que
 * probablemente quiso decir". En una nómina, adivinar mal una fecha o un
 * separador decimal no da un error visible: da un pago incorrecto.
 */

import { Prisma } from "@prisma/client";
import { redondear, type Money } from "@/lib/payroll/money";

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const error = (mensaje: string): Resultado<never> => ({ ok: false, error: mensaje });

/** ¿La celda está vacía? Un espacio en blanco cuenta como vacío. */
export function vacia(valor: string | undefined): boolean {
  return valor === undefined || valor.trim() === "";
}

// ─── TEXTO ────────────────────────────────────────────────────────────────────

export function texto(valor: string | undefined, max = 255): Resultado<string> {
  const v = (valor ?? "").trim();
  if (v.length > max) return error(`supera los ${max} caracteres`);
  return ok(v);
}

// ─── NÚMEROS Y DINERO ─────────────────────────────────────────────────────────

/**
 * Normaliza un importe escrito por una persona a notación con punto decimal.
 *
 * EL PROBLEMA: el mismo archivo puede traer "12,500.00" (formato hondureño, que
 * es el que emite esta aplicación) o "12.500,00" (lo que produce Excel con
 * configuración regional de España). Interpretarlos al revés convierte doce mil
 * quinientos en doce con cinco, y al revés.
 *
 * LA REGLA, en este orden:
 *   1. Si aparecen los dos símbolos, manda el ÚLTIMO: es el separador decimal.
 *      "12.500,00" → coma decimal.  "12,500.00" → punto decimal.
 *   2. Con un solo símbolo repetido ("1.234.567") es agrupación, sin decimales.
 *   3. Con un solo símbolo una vez, decide cuántos dígitos lo siguen:
 *      exactamente 3 → agrupación ("12,500" son doce mil quinientos, que es la
 *      convención de Honduras); cualquier otra cantidad → decimal ("12,5").
 *
 * El caso 3 es el único genuinamente ambiguo y por eso queda documentado y
 * cubierto por tests: "1,500" se lee como 1500, no como 1.5.
 */
export function normalizarNumero(bruto: string): string {
  // Fuera moneda, espacios y separadores de millar no imprimibles.
  let v = bruto.trim().replace(/[Ll]\s*\.?|HNL|\$/gi, "").replace(/[\s\u00A0\u2007\u202F']/g, "");

  const negativo = /^\(.*\)$/.test(v); // (1,200.00) = -1200, notación contable
  if (negativo) v = v.slice(1, -1);

  const ultimaComa = v.lastIndexOf(",");
  const ultimoPunto = v.lastIndexOf(".");

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const decimal = ultimaComa > ultimoPunto ? "," : ".";
    const agrupacion = decimal === "," ? "." : ",";
    v = v.split(agrupacion).join("");
    v = v.replace(decimal, ".");
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const simbolo = ultimaComa >= 0 ? "," : ".";
    const partes = v.split(simbolo);
    if (partes.length > 2) {
      v = partes.join(""); // repetido → agrupación
    } else {
      const decimales = partes[1] ?? "";
      v = decimales.length === 3 ? partes.join("") : partes.join(".");
    }
  }

  return negativo ? `-${v}` : v;
}

/** Importe monetario exacto. Rechaza vacío, texto y valores no finitos. */
export function decimal(valor: string | undefined, opciones?: { min?: number; max?: number }): Resultado<Money> {
  if (vacia(valor)) return error("requerido");

  const normalizado = normalizarNumero(valor!);
  if (!/^-?\d*\.?\d+$/.test(normalizado)) return error(`"${valor}" no es un número válido`);

  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(normalizado);
  } catch {
    return error(`"${valor}" no es un número válido`);
  }
  if (!d.isFinite()) return error(`"${valor}" no es un número válido`);

  const { min, max } = opciones ?? {};
  if (min !== undefined && d.lessThan(min)) return error(`debe ser mayor o igual que ${min}`);
  if (max !== undefined && d.greaterThan(max)) return error(`debe ser menor o igual que ${max}`);

  // Se redondea a centavos aquí y no al escribir: la columna es Decimal(12,2) y
  // un tercer decimal se perdería en silencio dentro de la base.
  return ok(redondear(d));
}

/** Entero no negativo (cuotas, días). */
export function entero(valor: string | undefined, opciones?: { min?: number; max?: number }): Resultado<number> {
  if (vacia(valor)) return error("requerido");
  const normalizado = normalizarNumero(valor!);
  if (!/^-?\d+$/.test(normalizado)) return error(`"${valor}" no es un número entero`);

  const n = Number(normalizado);
  if (!Number.isSafeInteger(n)) return error(`"${valor}" está fuera de rango`);
  const { min = 0, max } = opciones ?? {};
  if (n < min) return error(`debe ser mayor o igual que ${min}`);
  if (max !== undefined && n > max) return error(`debe ser menor o igual que ${max}`);
  return ok(n);
}

// ─── FECHAS ───────────────────────────────────────────────────────────────────

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const RE_DMY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const RE_DMY_CORTO = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/;

/**
 * Fecha de CALENDARIO como medianoche UTC, que es como esta aplicación guarda
 * las columnas `@db.Date` (ver `fechaCalendario` en lib/utils).
 *
 * Formatos aceptados: `AAAA-MM-DD` (ISO) y `DD/MM/AAAA` con `/`, `-` o `.`.
 *
 * DÍA PRIMERO, SIEMPRE, en los formatos con separador: es la convención de
 * Honduras y la que produce el propio exportador. `03/04/2026` es el 3 de abril,
 * nunca el 4 de marzo. La alternativa —deducir el orden por si algún componente
 * supera 12— acierta en la mayoría de filas y falla justo en las de los primeros
 * doce días de cada mes, que es el peor error posible: silencioso y parcial.
 */
export function fecha(valor: string | undefined): Resultado<Date> {
  if (vacia(valor)) return error("requerido");
  const v = valor!.trim();

  let anio: number, mes: number, dia: number;

  const iso = RE_ISO.exec(v);
  const dmy = RE_DMY.exec(v);
  const corto = RE_DMY_CORTO.exec(v);

  if (iso) {
    [, anio, mes, dia] = [0, +iso[1], +iso[2], +iso[3]];
  } else if (dmy) {
    [, dia, mes, anio] = [0, +dmy[1], +dmy[2], +dmy[3]];
  } else if (corto) {
    // Excel abrevia el año a dos cifras. 00–69 → 2000s, 70–99 → 1900s: es la
    // ventana de POSIX, y con fechas de nacimiento de personal en activo acierta.
    const yy = +corto[3];
    [, dia, mes, anio] = [0, +corto[1], +corto[2], yy < 70 ? 2000 + yy : 1900 + yy];
  } else {
    return error(`"${valor}" no es una fecha válida (use DD/MM/AAAA o AAAA-MM-DD)`);
  }

  if (mes < 1 || mes > 12) return error(`"${valor}": el mes ${mes} no existe`);
  if (dia < 1 || dia > 31) return error(`"${valor}": el día ${dia} no existe`);

  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // Date normaliza en silencio: el 31 de febrero se convierte en 3 de marzo. Se
  // comprueba la vuelta para rechazar la fecha en vez de guardar otra distinta.
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return error(`"${valor}" no es una fecha real`);
  }
  return ok(d);
}

// ─── ENUMERADOS Y BOOLEANOS ───────────────────────────────────────────────────

/** Compara sin tildes, mayúsculas ni espacios. */
function llave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Valor de un enumerado de Prisma. Al fallar, enumera las opciones válidas:
 * es la diferencia entre "valor inválido" y poder corregirlo sin abrir el manual.
 */
export function enumerado<T extends string>(
  valor: string | undefined,
  permitidos: readonly T[]
): Resultado<T> {
  if (vacia(valor)) return error("requerido");
  const buscado = llave(valor!);
  const encontrado = permitidos.find((p) => llave(p) === buscado);
  if (!encontrado) return error(`"${valor}" no es válido. Opciones: ${permitidos.join(", ")}`);
  return ok(encontrado);
}

const VERDADEROS = new Set(["SI", "SI_", "S", "TRUE", "VERDADERO", "1", "X", "ACTIVO", "Y", "YES"]);
const FALSOS = new Set(["NO", "N", "FALSE", "FALSO", "0", "INACTIVO"]);

/** Booleano tolerante con lo que la gente escribe en una hoja de cálculo. */
export function booleano(valor: string | undefined, porDefecto?: boolean): Resultado<boolean> {
  if (vacia(valor)) {
    return porDefecto === undefined ? error("requerido") : ok(porDefecto);
  }
  const k = llave(valor!);
  if (VERDADEROS.has(k)) return ok(true);
  if (FALSOS.has(k)) return ok(false);
  return error(`"${valor}" no es Sí/No`);
}

// ─── VALIDACIONES DE FORMATO HONDUREÑAS ───────────────────────────────────────

/**
 * Número de identidad hondureño: 13 dígitos. Se acepta con o sin guiones y se
 * guarda sin ellos, para que el mismo documento no entre dos veces con dos
 * formatos distintos y burle el índice único.
 */
export function identidad(valor: string | undefined): Resultado<string> {
  if (vacia(valor)) return error("requerido");
  const soloDigitos = valor!.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(soloDigitos)) {
    return error(`"${valor}" no es una identidad válida (13 dígitos)`);
  }
  return ok(soloDigitos);
}

/** RTN hondureño: 14 dígitos. Mismo criterio de normalización que la identidad. */
export function rtn(valor: string | undefined): Resultado<string> {
  if (vacia(valor)) return error("requerido");
  const soloDigitos = valor!.replace(/[\s-]/g, "");
  if (!/^\d{14}$/.test(soloDigitos)) {
    return error(`"${valor}" no es un RTN válido (14 dígitos)`);
  }
  return ok(soloDigitos);
}

/** Correo electrónico. Comprobación deliberadamente laxa: sólo descarta lo evidente. */
export function correo(valor: string | undefined): Resultado<string> {
  if (vacia(valor)) return error("requerido");
  const v = valor!.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return error(`"${valor}" no es un correo válido`);
  return ok(v);
}
