/**
 * Deducciones por empleado y período: el archivo de una fila por empleado y una
 * columna por tipo de deducción, como la planilla quincenal que lleva el cliente.
 *
 * CADA CELDA ES LO QUE SE DESCUENTA DE ESE TIPO EN EL PERÍODO. Se exporta con lo que
 * hay hoy, se corrige en Excel y se vuelve a importar. Importar no toca ninguna
 * deducción existente: crea, cambia o quita un «monto del período»
 * (`esMontoDelPeriodo`), que en ese período reemplaza a la deducción de cada planilla
 * del mismo tipo (`conMontosDelPeriodo`). Así queda registrado qué se pidió en cada
 * quincena, y reimportar el archivo corrige en lugar de duplicar.
 *
 * Las cuotas de préstamos y los descuentos a plazo de ese tipo también salen en la
 * celda, pero siguen su curso: por eso el monto no puede ser menor que ellos.
 */

import type { Prisma, PrismaClient, TipoPlanilla } from "@prisma/client";
import { CERO, money, sumar, type Money } from "@/lib/payroll/money";
import {
  CODIGO_ISR_FIJO,
  MARCA_MONTO_PERIODO,
  cuotaDelPeriodo,
  esCadaPlanilla,
  esMontoDelPeriodo,
} from "@/lib/payroll/deducciones";
import { ESTADOS_QUE_COBRAN } from "@/lib/payroll/elegibles";
import { frasePeriodo, rangoPeriodo, type PeriodoPlanilla } from "@/lib/payroll/periodos-planilla";
import { calcularRAP, calcularReservaLaboral, type ParametrosLegales } from "@/lib/payroll/calculos-hn";
import { mesAnterior, mesDe, nombreMes, partesMes, rangoMes, reglaDelMes } from "@/lib/payroll/rap-mes-vencido";
import { cargarBasesImportadas, cargarDevengadoDelMes, leerBaseRap } from "@/lib/payroll/rap-mes-vencido-bd";
import { formatCurrency, nombreCompleto } from "@/lib/utils";
import { esColumnaIsr, nombreComparable, noEsDeduccionPorEmpleado, partirCabecera, sugerirCategoria, sugerirCodigo } from "@/lib/deducciones/tipos";
import { isrEsManual } from "@/lib/payroll/isr-personalizado-bd";
import { mapearColumnas, normalizarCabecera, parsearCsv, type ColumnaEsperada, type CsvParseado } from "./csv";
import * as v from "./valores";
import type { ColumnaCsv, ColumnaLeida, FilaPrevisualizada, Incidencia, TipoSugerido } from "./tipos";

/** Tope por celda: ataja el tecleo que multiplica por mil. */
const MONTO_MAXIMO = 5_000_000;

/** Marca de las filas de un lote de montos del período: comparten el tipo DEDUCCIONES con la importación por filas. */
export const CLASE_MONTO_PERIODO = "MONTO_PERIODO";

const dia = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const fecha = (s: string) => new Date(`${s}T00:00:00.000Z`);
const lempiras = (m: Money) => formatCurrency(m.toFixed(2));

// ─── COLUMNAS ────────────────────────────────────────────────────────────────

export interface TipoColumna {
  id: string;
  codigo: string;
  nombre: string;
  /** Cabecera con que se exporta, si no es «Nombre (CÓDIGO)». */
  etiqueta?: string;
  /** Otros nombres con que llega en las planillas hechas a mano. */
  alias?: string[];
  /** Categoría (`TipoDeduccion`): ordena las columnas del formato de captura. */
  categoria?: string;
}

/**
 * La columna del ISR. Sólo existe con el ISR en MANUAL (Parámetros de ley): entonces lo
 * que se retiene en el período se importa aquí y se guarda como monto del período de la
 * retención fija, que la planilla usa en vez de calcular. En automático se ignora.
 */
export const ETIQUETA_ISR = `ISR del período (${CODIGO_ISR_FIJO})`;
const ALIAS_ISR = [
  "ISR", "ISR del período", "Retención ISR", "Retención de ISR", "Ret. ISR", "Retención en la fuente",
  "Ret. en la fuente", "Retención en la fuente ISR", "Impuesto sobre la renta",
];
const MOTIVO_ISR_AUTOMATICO =
  "El ISR está en automático (Parámetros de ley): lo calcula el sistema, o lo fija la ficha del empleado. Para tomar esta columna, póngalo en manual.";

const esIsr = (t: Pick<TipoColumna, "codigo">) => t.codigo === CODIGO_ISR_FIJO;
/** Cómo se nombra el tipo en los mensajes. */
const nombreTipo = (t: TipoColumna) => (esIsr(t) ? "ISR del período" : t.nombre);

/**
 * Tipos que pueden llevar monto del período: activos y no legales. La retención fija de
 * ISR, que es impuesto, sólo con el ISR en manual, y primero: no es un descuento más.
 */
export async function cargarTiposMatriz(db: PrismaClient | Prisma.TransactionClient, isrManual?: boolean): Promise<TipoColumna[]> {
  const manual = isrManual ?? (await isrEsManual(db));
  const tipos = (await db.tipoDeduccionConfig.findMany({
    where: { activo: true, esLegal: false, ...(manual ? {} : { codigo: { not: CODIGO_ISR_FIJO } }) },
    select: { id: true, codigo: true, nombre: true, tipo: true },
    orderBy: { nombre: "asc" },
  })).map(({ tipo, ...t }): TipoColumna => ({ ...t, categoria: tipo }));
  return [
    ...tipos.filter(esIsr).map((t) => ({ ...t, etiqueta: ETIQUETA_ISR, alias: ALIAS_ISR })),
    ...tipos.filter((t) => !esIsr(t)),
  ];
}

/** Cómo llaman al código del empleado las planillas hechas a mano. */
const ALIAS_CODIGO = [
  "codigo", "código", "Código Empl.", "Cod. Empl.", "Cód. Empl.", "Código Emp.", "Cod. Emp.", "Código Empleado",
  "Código del empleado", "Código de empleado", "Cod. Empleado", "Cod", "Cód.", "No. Empleado", "Núm. Empleado",
  "Número de empleado", "Empleado No.",
];
const ALIAS_NOMBRE = ["nombre", "Nombre del Empleado", "Nombre Empleado", "Nombre completo", "Nombre y apellidos", "Nombres"];

export const COLUMNA_CODIGO: ColumnaCsv = {
  clave: "empleado_codigo",
  etiqueta: "Codigo Empleado",
  descripcion: "Código del empleado. Es lo único que se lee para saber de quién es la fila.",
  requerido: true,
  ejemplo: "010001",
};
const COLUMNA_NOMBRE: ColumnaCsv = { clave: "empleado_nombre", etiqueta: "Empleado", descripcion: "Para reconocerlo. Se ignora al importar.", soloLectura: true };
const COLUMNA_DEPARTAMENTO: ColumnaCsv = { clave: "departamento", etiqueta: "Departamento", descripcion: "Para ordenar o filtrar en Excel. Se ignora al importar.", soloLectura: true };

export const claveTipo = (id: string) => `tipo:${id}`;
export const etiquetaTipo = (t: TipoColumna) => t.etiqueta ?? `${t.nombre} (${t.codigo})`;

export function columnasMatriz(tipos: readonly TipoColumna[]): ColumnaCsv[] {
  return [
    COLUMNA_CODIGO,
    COLUMNA_NOMBRE,
    COLUMNA_DEPARTAMENTO,
    ...tipos.map((t): ColumnaCsv => ({
      clave: claveTipo(t.id),
      etiqueta: etiquetaTipo(t),
      descripcion: esIsr(t)
        ? "La retención de ISR del período, en Lempiras (el ISR está en manual). Vacía: no cambia; 0: no se retiene."
        : `Lo que se descuenta de «${t.nombre}» en el período, en Lempiras. Vacío o 0: nada.`,
      formato: "monto",
      ejemplo: "500.00",
    })),
  ];
}

/** Las cabeceras de tipo se reconocen por «Nombre (CÓDIGO)», por el código solo o por el nombre solo. */
function esperadasTipos(tipos: readonly TipoColumna[]): ColumnaEsperada[] {
  return tipos.map((t) => ({ clave: claveTipo(t.id), etiqueta: etiquetaTipo(t), alias: [t.codigo, t.nombre, ...(t.alias ?? [])] }));
}

// ─── ESTADO DE CADA CELDA ────────────────────────────────────────────────────

/** Lo que hay hoy de un tipo para un empleado en el período. */
export interface EstadoCelda {
  /** El monto del período de ESTAS fechas, si ya se importó. */
  novedad: { id: string; monto: Money } | null;
  /** Deducciones de cada planilla del tipo. Un monto del período las reemplaza. */
  cadaPlanilla: Money;
  /** Lo que el archivo no cambia: cuotas de préstamos y descuentos a plazo, o el monto de otro período que también cae en este. */
  otros: Money;
}

const VACIO: EstadoCelda = { novedad: null, cadaPlanilla: CERO, otros: CERO };

/** Lo que dirá la celda: lo que se descuenta del tipo en el período. */
export function totalDeCelda(e: EstadoCelda): Money {
  return (e.novedad ? e.novedad.monto : e.cadaPlanilla).plus(e.otros);
}

export interface DeduccionParaEstado {
  id: string;
  empleadoId: string;
  tipoDeduccionId: string;
  monto: Prisma.Decimal | Money | string | number;
  saldo: Prisma.Decimal | Money | string | number | null;
  cuotasMeses: number | null;
  cuotasPagadas: number;
  fechaInicio: Date;
  fechaFin: Date | null;
  observacion: string | null;
}

/** Agrupa las deducciones vigentes en el período por empleado y tipo. Lógica pura: la consulta va aparte. */
export function estadosDelPeriodo(deducciones: readonly DeduccionParaEstado[], periodo: Pick<PeriodoPlanilla, "desde" | "hasta">): Map<string, EstadoCelda> {
  const estados = new Map<string, EstadoCelda & { reemplazadaPorOtro: boolean }>();
  for (const d of deducciones) {
    const clave = `${d.empleadoId}|${d.tipoDeduccionId}`;
    const e = estados.get(clave) ?? { ...VACIO, reemplazadaPorOtro: false };
    if (esMontoDelPeriodo(d)) {
      if (dia(d.fechaInicio) === periodo.desde && d.fechaFin && dia(d.fechaFin) === periodo.hasta && !e.novedad) {
        e.novedad = { id: d.id, monto: money(d.monto) };
      } else {
        // El de otro período que también cae aquí (uno mensual en una quincena): lo
        // cobra la planilla y reemplaza igual a la de cada planilla.
        e.otros = e.otros.plus(money(d.monto));
        e.reemplazadaPorOtro = true;
      }
    } else if (esCadaPlanilla(d)) {
      e.cadaPlanilla = e.cadaPlanilla.plus(money(d.monto));
    } else {
      e.otros = e.otros.plus(cuotaDelPeriodo(d));
    }
    estados.set(clave, e);
  }
  const salida = new Map<string, EstadoCelda>();
  for (const [clave, { reemplazadaPorOtro, ...e }] of estados) {
    salida.set(clave, reemplazadaPorOtro && !e.novedad ? { ...e, cadaPlanilla: CERO } : e);
  }
  return salida;
}

/** Deducciones activas que tocan el período, de los tipos dados. */
export function cargarDeduccionesDelPeriodo(
  db: PrismaClient | Prisma.TransactionClient,
  empleadoIds: readonly string[],
  tipoIds: readonly string[],
  periodo: Pick<PeriodoPlanilla, "desde" | "hasta">
): Promise<DeduccionParaEstado[]> {
  return db.deduccionEmpleado.findMany({
    where: {
      empleadoId: { in: [...empleadoIds] },
      tipoDeduccionId: { in: [...tipoIds] },
      activo: true,
      fechaInicio: { lte: fecha(periodo.hasta) },
      OR: [{ fechaFin: null }, { fechaFin: { gte: fecha(periodo.desde) } }],
    },
    select: {
      id: true, empleadoId: true, tipoDeduccionId: true, monto: true, saldo: true,
      cuotasMeses: true, cuotasPagadas: true, fechaInicio: true, fechaFin: true, observacion: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

// ─── DECISIÓN POR CELDA ──────────────────────────────────────────────────────

export type Decision =
  | { accion: "IGUAL" }
  | { accion: "ERROR"; mensaje: string }
  | { accion: "PONER" | "QUITAR"; monto: Money; antes: Money; despues: Money };

/**
 * Qué hacer con el valor nuevo de una celda.
 *
 * PONER deja un monto del período igual a lo nuevo menos lo que el archivo no cambia
 * (puede ser cero: así se deja de cobrar este período una deducción de cada planilla).
 * QUITAR borra el monto del período cuando lo nuevo vuelve a ser lo de siempre.
 */
export function decidirCelda(estado: EstadoCelda | undefined, nuevo: Money): Decision {
  const e = estado ?? VACIO;
  const antes = totalDeCelda(e);
  if (nuevo.equals(antes)) return { accion: "IGUAL" };
  const objetivo = nuevo.minus(e.otros);
  if (objetivo.isNegative()) {
    return {
      accion: "ERROR",
      mensaje: `Este tipo ya lleva ${lempiras(e.otros)} en cuotas de préstamo o descuentos a plazo, que siguen su curso: el monto del período no puede ser menor. Para no cobrar una cuota, cámbiela en la deducción.`,
    };
  }
  if (e.novedad && objetivo.equals(e.cadaPlanilla)) return { accion: "QUITAR", monto: CERO, antes, despues: nuevo };
  return { accion: "PONER", monto: objetivo, antes, despues: nuevo };
}

// ─── BASE DEL RAP A MES VENCIDO ──────────────────────────────────────────────
//
// Con el RAP a mes vencido (Parámetros de ley, `rap-mes-vencido.ts`), la plantilla
// lleva además una columna con la base del mes: lo devengado el mes anterior. NO es
// una deducción: se guarda en `BaseRapMes` y vale para todas las planillas del mes,
// sea cual sea la quincena que se exporte.

/** Marca de las filas del lote que son bases del RAP. */
export const CLASE_BASE_RAP = "BASE_RAP";
export const CLAVE_BASE_RAP_COLUMNA = "base_rap";
export const ETIQUETA_BASE_RAP = "Base RAP (mes anterior)";
const ALIAS_BASE_RAP = ["Base RAP", "Base del RAP", "Base RAP mes anterior", "base_rap"];

export function columnaBaseRap(mes: string): ColumnaCsv {
  const anterior = nombreMes(mesAnterior(mes));
  return {
    clave: CLAVE_BASE_RAP_COLUMNA,
    etiqueta: ETIQUETA_BASE_RAP,
    descripcion: `Lo devengado en ${anterior} (salario ordinario y comisiones): sobre esto se calculan el RAP y la Reserva Laboral que se descuentan en ${nombreMes(mes)}. Vacío: la que el sistema saca de las planillas de ${anterior}.`,
    formato: "monto",
    ejemplo: "45000.00",
  };
}

/** Lo que hace falta para la columna de la base, si la opción rige en el mes del período. */
export interface ContextoBaseRap {
  mes: string;
  regla: "TRANSICION" | "ANTERIOR";
  importadas: Map<string, Money>;
  /** De las planillas confirmadas del mes anterior; vacío en el mes de transición. */
  automaticas: Map<string, Money>;
  /** La planilla más avanzada del MES por empleado: la base vale para todo el mes. */
  planillasMes: Map<string, PlanillaDelPeriodo>;
  parametros: ParametrosLegales;
}

/** Lo que dirá la celda al exportar: la importada, o la del sistema si hay. */
export function valorBaseRap(ctx: ContextoBaseRap, empleadoId: string): Money | null {
  const importada = ctx.importadas.get(empleadoId);
  if (importada) return importada;
  const auto = ctx.automaticas.get(empleadoId);
  return auto && !auto.isZero() ? auto : null;
}

export type DecisionBaseRap =
  | { accion: "IGUAL" }
  | { accion: "PONER" | "QUITAR"; antes: Money; despues: Money };

/**
 * Qué hacer con la celda de la base. Vacía = la del sistema: quita la importada si la
 * había. Igual a la del sistema sin haber importada: nada que guardar.
 */
export function decidirBaseRap(importada: Money | null, automatica: Money, nuevo: Money | null): DecisionBaseRap {
  if (nuevo === null) return importada === null ? { accion: "IGUAL" } : { accion: "QUITAR", antes: importada, despues: automatica };
  if (importada !== null) return nuevo.equals(importada) ? { accion: "IGUAL" } : { accion: "PONER", antes: importada, despues: nuevo };
  return nuevo.equals(automatica) ? { accion: "IGUAL" } : { accion: "PONER", antes: automatica, despues: nuevo };
}

/** El RAP y la Reserva que salen de una base, para la vista previa. */
export function aportesDeBase(base: Money, p: ParametrosLegales): string {
  const rap = calcularRAP(base, p);
  const reserva = calcularReservaLaboral(base, p).empleador;
  return `RAP ${lempiras(rap.empleado)} del trabajador y ${lempiras(rap.empleador)} del patrono, Reserva ${lempiras(reserva)}`;
}

/** Contexto de la columna, o `null` si en el mes del período el RAP no va a mes vencido. */
export async function cargarContextoBaseRap(
  db: PrismaClient,
  empleadoIds: readonly string[],
  periodo: Pick<PeriodoPlanilla, "desde">
): Promise<ContextoBaseRap | null> {
  const mes = mesDe(fecha(periodo.desde));
  const regla = reglaDelMes(await leerBaseRap(db), mes);
  if (regla === "EN_CURSO") return null;
  const r = rangoMes(mes);
  // Import diferido: el cargador de parámetros abre la conexión de la app.
  const { cargarParametrosLegales } = await import("@/lib/payroll/parametros-bd");
  const [importadas, devengado, planillasMes, parametros] = await Promise.all([
    cargarBasesImportadas(db, empleadoIds, mes),
    regla === "ANTERIOR" ? cargarDevengadoDelMes(db, empleadoIds, mesAnterior(mes)) : Promise.resolve({ porEmpleado: new Map<string, Money>(), borradores: 0 }),
    cargarPlanillasDelPeriodo(db, empleadoIds, { desde: dia(r.desde), hasta: dia(r.hasta) }),
    cargarParametrosLegales(),
  ]);
  return { mes, regla, importadas, automaticas: devengado.porEmpleado, planillasMes, parametros };
}

// ─── VALIDACIÓN DEL ARCHIVO ──────────────────────────────────────────────────

export interface EmpleadoMatriz {
  id: string;
  codigo: string;
  nombre: string;
  sucursalId: string;
  departamentoId: string;
  tipoPlanilla: TipoPlanilla;
  cobra: boolean;
}

/** Planilla del período en que ya está el empleado. */
export interface PlanillaDelPeriodo {
  estado: "BORRADOR" | "CALCULADA" | "APROBADA" | "PAGADA";
}

export interface ContextoMontos {
  periodo: PeriodoPlanilla;
  tipos: TipoColumna[];
  /** Cabecera normalizada → id del tipo: columnas que alguien ya asignó a mano (`leerEquivalencias`). */
  equivalencias?: Map<string, string>;
  /** Cabecera normalizada → por qué ese tipo no se importa aquí (legal, desactivado, ISR fijo). */
  noImportables: Map<string, string>;
  /** Código de empleado en minúsculas → empleado. */
  empleados: Map<string, EmpleadoMatriz>;
  /** `${empleadoId}|${tipoId}` → estado de hoy. */
  estados: Map<string, EstadoCelda>;
  planillas: Map<string, PlanillaDelPeriodo>;
  /** Columna de la base del RAP: sólo con el RAP a mes vencido en el mes del período. */
  baseRap?: ContextoBaseRap | null;
}

/** Una base del RAP que cambia: lo que se escribe al confirmar. */
export interface OperacionBaseRap {
  clase: typeof CLASE_BASE_RAP;
  linea: number;
  accion: "PONER" | "QUITAR";
  empleadoId: string;
  /** Mes en que se descuenta, «AAAA-MM». */
  mes: string;
  base: string;
  antes: string;
  despues: string;
  referencia: string;
}

/** Una celda que cambia: lo que se escribe al confirmar. */
export interface OperacionMonto {
  clase: typeof CLASE_MONTO_PERIODO;
  linea: number;
  accion: "PONER" | "QUITAR";
  empleadoId: string;
  tipoDeduccionId: string;
  monto: string;
  antes: string;
  despues: string;
  referencia: string;
}

export interface ResultadoMontos {
  operaciones: Array<OperacionMonto | OperacionBaseRap>;
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  columnasDesconocidas: string[];
  /** A qué tipo se asignó cada columna. */
  columnasLeidas: ColumnaLeida[];
  /** Dónde estaban los encabezados y las filas leídas: lo usa `sugerirTiposNuevos`. */
  hoja: HojaMontos | null;
  /** Filas sin código con montos que parecen totales o subtotales: se ignoran. */
  filasTotales: number;
  totalFilas: number;
  nuevos: number;
  cambian: number;
  seQuitan: number;
  sinCambio: number;
  /** Filas sin ningún monto: no se tocan (el archivo trae a todos los empleados). */
  sinMontos: number;
}

export type ComprobadorAlcance = (e: { id: string; sucursalId: string; departamentoId: string }) => boolean;

const ESTADO_PLANILLA: Record<PlanillaDelPeriodo["estado"], string> = {
  BORRADOR: "en borrador",
  CALCULADA: "calculada",
  APROBADA: "aprobada",
  PAGADA: "pagada",
};

// ─── ENCABEZADOS ─────────────────────────────────────────────────────────────

/** Lo leído del archivo: encabezados y filas de datos, ya sin el título de la hoja. */
export interface HojaMontos {
  cabeceras: string[];
  filas: Array<{ linea: number; celdas: string[] }>;
  /** Línea del archivo donde empiezan los encabezados. */
  lineaCabecera: number;
  /** Los encabezados vienen partidos en dos filas («Ptamo.» arriba, «BANCATLAN» abajo). */
  dosFilas: boolean;
}

/** Columnas del archivo ya asignadas. */
interface Mapeo {
  indices: Record<string, number>;
  desconocidas: string[];
  ignoradas: Array<{ cabecera: string; motivo: string }>;
  leidas: ColumnaLeida[];
}

const FILAS_DE_TITULO = 15;

/**
 * Asigna cada encabezado a una columna fija o a un tipo, en este orden: por su nombre,
 * código o alias exactos; «Otro nombre (CÓDIGO)»; una asignación recordada; lo que no
 * se importa aquí (de ley, desactivado, el ISR en automático); el ISR por cualquiera de
 * sus nombres; y por último el nombre con las abreviaturas escritas completas, sólo si
 * corresponde a un único tipo.
 */
function mapearMontos(cabeceras: readonly string[], ctx: ContextoMontos, esperadas: readonly ColumnaEsperada[]): Mapeo {
  const { indices, desconocidas: sinMapear } = mapearColumnas(cabeceras, esperadas);
  const leidas: ColumnaLeida[] = [];
  for (const t of ctx.tipos) {
    const i = indices[claveTipo(t.id)];
    if (i !== undefined) leidas.push({ cabecera: cabeceras[i], tipo: etiquetaTipo(t), codigo: t.codigo, por: "NOMBRE" });
  }
  const libre = (t: TipoColumna) => indices[claveTipo(t.id)] === undefined;
  const isr = ctx.tipos.find(esIsr);
  const desconocidas: string[] = [];
  const ignoradas: Mapeo["ignoradas"] = [];

  for (const cabecera of sinMapear) {
    const i = cabeceras.indexOf(cabecera);
    const asignar = (t: TipoColumna, por: ColumnaLeida["por"]) => {
      indices[claveTipo(t.id)] = i;
      leidas.push({ cabecera, tipo: etiquetaTipo(t), codigo: t.codigo, por });
    };
    const { codigo, nombre } = partirCabecera(cabecera);
    const porCodigo = codigo ? ctx.tipos.find((t) => t.codigo === codigo) : undefined;
    if (porCodigo && libre(porCodigo)) { asignar(porCodigo, "NOMBRE"); continue; }

    const idRecordado = ctx.equivalencias?.get(normalizarCabecera(cabecera));
    const recordado = idRecordado ? ctx.tipos.find((t) => t.id === idRecordado) : undefined;
    if (recordado && libre(recordado)) { asignar(recordado, "RECORDADA"); continue; }

    const motivo = ctx.noImportables.get(normalizarCabecera(cabecera)) ?? (codigo ? ctx.noImportables.get(normalizarCabecera(codigo)) : undefined);
    if (motivo) { ignoradas.push({ cabecera, motivo }); continue; }

    if (esColumnaIsr(cabecera)) {
      if (isr && libre(isr)) asignar(isr, "PARECIDO");
      else ignoradas.push({ cabecera, motivo: isr ? "Ya hay otra columna del ISR en el archivo." : MOTIVO_ISR_AUTOMATICO });
      continue;
    }

    const forma = nombreComparable(nombre);
    const parecidos = forma ? ctx.tipos.filter((t) => !esIsr(t) && (nombreComparable(t.nombre) === forma || nombreComparable(t.codigo) === forma)) : [];
    if (parecidos.length === 1 && libre(parecidos[0])) { asignar(parecidos[0], "PARECIDO"); continue; }
    desconocidas.push(cabecera);
  }
  return { indices, desconocidas, ignoradas, leidas };
}

/** Encabezado de dos filas: la combinación que se reconozca («Ptamo.» + «RAP»), o la de abajo, o la de arriba. */
function unirDosFilas(arriba: readonly string[], abajo: readonly string[], reconoce: (c: string) => boolean): string[] {
  return Array.from({ length: Math.max(arriba.length, abajo.length) }, (_, i) => {
    const a = (arriba[i] ?? "").trim();
    const b = (abajo[i] ?? "").trim();
    const opciones = [...new Set([`${a} ${b}`.trim(), b, a].filter(Boolean))];
    return opciones.find(reconoce) ?? opciones[0] ?? "";
  });
}

/**
 * Dónde están los encabezados. La planilla hecha a mano trae arriba el nombre de la
 * empresa y el período, y a veces cada encabezado partido en dos filas («Código» /
 * «Empl.»). Se prueban las primeras filas, solas o junto con la siguiente, y se queda
 * la que más columnas reconoce, siempre que traiga el código del empleado; a igualdad,
 * la primera y de una sola fila. Si ninguna lo trae, la primera fila, como siempre.
 */
export function ubicarCabecera(csv: Pick<CsvParseado, "cabeceras" | "filas" | "lineaCabecera">, ctx: ContextoMontos, esperadas: readonly ColumnaEsperada[]): HojaMontos {
  const registros = [{ linea: csv.lineaCabecera ?? 1, celdas: csv.cabeceras }, ...csv.filas];
  const reconoce = (c: string) => {
    const m = mapearMontos([c], ctx, esperadas);
    return Object.keys(m.indices).length > 0 || m.ignoradas.length > 0;
  };
  let mejor: { puntos: number; hoja: HojaMontos } | null = null;
  const limite = Math.min(FILAS_DE_TITULO, registros.length);
  for (let r = 0; r < limite; r++) {
    const candidatas: Array<[string[], boolean]> = [[registros[r].celdas, false]];
    if (r + 1 < registros.length) candidatas.push([unirDosFilas(registros[r].celdas, registros[r + 1].celdas, reconoce), true]);
    for (const [cabeceras, dosFilas] of candidatas) {
      const m = mapearMontos(cabeceras, ctx, esperadas);
      if (m.indices[COLUMNA_CODIGO.clave] === undefined) continue;
      const puntos = Object.keys(m.indices).length + m.ignoradas.length;
      if (!mejor || puntos > mejor.puntos) {
        mejor = { puntos, hoja: { cabeceras, filas: registros.slice(r + (dosFilas ? 2 : 1)), lineaCabecera: registros[r].linea, dosFilas } };
      }
    }
  }
  return mejor?.hoja ?? { cabeceras: csv.cabeceras, filas: csv.filas, lineaCabecera: csv.lineaCabecera ?? 1, dosFilas: false };
}

/** El guion de la planilla contable («-», «–») es un cero. */
const celdaMonto = (valor: string | undefined) => (valor !== undefined && /^\s*[-–—]+\s*$/.test(valor) ? "0" : valor);
/** Filas de totales o subtotales: no son de ningún empleado. */
const esFilaDeTotal = (celdas: readonly string[]) => celdas.some((c) => /total/i.test(c));

export function validarMontos(texto: string, ctx: ContextoMontos, alcanza: ComprobadorAlcance): ResultadoMontos {
  const r: ResultadoMontos = {
    operaciones: [], incidencias: [], previsualizacion: [], columnasDesconocidas: [], columnasLeidas: [], hoja: null, filasTotales: 0,
    totalFilas: 0, nuevos: 0, cambian: 0, seQuitan: 0, sinCambio: 0, sinMontos: 0,
  };
  const csv = parsearCsv(texto);
  if (csv.cabeceras.length === 0) {
    r.incidencias.push({ linea: 1, severidad: "ERROR", mensaje: "El archivo está vacío." });
    return r;
  }

  const fijas: ColumnaEsperada[] = [
    { clave: COLUMNA_CODIGO.clave, etiqueta: COLUMNA_CODIGO.etiqueta, alias: ALIAS_CODIGO },
    { clave: COLUMNA_NOMBRE.clave, etiqueta: COLUMNA_NOMBRE.etiqueta, alias: ALIAS_NOMBRE },
    { clave: COLUMNA_DEPARTAMENTO.clave, etiqueta: COLUMNA_DEPARTAMENTO.etiqueta, alias: ["Depto.", "Depto"] },
    // Se reconoce siempre, para avisar si el RAP no va a mes vencido en vez de tomarla por un tipo nuevo.
    { clave: CLAVE_BASE_RAP_COLUMNA, etiqueta: ETIQUETA_BASE_RAP, alias: ALIAS_BASE_RAP },
  ];
  const esperadas = [...fijas, ...esperadasTipos(ctx.tipos)];
  const hoja = ubicarCabecera(csv, ctx, esperadas);
  r.hoja = hoja;
  const L = hoja.lineaCabecera;
  const { indices, desconocidas, ignoradas, leidas } = mapearMontos(hoja.cabeceras, ctx, esperadas);
  r.columnasLeidas = leidas;
  r.columnasDesconocidas = desconocidas;
  for (const { cabecera, motivo } of ignoradas) r.incidencias.push({ linea: L, columna: cabecera, severidad: "AVISO", mensaje: `${motivo} Se ignora.` });

  if (indices[COLUMNA_CODIGO.clave] === undefined) {
    r.incidencias.push({ linea: L, severidad: "ERROR", mensaje: "Falta la columna «Codigo Empleado». Descargue el archivo del período para ver el formato." });
    return r;
  }
  const br = ctx.baseRap ?? null;
  const conBase = indices[CLAVE_BASE_RAP_COLUMNA] !== undefined;
  if (conBase && !br) {
    r.incidencias.push({
      linea: L, columna: ETIQUETA_BASE_RAP, severidad: "AVISO",
      mensaje: "La base del RAP sólo se usa con el RAP a mes vencido (Parámetros de ley), y en este mes no rige. Se ignora.",
    });
  }
  const columnasTipo = ctx.tipos.filter((t) => indices[claveTipo(t.id)] !== undefined);
  if (columnasTipo.length === 0 && !(conBase && br)) {
    r.incidencias.push({
      linea: L, severidad: "ERROR",
      mensaje: r.columnasDesconocidas.length
        ? "Ninguna columna es todavía un tipo de deducción: créelos abajo o en Tipos de deducción, y vuelva a revisar."
        : "El archivo no trae ninguna columna de deducción. Las columnas se llaman como el tipo, por ejemplo «Cooperativa (COOP1)».",
    });
    return r;
  }

  const vistas = new Map<string, number>();
  let totalesSinRotulo = 0;
  const avisadas = new Set<string>();
  for (const { linea, celdas } of hoja.filas) {
    r.totalFilas++;
    const codigo = (celdas[indices[COLUMNA_CODIGO.clave]] ?? "").trim();
    const error = (mensaje: string, columna?: string) => r.incidencias.push({ linea, columna, severidad: "ERROR", mensaje });
    // El archivo trae a todos los empleados: sólo se importan las filas con algún monto.
    // Una fila vacía no se toca, aunque sea de alguien inactivo o de otro código.
    const conDatos = columnasTipo.some((t) => !v.vacia(celdas[indices[claveTipo(t.id)]]))
      || (conBase && br !== null && !v.vacia(celdas[indices[CLAVE_BASE_RAP_COLUMNA]]));
    if (!conDatos) {
      if (codigo) r.sinMontos++;
      continue;
    }
    if (!codigo || /total/i.test(codigo)) {
      // Totales y subtotales de la planilla: con «Total» en alguna celda, o sin código ni nombre de nadie.
      const iNombre = indices[COLUMNA_NOMBRE.clave];
      const sinNombre = iNombre !== undefined && !(celdas[iNombre] ?? "").trim();
      if (esFilaDeTotal(celdas) || (!codigo && sinNombre)) {
        r.filasTotales++;
        // Las que dicen «Total» son obviamente totales; sólo se avisa de las que no lo dicen.
        if (!esFilaDeTotal(celdas)) totalesSinRotulo++;
        continue;
      }
      if (!codigo) { error("Falta el código del empleado.", COLUMNA_CODIGO.etiqueta); continue; }
    }
    const emp = ctx.empleados.get(codigo.toLowerCase());
    if (!emp) { error(`No existe un empleado con código «${codigo}».`, COLUMNA_CODIGO.etiqueta); continue; }
    if (!alcanza(emp)) { error("Este empleado está fuera de su alcance de datos.", COLUMNA_CODIGO.etiqueta); continue; }
    const repetida = vistas.get(emp.id);
    if (repetida !== undefined) { error(`El empleado ya viene en la línea ${repetida}.`, COLUMNA_CODIGO.etiqueta); continue; }
    vistas.set(emp.id, linea);

    const planilla = ctx.planillas.get(emp.id);
    const cerrada = planilla && (planilla.estado === "APROBADA" || planilla.estado === "PAGADA");
    let cambiaAlgo = false;

    for (const t of columnasTipo) {
      const bruto = celdaMonto(celdas[indices[claveTipo(t.id)]]);
      // Vacía: ese tipo no se toca. Para no cobrarlo este período se escribe 0 (o el «-» contable).
      if (v.vacia(bruto)) continue;
      const leido = v.decimal(bruto, { min: 0, max: MONTO_MAXIMO });
      if (!leido.ok) { error(leido.error, etiquetaTipo(t)); continue; }
      const nuevo = leido.valor;
      const decision = decidirCelda(ctx.estados.get(`${emp.id}|${t.id}`), nuevo);
      if (decision.accion === "IGUAL") { r.sinCambio++; continue; }
      if (decision.accion === "ERROR") { error(decision.mensaje, etiquetaTipo(t)); continue; }
      if (!emp.cobra) { error("El empleado no está activo: no se le pueden poner montos.", etiquetaTipo(t)); continue; }
      if (cerrada) { error(`La planilla de este período ya está ${ESTADO_PLANILLA[planilla.estado]}: sus deducciones no se pueden cambiar.`, etiquetaTipo(t)); continue; }
      cambiaAlgo = true;

      const referencia = `${emp.codigo} ${emp.nombre}, ${nombreTipo(t)}`;
      const tipoCambio = decision.antes.isZero() ? "CREAR" : decision.despues.isZero() ? "QUITAR" : "ACTUALIZAR";
      if (tipoCambio === "CREAR") r.nuevos++;
      else if (tipoCambio === "QUITAR") r.seQuitan++;
      else r.cambian++;
      const estado = ctx.estados.get(`${emp.id}|${t.id}`);
      const notas = [`${decision.antes.isZero() ? "—" : lempiras(decision.antes)} → ${decision.despues.isZero() ? "—" : lempiras(decision.despues)}`];
      if (decision.accion === "PONER" && estado && !estado.cadaPlanilla.isZero()) {
        const fijo = lempiras(estado.cadaPlanilla);
        notas.push(esIsr(t)
          ? decision.monto.isZero()
            ? `no se retiene ISR en este período; la retención fija de ${fijo} de la ficha vuelve en el siguiente`
            : `reemplaza sólo en este período la retención fija de ${fijo} de la ficha`
          : decision.monto.isZero()
            ? `no se cobra en este período; los ${fijo} de cada planilla vuelven en el siguiente`
            : `reemplaza sólo en este período los ${fijo} de cada planilla`);
      }
      if (decision.accion === "QUITAR" && estado && !estado.cadaPlanilla.isZero()) {
        notas.push(esIsr(t) ? "vuelve a la retención fija de la ficha" : "vuelve a lo de cada planilla");
      }
      r.previsualizacion.push({ linea, accion: tipoCambio, referencia, cambios: notas });
      r.operaciones.push({
        clase: CLASE_MONTO_PERIODO, linea, accion: decision.accion, empleadoId: emp.id, tipoDeduccionId: t.id,
        monto: decision.monto.toFixed(2), antes: decision.antes.toFixed(2), despues: decision.despues.toFixed(2), referencia,
      });
    }

    if (conBase && br) {
      const columna = ETIQUETA_BASE_RAP;
      const bruto = celdas[indices[CLAVE_BASE_RAP_COLUMNA]];
      let nuevo: Money | null = null;
      let legible = true;
      if (!v.vacia(bruto)) {
        const leido = v.decimal(bruto, { min: 0, max: MONTO_MAXIMO });
        if (leido.ok) nuevo = leido.valor;
        else { error(leido.error, columna); legible = false; }
      }
      const decision = legible ? decidirBaseRap(br.importadas.get(emp.id) ?? null, br.automaticas.get(emp.id) ?? CERO, nuevo) : null;
      const planillaMes = br.planillasMes.get(emp.id);
      const cerradaMes = planillaMes && (planillaMes.estado === "APROBADA" || planillaMes.estado === "PAGADA");
      if (decision?.accion === "IGUAL") r.sinCambio++;
      else if (decision && !emp.cobra) error("El empleado no está activo: no se le puede poner base del RAP.", columna);
      else if (decision && cerradaMes) {
        error(`Ya hay una planilla de ${nombreMes(br.mes)} ${ESTADO_PLANILLA[planillaMes.estado]}: la base del RAP de ese mes no se puede cambiar.`, columna);
      } else if (decision) {
        const referencia = `${emp.codigo} ${emp.nombre}, base del RAP de ${nombreMes(br.mes)}`;
        const tipoCambio = decision.accion === "QUITAR" ? "QUITAR" : br.importadas.has(emp.id) ? "ACTUALIZAR" : "CREAR";
        if (tipoCambio === "CREAR") r.nuevos++;
        else if (tipoCambio === "QUITAR") r.seQuitan++;
        else r.cambian++;
        r.previsualizacion.push({
          linea, accion: tipoCambio, referencia,
          cambios: [
            `${lempiras(decision.antes)} → ${lempiras(decision.despues)}`,
            decision.accion === "QUITAR" ? `vuelve a la de las planillas de ${nombreMes(mesAnterior(br.mes))}` : aportesDeBase(decision.despues, br.parametros),
          ],
        });
        r.operaciones.push({
          clase: CLASE_BASE_RAP, linea, accion: decision.accion, empleadoId: emp.id, mes: br.mes,
          base: decision.despues.toFixed(2), antes: decision.antes.toFixed(2), despues: decision.despues.toFixed(2), referencia,
        });
        if (planillaMes && !avisadas.has(emp.id)) {
          avisadas.add(emp.id);
          r.incidencias.push({
            linea, columna: COLUMNA_CODIGO.etiqueta, severidad: "AVISO",
            mensaje: `${emp.codigo} ya está en una planilla de ${nombreMes(br.mes)} ${ESTADO_PLANILLA[planillaMes.estado]}: vuelva a calcularla para que tome la base nueva.`,
          });
        }
      }
    }

    if (cambiaAlgo && planilla && !cerrada && !avisadas.has(emp.id)) {
      avisadas.add(emp.id);
      r.incidencias.push({
        linea, columna: COLUMNA_CODIGO.etiqueta, severidad: "AVISO",
        mensaje: `${emp.codigo} ya está en una planilla de este período ${ESTADO_PLANILLA[planilla.estado]}: vuelva a calcularla para que tome los montos nuevos.`,
      });
    }
    if (emp.tipoPlanilla !== ctx.periodo.tipo && cambiaAlgo) {
      r.incidencias.push({
        linea, columna: COLUMNA_CODIGO.etiqueta, severidad: "AVISO",
        mensaje: `${emp.codigo} cobra en planilla ${emp.tipoPlanilla.toLowerCase()}, no ${ctx.periodo.tipo.toLowerCase()}: el monto se cobrará en su planilla que caiga en estas fechas.`,
      });
    }
  }
  if (totalesSinRotulo) {
    r.incidencias.push({
      linea: L, severidad: "AVISO",
      mensaje: `${totalesSinRotulo === 1 ? "Una fila con montos y sin código ni nombre de empleado parece" : `${totalesSinRotulo} filas con montos y sin código ni nombre de empleado parecen`} de totales o subtotales: no se importa${totalesSinRotulo === 1 ? "" : "n"}.`,
    });
  }
  return r;
}

// ─── COLUMNAS NUEVAS ─────────────────────────────────────────────────────────

/**
 * Las columnas que no son tipos de deducción, con lo que se propone para crearlas:
 * así quien trae el Excel de la planilla de su empresa no tiene que dar de alta cada
 * tipo antes. Se propone NO crear las vacías, los totales y lo que parece de ley.
 */
export function sugerirTiposNuevos(
  hoja: Pick<HojaMontos, "cabeceras" | "filas"> | string,
  desconocidas: readonly string[],
  codigosOcupados: Iterable<string>
): TipoSugerido[] {
  if (desconocidas.length === 0) return [];
  const csv = typeof hoja === "string" ? parsearCsv(hoja) : hoja;
  const ocupados = new Set(codigosOcupados);
  return desconocidas.map((cabecera) => {
    const i = csv.cabeceras.indexOf(cabecera);
    const conMontos = i < 0 ? 0 : csv.filas.filter(({ celdas }) => {
      const valor = celdas[i];
      if (v.vacia(valor)) return false;
      const n = v.decimal(celdaMonto(valor), { min: 0 });
      return n.ok && !n.valor.isZero();
    }).length;
    const partes = partirCabecera(cabecera);
    const codigo = partes.codigo && !ocupados.has(partes.codigo) ? partes.codigo : sugerirCodigo(partes.nombre, ocupados);
    ocupados.add(codigo);
    const motivo = noEsDeduccionPorEmpleado(partes.nombre) ?? (conMontos === 0 ? "La columna no trae montos." : null);
    return { cabecera, nombre: partes.nombre, codigo, tipo: sugerirCategoria(partes.nombre), conMontos, crear: motivo === null, motivo };
  });
}

// ─── CONTEXTO DESDE LA BASE ──────────────────────────────────────────────────

export async function cargarContexto(db: PrismaClient, periodo: PeriodoPlanilla, opciones: { isrManual?: boolean } = {}): Promise<ContextoMontos> {
  const isrManual = opciones.isrManual ?? (await isrEsManual(db));
  const [tipos, todosLosTipos, empleados, recordadas] = await Promise.all([
    cargarTiposMatriz(db, isrManual),
    db.tipoDeduccionConfig.findMany({ select: { codigo: true, nombre: true, activo: true, esLegal: true } }),
    db.empleado.findMany({
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        sucursalId: true, departamentoId: true, tipoPlanilla: true, estado: true,
      },
    }),
    leerEquivalencias(db),
  ]);

  const noImportables = new Map<string, string>();
  for (const t of todosLosTipos) {
    const isr = t.codigo === CODIGO_ISR_FIJO;
    const motivo = t.esLegal
      ? `«${t.nombre}» es una deducción de ley: la calcula la planilla.`
      : isr && !isrManual
        ? MOTIVO_ISR_AUTOMATICO
        : !t.activo ? `El tipo «${t.nombre}» está desactivado.` : null;
    if (!motivo) continue;
    const nombres = [t.codigo, t.nombre, `${t.nombre} (${t.codigo})`, ...(isr ? [ETIQUETA_ISR, ...ALIAS_ISR] : [])];
    for (const nombre of nombres) noImportables.set(normalizarCabecera(nombre), motivo);
  }
  const porCodigo = new Map(tipos.map((t) => [t.codigo, t.id]));
  const equivalencias = new Map<string, string>();
  for (const e of recordadas) {
    const id = porCodigo.get(e.codigo);
    if (id) equivalencias.set(normalizarCabecera(e.cabecera), id);
  }

  const cobran = new Set<string>(ESTADOS_QUE_COBRAN);
  const mapa = new Map<string, EmpleadoMatriz>();
  for (const e of empleados) {
    mapa.set(e.codigo.trim().toLowerCase(), {
      id: e.id, codigo: e.codigo, nombre: nombreCompleto(e), sucursalId: e.sucursalId, departamentoId: e.departamentoId,
      tipoPlanilla: e.tipoPlanilla, cobra: cobran.has(e.estado),
    });
  }

  const ids = empleados.map((e) => e.id);
  const [deducciones, planillas, baseRap] = await Promise.all([
    cargarDeduccionesDelPeriodo(db, ids, tipos.map((t) => t.id), periodo),
    cargarPlanillasDelPeriodo(db, ids, periodo),
    cargarContextoBaseRap(db, ids, periodo),
  ]);
  return { periodo, tipos, equivalencias, noImportables, empleados: mapa, estados: estadosDelPeriodo(deducciones, periodo), planillas, baseRap };
}

// ─── COLUMNAS RECORDADAS ─────────────────────────────────────────────────────
//
// «Ret. Plan Pensiones» no se parece a «AFP Atlántida»: quien importa la asigna una
// vez y queda recordada para las quincenas siguientes. Se guarda en
// ConfiguracionSistema, sin tablas nuevas.

export const CLAVE_EQUIVALENCIAS = "DEDUCCIONES_COLUMNAS";
const MAX_EQUIVALENCIAS = 300;

export interface Equivalencia {
  /** El encabezado tal como viene en el archivo. Se compara normalizado. */
  cabecera: string;
  /** Código del tipo de deducción. */
  codigo: string;
}

export async function leerEquivalencias(db: PrismaClient | Prisma.TransactionClient): Promise<Equivalencia[]> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_EQUIVALENCIAS }, select: { valor: true } });
  if (!fila) return [];
  try {
    const lista: unknown = JSON.parse(fila.valor);
    if (!Array.isArray(lista)) return [];
    return lista.filter((e): e is Equivalencia => typeof e?.cabecera === "string" && typeof e?.codigo === "string");
  } catch {
    // Un valor dañado no debe impedir importar: simplemente no hay columnas recordadas.
    return [];
  }
}

/** Agrega (o cambia) y quita columnas recordadas. Pura. */
export function combinarEquivalencias(actuales: readonly Equivalencia[], agregar: readonly Equivalencia[], quitar: readonly string[]): Equivalencia[] {
  const porClave = new Map(actuales.map((e) => [normalizarCabecera(e.cabecera), e]));
  for (const c of quitar) porClave.delete(normalizarCabecera(c));
  for (const e of agregar) {
    const clave = normalizarCabecera(e.cabecera);
    if (clave) porClave.set(clave, { cabecera: e.cabecera.trim(), codigo: e.codigo });
  }
  return [...porClave.values()].slice(-MAX_EQUIVALENCIAS);
}

export async function guardarEquivalencias(db: PrismaClient | Prisma.TransactionClient, lista: readonly Equivalencia[]): Promise<void> {
  const valor = JSON.stringify(lista);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_EQUIVALENCIAS },
    update: { valor },
    create: { clave: CLAVE_EQUIVALENCIAS, valor, descripcion: "Columnas de planilla asignadas a un tipo de deducción al importar montos del período" },
  });
}

const PESO_ESTADO: Record<PlanillaDelPeriodo["estado"], number> = { BORRADOR: 1, CALCULADA: 2, APROBADA: 3, PAGADA: 4 };

/** Por empleado, la planilla más avanzada que cruza el período (sin contar las anuladas). */
export async function cargarPlanillasDelPeriodo(
  db: PrismaClient | Prisma.TransactionClient,
  empleadoIds: readonly string[],
  periodo: Pick<PeriodoPlanilla, "desde" | "hasta">
): Promise<Map<string, PlanillaDelPeriodo>> {
  const lineas = await db.planillaDetalle.findMany({
    where: {
      empleadoId: { in: [...empleadoIds] },
      planilla: { estado: { not: "ANULADA" }, fechaInicio: { lte: fecha(periodo.hasta) }, fechaFin: { gte: fecha(periodo.desde) } },
    },
    select: { empleadoId: true, planilla: { select: { estado: true } } },
  });
  const salida = new Map<string, PlanillaDelPeriodo>();
  for (const l of lineas) {
    const estado = l.planilla.estado as PlanillaDelPeriodo["estado"];
    const actual = salida.get(l.empleadoId);
    if (!actual || PESO_ESTADO[estado] > PESO_ESTADO[actual.estado]) salida.set(l.empleadoId, { estado });
  }
  return salida;
}

// ─── APLICACIÓN ──────────────────────────────────────────────────────────────

export function observacionMontoPeriodo(periodo: Pick<PeriodoPlanilla, "desde" | "hasta">): string {
  return `${MARCA_MONTO_PERIODO} ${rangoPeriodo(periodo.desde, periodo.hasta)} (importado)`;
}

export interface ResultadoAplicacionMontos {
  creados: number;
  actualizados: number;
  quitados: number;
  ids: string[];
}

/**
 * Escribe las operaciones. No depende de los identificadores que vio la validación:
 * busca el monto del período de esas fechas al escribir, de modo que dos personas
 * importando a la vez no lo duplican. Quitar lo desactiva: queda el rastro.
 */
export async function aplicarMontos(
  tx: Prisma.TransactionClient,
  operaciones: readonly OperacionMonto[],
  periodo: Pick<PeriodoPlanilla, "desde" | "hasta">
): Promise<ResultadoAplicacionMontos> {
  const empleadoIds = [...new Set(operaciones.map((o) => o.empleadoId))];
  const planillas = await cargarPlanillasDelPeriodo(tx, empleadoIds, periodo);
  const cerrada = [...planillas.values()].find((p) => p.estado === "APROBADA" || p.estado === "PAGADA");
  if (cerrada) throw new ErrorMontos(`Mientras revisaba, una planilla de este período quedó ${ESTADO_PLANILLA[cerrada.estado]}. Vuelva a subir el archivo.`);

  const existentes = await tx.deduccionEmpleado.findMany({
    where: {
      empleadoId: { in: empleadoIds },
      activo: true,
      fechaInicio: fecha(periodo.desde),
      fechaFin: fecha(periodo.hasta),
      observacion: { startsWith: MARCA_MONTO_PERIODO },
    },
    select: { id: true, empleadoId: true, tipoDeduccionId: true },
  });
  const porClave = new Map(existentes.map((d) => [`${d.empleadoId}|${d.tipoDeduccionId}`, d.id]));

  const r: ResultadoAplicacionMontos = { creados: 0, actualizados: 0, quitados: 0, ids: [] };
  const observacion = observacionMontoPeriodo(periodo);
  for (const o of operaciones) {
    const id = porClave.get(`${o.empleadoId}|${o.tipoDeduccionId}`);
    if (o.accion === "QUITAR") {
      if (!id) continue;
      await tx.deduccionEmpleado.update({ where: { id }, data: { activo: false, observacion: `${observacion}, quitado` } });
      r.quitados++;
      r.ids.push(id);
    } else if (id) {
      await tx.deduccionEmpleado.update({ where: { id }, data: { monto: o.monto } });
      r.actualizados++;
      r.ids.push(id);
    } else {
      const creada = await tx.deduccionEmpleado.create({
        data: {
          empleadoId: o.empleadoId, tipoDeduccionId: o.tipoDeduccionId, monto: o.monto,
          // Sin saldo ni cuotas, con fecha final: se cobra en la planilla del período y en ninguna otra.
          saldo: null, cuotasMeses: null,
          fechaInicio: fecha(periodo.desde), fechaFin: fecha(periodo.hasta),
          activo: true, observacion,
        },
        select: { id: true },
      });
      porClave.set(`${o.empleadoId}|${o.tipoDeduccionId}`, creada.id);
      r.creados++;
      r.ids.push(creada.id);
    }
  }
  return r;
}

/** Un motivo que se le puede mostrar a quien importa. */
export class ErrorMontos extends Error {}

/**
 * Escribe las bases del RAP. Vuelve a mirar las planillas del mes al escribir: si
 * mientras se revisaba una quedó aprobada, no se toca nada.
 */
export async function aplicarBasesRap(
  tx: Prisma.TransactionClient,
  operaciones: readonly OperacionBaseRap[]
): Promise<ResultadoAplicacionMontos> {
  const r: ResultadoAplicacionMontos = { creados: 0, actualizados: 0, quitados: 0, ids: [] };
  for (const mes of new Set(operaciones.map((o) => o.mes))) {
    const delMes = operaciones.filter((o) => o.mes === mes);
    const rango = rangoMes(mes);
    const planillas = await cargarPlanillasDelPeriodo(tx, delMes.map((o) => o.empleadoId), { desde: dia(rango.desde), hasta: dia(rango.hasta) });
    const cerrada = [...planillas.values()].find((p) => p.estado === "APROBADA" || p.estado === "PAGADA");
    if (cerrada) throw new ErrorMontos(`Mientras revisaba, una planilla de ${nombreMes(mes)} quedó ${ESTADO_PLANILLA[cerrada.estado]}. Vuelva a subir el archivo.`);

    const { anio, mes: m } = partesMes(mes);
    for (const o of delMes) {
      const clave = { empleadoId_anio_mes: { empleadoId: o.empleadoId, anio, mes: m } };
      if (o.accion === "QUITAR") {
        const borradas = await tx.baseRapMes.deleteMany({ where: { empleadoId: o.empleadoId, anio, mes: m } });
        if (borradas.count) r.quitados++;
        continue;
      }
      const existe = await tx.baseRapMes.findUnique({ where: clave, select: { id: true } });
      const fila = await tx.baseRapMes.upsert({
        where: clave,
        update: { base: o.base, origen: "IMPORTACION" },
        create: { empleadoId: o.empleadoId, anio, mes: m, base: o.base, origen: "IMPORTACION" },
        select: { id: true },
      });
      if (existe) r.actualizados++;
      else r.creados++;
      r.ids.push(fila.id);
    }
  }
  return r;
}

// ─── EXPORTACIÓN ─────────────────────────────────────────────────────────────

export interface EmpleadoExportable {
  id: string;
  codigo: string;
  nombre: string;
  departamento: string;
}

/**
 * Filas del archivo, en el orden de las columnas. Las columnas con algún monto van
 * primero: con veinte tipos de deducción, las que se usan no quedan al final de la hoja.
 */
export function armarMatriz(
  empleados: readonly EmpleadoExportable[],
  tipos: readonly TipoColumna[],
  estados: Map<string, EstadoCelda>,
  baseRap: ContextoBaseRap | null = null
): { columnas: ColumnaCsv[]; filas: string[][]; total: Money } {
  const montos = empleados.map((e) => tipos.map((t) => {
    const estado = estados.get(`${e.id}|${t.id}`);
    return estado ? totalDeCelda(estado) : CERO;
  }));
  const usados = tipos.map((_, j) => montos.some((fila) => !fila[j].isZero()));
  // El ISR (en manual) va siempre primero: no es un descuento más.
  const orden = tipos.map((_, j) => j).sort((a, b) =>
    Number(esIsr(tipos[b])) - Number(esIsr(tipos[a])) || Number(usados[b]) - Number(usados[a]) || a - b);
  const [codigo, nombre, departamento, ...deTipos] = columnasMatriz(orden.map((j) => tipos[j]));
  // La base del RAP va justo después de los datos del empleado: no es una deducción más.
  const columnas = [codigo, nombre, departamento, ...(baseRap ? [columnaBaseRap(baseRap.mes)] : []), ...deTipos];
  const filas = empleados.map((e, i) => [
    e.codigo, e.nombre, e.departamento,
    ...(baseRap ? [valorBaseRap(baseRap, e.id)?.toFixed(2) ?? ""] : []),
    ...orden.map((j) => (montos[i][j].isZero() ? "" : montos[i][j].toFixed(2))),
  ]);
  // El total es de deducciones: la base no suma.
  return { columnas, filas, total: sumar(...montos.flat()) };
}

/** Las notas de la hoja «Instrucciones». */
export function notasMatriz(periodo: PeriodoPlanilla, baseRap: ContextoBaseRap | null = null, conIsr = false): string[] {
  const delIsr = conIsr
    ? [`«${ETIQUETA_ISR}»: el ISR está en manual (Parámetros de ley), así que la planilla retiene lo que diga esta columna en vez de calcularlo. Viene con la retención fija de la ficha, si la hay. Vacía, no cambia; 0, no se retiene en el período. A quien no tenga nada no se le retiene ISR.`]
    : [];
  const deLaBase = baseRap
    ? [
        `«${ETIQUETA_BASE_RAP}» NO es una deducción: es lo devengado en ${nombreMes(mesAnterior(baseRap.mes))} (salario ordinario y comisiones), sobre lo que se calculan el RAP del trabajador, el del patrono y la Reserva Laboral que se descuentan en ${nombreMes(baseRap.mes)}. Vale para todas las planillas de ese mes.`,
        baseRap.regla === "TRANSICION"
          ? `${nombreMes(baseRap.mes)} es el primer mes a mes vencido: sólo se descuenta RAP a quien tenga base escrita aquí.`
          : `Viene con el salario de las planillas confirmadas de ${nombreMes(mesAnterior(baseRap.mes))}. Súmele las comisiones o corríjala; vacía en una fila con montos, se usa la del sistema; 0, no se descuenta RAP ese mes.`,
      ]
    : [];
  return [
    `Deducciones ${frasePeriodo(periodo, "de")} (planilla ${periodo.tipo.toLowerCase()}, ${rangoPeriodo(periodo.desde, periodo.hasta)}).`,
    "Vienen todos los empleados activos de la planilla. Cada celda es lo que se descuenta de ese tipo al empleado en el período.",
    "Al importar sólo cuentan las filas con algún monto: una fila vacía no se toca. Una celda vacía tampoco cambia nada; para no cobrar un tipo en este período, escriba 0.",
    ...deLaBase,
    ...delIsr,
    "Para cambiar montos, edítelos aquí y vuelva a importar el archivo en Deducciones → Importar → Montos del período, eligiendo el mismo período. Lo que no cambie no se toca, y reimportar corrige en lugar de duplicar.",
    "Si el empleado tiene una deducción de cada planilla, su monto ya está en la celda: escribir otro la reemplaza sólo en este período, sin cambiar la deducción.",
    "Las cuotas de préstamos y los descuentos a plazo también están incluidos y siguen su curso: el monto no puede ser menor que ellos.",
    "No cambie los nombres de las columnas. Se puede borrar una columna entera: ese tipo no se toca.",
  ];
}
