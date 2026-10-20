import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── LOCALIZACIÓN HONDURAS ────────────────────────────────────────────────────

export const TZ_HN = "America/Tegucigalpa"; // UTC−6, sin horario de verano
export const MONEDA = "HNL";
export const LOCALE = "es-HN";

/**
 * DOS CLASES DE FECHA, DOS FORMATEADORES. No son intercambiables.
 *
 * 1. Fechas de CALENDARIO — columnas `@db.Date`: fechaInicio, fechaFin,
 *    fechaPago, fechaIngreso, fecha de marcaje. Representan un día del
 *    calendario, sin hora. Prisma las devuelve como medianoche UTC.
 *
 * 2. Marcas de TIEMPO — columnas `DateTime` con hora real: createdAt,
 *    emailEnviadoAt, cerradaAt. Representan un instante.
 *
 * POR QUÉ IMPORTA: `format(new Date(d), "dd/MM/yyyy")` formateaba TODO en la
 * hora local del servidor. Con el servidor en America/Tegucigalpa (UTC−6), una
 * fecha de calendario del 2026-08-31 llega como `2026-08-31T00:00:00.000Z` y se
 * imprimía «30/08/2026» — un día antes. El defecto sólo aparecía al fijar la
 * zona horaria correcta, así que estaba latente en boletas, planilla detallada,
 * partida contable y todos los reportes.
 *
 * Una fecha de calendario se formatea en UTC porque ahí es donde vive; un
 * instante se formatea en la hora de Honduras porque es lo que el usuario espera
 * leer.
 */
const fmtFecha = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const fmtFechaLarga = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const fmtFechaHora = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: TZ_HN,
});

/** Fecha de CALENDARIO (columnas `@db.Date`) → "31/08/2026". */
export function formatDate(date: Date | string): string {
  return fmtFecha.format(new Date(date));
}

/** Fecha de CALENDARIO en formato largo → "31 de agosto de 2026". */
export function formatDateLong(date: Date | string): string {
  return fmtFechaLarga.format(new Date(date));
}

/** Marca de TIEMPO real (createdAt, cerradaAt) en hora de Honduras. */
export function formatDateTime(date: Date | string): string {
  return fmtFechaHora.format(new Date(date));
}

/**
 * Hoy en Honduras, expresado como medianoche UTC.
 *
 * Es la forma correcta de comparar contra una columna `@db.Date`.
 * `new Date(new Date().toDateString())` construía medianoche LOCAL, que en
 * UTC−6 apunta a las 06:00 UTC del mismo día — o al día anterior, según la
 * comparación. De ahí que el conteo de marcajes «de hoy» saliera del día
 * equivocado.
 */
export function hoyHN(): Date {
  return diaHN(new Date());
}

/**
 * El día de calendario hondureño al que pertenece un INSTANTE, como medianoche
 * UTC — listo para comparar o guardar en una columna `@db.Date`.
 *
 * Lo necesita el reloj biométrico: una marca de las 23:40 en Honduras ocurre a
 * las 05:40 UTC del día SIGUIENTE, así que tomar la fecha en UTC la imputaría al
 * día equivocado y le movería las horas de un día al otro.
 */
export function diaHN(instante: Date): Date {
  // "en-CA" produce AAAA-MM-DD, que es justo el formato que necesitamos.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_HN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Convierte "2026-08-31" (input type=date) a la fecha de calendario en UTC. */
export function fechaCalendario(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

// ─── MONEDA ───────────────────────────────────────────────────────────────────

const fmtMoneda = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: MONEDA,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Lempiras, siempre con dos decimales.
 *
 * Acepta `Decimal` de Prisma, string o number para que quien formatea no tenga
 * que convertir antes. `maximumFractionDigits` va explícito: sin él el valor por
 * defecto es 3 y un importe con más decimales se imprimiría con tres.
 */
export function formatCurrency(amount: number | string | { toString(): string }): string {
  return fmtMoneda.format(Number(amount));
}

export function calcularAniosTrabajados(fechaIngreso: Date | string): number {
  const ingreso = new Date(fechaIngreso);
  const hoy = new Date();
  return Math.floor((hoy.getTime() - ingreso.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

export function nombreCompleto(emp: {
  primerNombre: string;
  segundoNombre?: string | null;
  primerApellido: string;
  segundoApellido?: string | null;
}): string {
  return [emp.primerNombre, emp.segundoNombre, emp.primerApellido, emp.segundoApellido]
    .filter(Boolean)
    .join(" ");
}

export function iniciales(nombre: string): string {
  return nombre
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
