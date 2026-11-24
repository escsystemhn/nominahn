/** Horas extra del período: lo que necesita la base (ver `horas-extra-periodo.ts`). */

import type { Prisma, PrismaClient } from "@prisma/client";
import { combinarFijadas, sumarMarcajes, type HorasFijadas, type HorasPorRecargo } from "./horas-extra-periodo";

type Db = PrismaClient | Prisma.TransactionClient;

const fecha = (d: Date | string) => (d instanceof Date ? d : new Date(`${d}T00:00:00.000Z`));

/**
 * Lo fijado para la planilla de `desde` a `hasta`, por empleado: los registros que caen
 * dentro de esas fechas (uno de la quincena en su quincena; uno semanal, en la mensual).
 */
export async function cargarHorasFijadas(db: Db, empleadoIds: readonly string[], desde: Date | string, hasta: Date | string): Promise<Map<string, HorasFijadas>> {
  if (!empleadoIds.length) return new Map();
  const filas = await db.horasExtraPeriodo.findMany({
    where: { empleadoId: { in: [...empleadoIds] }, fechaInicio: { gte: fecha(desde) }, fechaFin: { lte: fecha(hasta) } },
    select: { empleadoId: true, diurnas: true, mixtas: true, nocturnas: true, feriado: true },
  });
  const porEmpleado = new Map<string, typeof filas>();
  for (const f of filas) porEmpleado.set(f.empleadoId, [...(porEmpleado.get(f.empleadoId) ?? []), f]);
  const salida = new Map<string, HorasFijadas>();
  for (const [id, lista] of porEmpleado) {
    const c = combinarFijadas(lista);
    if (c) salida.set(id, c);
  }
  return salida;
}

/** Lo que suman los marcajes del período, por empleado. */
export async function cargarHorasDeMarcajes(db: Db, empleadoIds: readonly string[], desde: Date | string, hasta: Date | string): Promise<Map<string, HorasPorRecargo>> {
  if (!empleadoIds.length) return new Map();
  const marcajes = await db.marcaje.findMany({
    where: { empleadoId: { in: [...empleadoIds] }, fecha: { gte: fecha(desde), lte: fecha(hasta) } },
    select: { empleadoId: true, horasExtra: true, horasExtraDiurna: true, horasExtraMixta: true, horasExtraNocturna: true, horasFeriado: true },
  });
  const porEmpleado = new Map<string, typeof marcajes>();
  for (const m of marcajes) porEmpleado.set(m.empleadoId, [...(porEmpleado.get(m.empleadoId) ?? []), m]);
  return new Map([...porEmpleado].map(([id, lista]) => [id, sumarMarcajes(lista)]));
}

/** Lo de hoy de cada empleado en el período: lo que el formato muestra y contra lo que se compara al importar. */
export interface HorasDelPeriodoBd {
  fijadas: Map<string, HorasFijadas>;
  marcajes: Map<string, HorasPorRecargo>;
}

export async function cargarHorasDelPeriodo(db: Db, empleadoIds: readonly string[], periodo: { desde: string; hasta: string }): Promise<HorasDelPeriodoBd> {
  const [fijadas, marcajes] = await Promise.all([
    cargarHorasFijadas(db, empleadoIds, periodo.desde, periodo.hasta),
    cargarHorasDeMarcajes(db, empleadoIds, periodo.desde, periodo.hasta),
  ]);
  return { fijadas, marcajes };
}
