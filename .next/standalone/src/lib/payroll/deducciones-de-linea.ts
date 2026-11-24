/**
 * Las deducciones de una línea de planilla POR TIPO («Cooperativa AUDI», «Préstamo RAP»),
 * para revisar la planilla contra la de la empresa, columna por columna. Puro.
 *
 * Al calcular, cada línea guarda lo que se le cobró de cada tipo en
 * `PlanillaDetalle.deducciones` (`resumirDeducciones`). Una línea de antes de esa columna
 * se arma con lo cobrado que quedó registrado (`AmortizacionPlanilla`, sólo en las
 * confirmadas) o, si tampoco hay, con las categorías de siempre.
 *
 * Lo de ley tiene su propia columna (IHSS, RAP, ISR, vecinal), igual que ausencias e
 * incapacidad: aquí van sólo las deducciones por empleado, AFP incluida.
 */

import { CERO, money, sumar, type Money, type MoneyInput } from "./money";

/** Lo que guarda la línea de cada tipo cobrado. */
export interface DeduccionDeLinea {
  codigo: string;
  nombre: string;
  /** En Lempiras, con dos decimales. */
  monto: string;
  /** Sólo si se cobró menos: lo que tocaba cobrar (no alcanzó el neto o el tope de ley). */
  asignado?: string;
  /** Sólo si se cobró más de lo que permiten los Arts. 371 y 372: hasta dónde llegaba el tope. */
  tope?: string;
}

/** Un cobro de un tipo; `asignado` y `tope` faltan cuando no hay nada que avisar (iguales al monto). */
export interface CobroPorTipo {
  codigo: string;
  nombre: string;
  monto: MoneyInput;
  asignado?: MoneyInput;
  tope?: MoneyInput;
}

/**
 * Junta lo cobrado por tipo (dos préstamos del mismo tipo, una sola columna). Deja fuera
 * lo que no tocaba cobrar, pero no lo que tocaba y no alcanzó: eso se avisa.
 */
export function resumirDeducciones(cobros: ReadonlyArray<CobroPorTipo>): DeduccionDeLinea[] {
  const porCodigo = new Map<string, { nombre: string; monto: Money; asignado: Money; tope: Money }>();
  for (const c of cobros) {
    const actual = porCodigo.get(c.codigo) ?? { nombre: c.nombre, monto: CERO, asignado: CERO, tope: CERO };
    porCodigo.set(c.codigo, {
      nombre: c.nombre,
      monto: actual.monto.plus(money(c.monto)),
      asignado: actual.asignado.plus(money(c.asignado ?? c.monto)),
      tope: actual.tope.plus(money(c.tope ?? c.monto)),
    });
  }
  return [...porCodigo.entries()]
    .filter(([, v]) => v.monto.greaterThan(0) || v.asignado.greaterThan(0))
    .map(([codigo, v]) => ({
      codigo,
      nombre: v.nombre,
      monto: v.monto.toFixed(2),
      ...(v.asignado.greaterThan(v.monto) ? { asignado: v.asignado.toFixed(2) } : {}),
      ...(v.monto.greaterThan(v.tope) ? { tope: v.tope.toFixed(2) } : {}),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

const esMonto = (v: unknown) => typeof v === "string" || typeof v === "number";

/** Lo guardado en la línea, o null si la línea es de antes de guardarlo (o lo guardado no se entiende). */
export function leerDeduccionesGuardadas(valor: unknown): DeduccionDeLinea[] | null {
  if (!Array.isArray(valor)) return null;
  const ok = valor.every((d) => d && typeof d.codigo === "string" && typeof d.nombre === "string" && esMonto(d.monto));
  return ok
    ? valor.map((d) => ({
      codigo: d.codigo,
      nombre: d.nombre,
      monto: money(d.monto).toFixed(2),
      ...(esMonto(d.asignado) ? { asignado: money(d.asignado).toFixed(2) } : {}),
      ...(esMonto(d.tope) ? { tope: money(d.tope).toFixed(2) } : {}),
    }))
    : null;
}

/** Lo que una línea no cobró completo y lo que cobró por encima del tope de ley. */
export interface AvisosDeLinea {
  /** Tocaba cobrar `asignado` y se cobró `monto`. */
  incompletas: { nombre: string; monto: Money; asignado: Money }[];
  /** Se cobró `monto` y el tope de los Arts. 371 y 372 llegaba a `tope`. */
  sobreTope: { nombre: string; monto: Money; tope: Money }[];
}

export function avisosDeDeducciones(valor: unknown): AvisosDeLinea {
  const guardadas = leerDeduccionesGuardadas(valor) ?? [];
  return {
    incompletas: guardadas.filter((d) => d.asignado !== undefined).map((d) => ({ nombre: d.nombre, monto: money(d.monto), asignado: money(d.asignado!) })),
    sobreTope: guardadas.filter((d) => d.tope !== undefined).map((d) => ({ nombre: d.nombre, monto: money(d.monto), tope: money(d.tope!) })),
  };
}

/** Lo que hace falta de la línea para armar sus deducciones por tipo. */
export interface LineaConDeducciones {
  deducciones?: unknown;
  cooperativa: MoneyInput;
  prestamos: MoneyInput;
  adelantos: MoneyInput;
  afpEmpleado: MoneyInput;
  otrosDeducciones: MoneyInput;
}

/** Los nombres de las categorías, para las líneas de antes que no guardaron sus tipos. */
export const CATEGORIAS_DE_ANTES = { cooperativa: "Cooperativa", prestamos: "Préstamos", adelantos: "Adelantos", afp: "AFP", otros: "Otras deducciones" } as const;

/**
 * Las deducciones por empleado de una línea, por nombre de tipo. `cobradas` son las
 * amortizaciones de la línea (sólo hay en las planillas confirmadas): sirven para las
 * líneas de antes de guardar el detalle.
 */
export function deduccionesPorNombre(l: LineaConDeducciones, cobradas?: ReadonlyArray<{ nombre: string; monto: MoneyInput }>): Map<string, Money> {
  const salida = new Map<string, Money>();
  const sumarA = (nombre: string, monto: MoneyInput) => {
    const m = money(monto);
    if (m.isZero()) return;
    salida.set(nombre, (salida.get(nombre) ?? CERO).plus(m));
  };
  const guardadas = leerDeduccionesGuardadas(l.deducciones);
  if (guardadas) {
    for (const d of guardadas) sumarA(d.nombre, d.monto);
    return salida;
  }
  const deCategorias = sumar(l.cooperativa, l.prestamos, l.adelantos, l.afpEmpleado, l.otrosDeducciones);
  // Lo cobrado registrado sirve si cuadra con lo que dice la línea; si no (una cuota se
  // devolvió al anular, por ejemplo), las categorías.
  if (cobradas?.length && sumar(...cobradas.map((c) => c.monto)).equals(deCategorias)) {
    for (const c of cobradas) sumarA(c.nombre, c.monto);
    return salida;
  }
  sumarA(CATEGORIAS_DE_ANTES.cooperativa, l.cooperativa);
  sumarA(CATEGORIAS_DE_ANTES.prestamos, l.prestamos);
  sumarA(CATEGORIAS_DE_ANTES.adelantos, l.adelantos);
  sumarA(CATEGORIAS_DE_ANTES.afp, l.afpEmpleado);
  sumarA(CATEGORIAS_DE_ANTES.otros, l.otrosDeducciones);
  return salida;
}

/**
 * Las columnas de deducciones de un conjunto de líneas: cada tipo que cobró algo a alguien.
 * `orden` son los nombres en el orden que eligió la empresa (`nombresEnOrden`, el mismo en
 * pantalla y al imprimir); los que no están en él van después, por nombre, y las categorías
 * de las líneas de antes, al final.
 */
export function columnasDeDeducciones(mapas: Iterable<ReadonlyMap<string, Money>>, orden: readonly string[] = []): string[] {
  const nombres = new Set<string>();
  for (const m of mapas) for (const [nombre, monto] of m) if (!monto.isZero()) nombres.add(nombre);
  const deAntes = new Set<string>(Object.values(CATEGORIAS_DE_ANTES));
  const pos = new Map(orden.map((n, i) => [n, i]));
  const lugar = (n: string) => pos.get(n) ?? Number.MAX_SAFE_INTEGER;
  return [...nombres].sort((a, b) => Number(deAntes.has(a)) - Number(deAntes.has(b)) || lugar(a) - lugar(b) || a.localeCompare(b, "es"));
}
