/**
 * Lecturas y escrituras del RAP a mes vencido (la regla está en `rap-mes-vencido.ts`).
 *
 * La tabla `BaseRapMes` sólo se consulta con la opción encendida: una instalación que
 * no la usa sigue funcionando aunque su base todavía no tenga esa tabla.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { CERO, money, type Money } from "./money";
import { diasConDerechoASalario, type ParametrosLegales } from "./calculos-hn";
import type { PuntoRevision } from "./revision-planilla";
import {
  CLAVE_BASE_RAP,
  CLAVE_RAP_PENDIENTE,
  baseDelMes,
  mesAnterior,
  mesDe,
  nombreMes,
  normalizarBaseRap,
  partesMes,
  rangoMes,
  rapPendienteDeSalida,
  reglaDelMes,
  type BaseRapConfig,
  type OrigenBaseRap,
  type RapPendienteSalida,
  type ReglaRap,
} from "./rap-mes-vencido";

type Db = PrismaClient | Prisma.TransactionClient;

export async function leerBaseRap(db: Pick<PrismaClient, "configuracionSistema">): Promise<BaseRapConfig> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_BASE_RAP } });
  return normalizarBaseRap(fila?.valor ?? null);
}

export async function guardarBaseRap(db: Pick<PrismaClient, "configuracionSistema">, c: BaseRapConfig): Promise<void> {
  const valor = JSON.stringify(c);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_BASE_RAP },
    update: { valor },
    create: {
      clave: CLAVE_BASE_RAP,
      valor,
      descripcion: "RAP y Reserva Laboral sobre el mes en curso o sobre lo devengado el mes anterior (mes vencido).",
    },
  });
}

/** Planillas cuyo cálculo ya es firme: un borrador puede cambiar todavía. */
const CONFIRMADAS = ["CALCULADA", "APROBADA", "PAGADA"] as const;

/** Bases importadas para el mes en que se descuentan. */
export async function cargarBasesImportadas(db: Db, empleadoIds: readonly string[], mes: string): Promise<Map<string, Money>> {
  const { anio, mes: m } = partesMes(mes);
  const filas = await db.baseRapMes.findMany({
    where: { empleadoId: { in: [...empleadoIds] }, anio, mes: m },
    select: { empleadoId: true, base: true },
  });
  return new Map(filas.map((f) => [f.empleadoId, money(f.base)]));
}

/**
 * Lo devengado en el mes como salario ordinario, según las planillas ya confirmadas
 * que terminan en él. `borradores` son las planillas de ese mes todavía en borrador:
 * lo suyo no cuenta hasta confirmarlas.
 */
export async function cargarDevengadoDelMes(
  db: Db,
  empleadoIds: readonly string[],
  mes: string
): Promise<{ porEmpleado: Map<string, Money>; borradores: number }> {
  const { desde, hasta } = rangoMes(mes);
  const [lineas, borradores] = await Promise.all([
    db.planillaDetalle.findMany({
      where: {
        empleadoId: { in: [...empleadoIds] },
        planilla: { estado: { in: [...CONFIRMADAS] }, fechaFin: { gte: desde, lte: hasta } },
      },
      select: { empleadoId: true, salarioBase: true },
    }),
    db.planilla.count({
      where: { estado: "BORRADOR", fechaFin: { gte: desde, lte: hasta }, detalles: { some: { empleadoId: { in: [...empleadoIds] } } } },
    }),
  ]);
  const porEmpleado = new Map<string, Money>();
  for (const l of lineas) porEmpleado.set(l.empleadoId, (porEmpleado.get(l.empleadoId) ?? CERO).plus(money(l.salarioBase)));
  return { porEmpleado, borradores };
}

export interface BasesDelMes {
  porEmpleado: Map<string, { base: Money; origen: OrigenBaseRap }>;
  /** Planillas del mes anterior aún en borrador: su salario no entró en la base. */
  borradoresMesAnterior: number;
}

/**
 * Base declarada de cada empleado en los meses dados que van a mes vencido: la del mes
 * anterior (importada o de sus planillas). Clave `${empleadoId}|${mes}`; un mes sobre
 * el mes en curso no aparece. Para el reporte histórico: reconstruye lo que usó el
 * cálculo. Quien tiene liquidación con el RAP pendiente declara en su finiquito.
 */
export async function basesDeclaradas(
  db: Db,
  empleadoIds: readonly string[],
  meses: readonly string[]
): Promise<Map<string, Money>> {
  const config = await leerBaseRap(db as Pick<PrismaClient, "configuracionSistema">);
  const salida = new Map<string, Money>();
  for (const mes of new Set(meses)) {
    const regla = reglaDelMes(config, mes);
    if (regla === "EN_CURSO") continue;
    const [{ porEmpleado }, conFiniquito] = await Promise.all([
      basesDelMesVencido(db, empleadoIds, mes, regla),
      conRapEnLiquidacion(db, empleadoIds, mes),
    ]);
    for (const id of empleadoIds) salida.set(`${id}|${mes}`, conFiniquito.has(id) ? CERO : porEmpleado.get(id)?.base ?? CERO);
  }
  return salida;
}

// ─── LIQUIDACIÓN ─────────────────────────────────────────────────────────────

/** El concepto del RAP pendiente, tal como se congela en `LiquidacionFinal.conceptos`. */
export interface ConceptoRapPendiente {
  clave: typeof CLAVE_RAP_PENDIENTE;
  detalle: {
    meses: Array<{ mes: string; base: number; declarar: boolean; empleado: number; empleador: number; reserva: number }>;
    empleado: number;
    empleador: number;
    reserva: number;
  };
}

function rapDeConceptos(conceptos: unknown): ConceptoRapPendiente | null {
  if (!Array.isArray(conceptos)) return null;
  const c = conceptos.find((x) => x && typeof x === "object" && (x as { clave?: unknown }).clave === CLAVE_RAP_PENDIENTE);
  return (c as ConceptoRapPendiente | undefined) ?? null;
}

/** Quiénes tienen una liquidación (no anulada) que salió en el mes y ya tomó su RAP pendiente. */
export async function conRapEnLiquidacion(db: Db, empleadoIds: readonly string[], mes: string): Promise<Set<string>> {
  if (empleadoIds.length === 0) return new Set();
  const { desde, hasta } = rangoMes(mes);
  const filas = await db.liquidacionFinal.findMany({
    where: { empleadoId: { in: [...empleadoIds] }, estado: { not: "ANULADA" }, fechaSalida: { gte: desde, lte: hasta } },
    select: { empleadoId: true, conceptos: true },
  });
  return new Set(filas.filter((f) => rapDeConceptos(f.conceptos)).map((f) => f.empleadoId));
}

/**
 * El RAP que le queda a quien sale el `fechaSalida`, si ese mes va a mes vencido; `null`
 * si va sobre el mes en curso (sus planillas ya cotizan el mes).
 */
export async function rapPendienteAlSalir(
  db: Db,
  empleado: { id: string; salarioBase: Prisma.Decimal | number | string; fechaIngreso: Date },
  fechaSalida: Date,
  parametros: ParametrosLegales
): Promise<RapPendienteSalida | null> {
  const mes = mesDe(fechaSalida);
  const regla = reglaDelMes(await leerBaseRap(db as Pick<PrismaClient, "configuracionSistema">), mes);
  if (regla === "EN_CURSO") return null;
  const { desde, hasta } = rangoMes(mes);
  const [bases, descontado] = await Promise.all([
    basesDelMesVencido(db, [empleado.id], mes, regla),
    db.planillaDetalle.aggregate({
      where: { empleadoId: empleado.id, planilla: { estado: { in: [...CONFIRMADAS] }, fechaFin: { gte: desde, lte: hasta } } },
      _sum: { rapEmpleado: true, rapEmpleador: true, reservaLaboral: true },
    }),
  ]);
  return rapPendienteDeSalida({
    mesSalida: mes,
    baseAnterior: bases.porEmpleado.get(empleado.id)?.base ?? CERO,
    descontado: {
      empleado: money(descontado._sum.rapEmpleado ?? 0),
      empleador: money(descontado._sum.rapEmpleador ?? 0),
      reserva: money(descontado._sum.reservaLaboral ?? 0),
    },
    salarioMensual: String(empleado.salarioBase),
    diasEnElMes: diasConDerechoASalario({ fechaIngreso: empleado.fechaIngreso, fechaSalida, desde, hasta, diasMes: 30 }),
  }, parametros);
}

/** Lo que los finiquitos del rango tomaron del RAP: para la Planilla RAP histórica. */
export async function rapDeFiniquitos(
  db: Db,
  where: Prisma.LiquidacionFinalWhereInput,
  desde: Date,
  hasta: Date
): Promise<Array<{ empleadoId: string; empleado: { primerNombre: string; segundoNombre: string | null; primerApellido: string; segundoApellido: string | null; rapNro: string | null }; rap: ConceptoRapPendiente["detalle"] }>> {
  const filas = await db.liquidacionFinal.findMany({
    where: { AND: [where, { estado: { not: "ANULADA" }, fechaSalida: { gte: desde, lte: hasta } }] },
    select: {
      empleadoId: true, conceptos: true,
      empleado: { select: { primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, rapNro: true } },
    },
  });
  return filas.flatMap((f) => {
    const c = rapDeConceptos(f.conceptos);
    return c ? [{ empleadoId: f.empleadoId, empleado: f.empleado, rap: c.detalle }] : [];
  });
}

/**
 * Puntos del panel «Para revisar» de una planilla a mes vencido: a quién no se le
 * descuenta RAP por falta de base, quién entró este mes (empieza el siguiente) y quién
 * tiene la planilla del mes anterior todavía en borrador.
 */
export async function puntosRapMesVencido(
  db: Db,
  planilla: { fechaInicio: Date },
  lineas: readonly { empleadoId: string; nombre: string }[]
): Promise<PuntoRevision[]> {
  const mes = mesDe(planilla.fechaInicio);
  const regla = reglaDelMes(await leerBaseRap(db as Pick<PrismaClient, "configuracionSistema">), mes);
  if (regla === "EN_CURSO" || lineas.length === 0) return [];
  const ids = lineas.map((l) => l.empleadoId);
  const anterior = rangoMes(mesAnterior(mes));
  const { desde: inicioMes, hasta: finMes } = rangoMes(mes);
  const [bases, empleados, conFiniquito, enBorrador] = await Promise.all([
    basesDelMesVencido(db, ids, mes, regla),
    db.empleado.findMany({ where: { id: { in: ids } }, select: { id: true, fechaIngreso: true } }),
    conRapEnLiquidacion(db, ids, mes),
    regla === "ANTERIOR"
      ? db.planillaDetalle.findMany({
          where: { empleadoId: { in: ids }, planilla: { estado: "BORRADOR", fechaFin: { gte: anterior.desde, lte: anterior.hasta } } },
          select: { empleadoId: true },
        })
      : Promise.resolve([]),
  ]);
  const ingreso = new Map(empleados.map((e) => [e.id, e.fechaIngreso]));
  const entraEsteMes = (id: string) => {
    const f = ingreso.get(id);
    return !!f && f >= inicioMes && f <= finMes;
  };
  const quien = (l: { empleadoId: string; nombre: string }) => ({ empleadoId: l.empleadoId, nombre: l.nombre });
  const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");
  const sinBase = lineas.filter((l) =>
    bases.porEmpleado.get(l.empleadoId)?.origen === "SIN_BASE" && !entraEsteMes(l.empleadoId) && !conFiniquito.has(l.empleadoId));
  const nuevos = lineas.filter((l) => entraEsteMes(l.empleadoId));
  const liquidados = lineas.filter((l) => conFiniquito.has(l.empleadoId));
  const borrador = new Set(enBorrador.map((d) => d.empleadoId));

  const puntos: PuntoRevision[] = [];
  if (sinBase.length) {
    puntos.push({
      clave: "rap-sin-base",
      titulo: regla === "TRANSICION"
        ? `Primer mes del RAP a mes vencido: sin base importada para ${nombreMes(mes)}, no se les descuenta RAP ni Reserva (lo de ${nombreMes(mesAnterior(mes))} ya se cotizó en su mes)`
        : `Sin salario de ${nombreMes(mesAnterior(mes))} en planillas confirmadas ni base importada: no se les descuenta RAP ni Reserva este mes`,
      personas: sinBase.map(quien).sort(porNombre),
    });
  }
  if (borrador.size) {
    puntos.push({
      clave: "rap-borrador",
      titulo: `Su planilla de ${nombreMes(mesAnterior(mes))} sigue en borrador: no entró en la base del RAP. Confírmela y recalcule ésta`,
      personas: lineas.filter((l) => borrador.has(l.empleadoId)).map(quien).sort(porNombre),
    });
  }
  if (liquidados.length) {
    puntos.push({
      clave: "rap-liquidacion",
      titulo: "Su liquidación ya tomó el RAP pendiente: en esta planilla no se les descuenta RAP ni Reserva",
      personas: liquidados.map(quien).sort(porNombre),
    });
  }
  if (nuevos.length) {
    puntos.push({
      clave: "rap-nuevos",
      titulo: `Entraron en ${nombreMes(mes)}: empiezan a cotizar RAP el mes siguiente, sobre lo devengado este mes`,
      personas: nuevos.map(quien).sort(porNombre),
    });
  }
  return puntos;
}

/** La base de cada empleado para las planillas del mes `mes`. */
export async function basesDelMesVencido(
  db: Db,
  empleadoIds: readonly string[],
  mes: string,
  regla: Exclude<ReglaRap, "EN_CURSO">
): Promise<BasesDelMes> {
  const [importadas, devengado] = await Promise.all([
    cargarBasesImportadas(db, empleadoIds, mes),
    regla === "ANTERIOR" ? cargarDevengadoDelMes(db, empleadoIds, mesAnterior(mes)) : Promise.resolve({ porEmpleado: new Map<string, Money>(), borradores: 0 }),
  ]);
  const porEmpleado = new Map<string, { base: Money; origen: OrigenBaseRap }>();
  for (const id of empleadoIds) {
    porEmpleado.set(id, baseDelMes(regla, importadas.get(id) ?? null, devengado.porEmpleado.get(id) ?? CERO));
  }
  return { porEmpleado, borradoresMesAnterior: devengado.borradores };
}
