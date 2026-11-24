/**
 * Qué planillas ya deberían estar generadas y no lo están, para Inicio (fase 3 de
 * Planillas por período, 2026-11-24). Por cada frecuencia con gente que cobra:
 *
 * - el período en curso, cuando le quedan `DIAS_AVISO` días o menos, o cuando ya se
 *   generó para unas sucursales y no para otras;
 * - el período anterior, si ya terminó y le falta alguna sucursal, siempre que esa
 *   frecuencia ya se pagara con el sistema antes (en una instalación nueva, los períodos
 *   de antes de empezar a usarlo no son pendientes).
 */

import type { PrismaClient, TipoPlanilla } from "@prisma/client";
import { filtroEmpleados, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { filtroPlanillas } from "./alcance-planilla";
import { filtroCobraEnPeriodo } from "./elegibles";
import { faltantesDelPeriodo } from "./faltantes-periodo-bd";
import { nombresDeUnidades } from "./lote-planillas";
import { TIPOS_PLANILLA, periodoQueContiene, type PeriodoPlanilla } from "./periodos-planilla";

/** Desde cuántos días antes del cierre se avisa del período en curso. */
export const DIAS_AVISO = 4;
const DIA = 86_400_000;
const fecha = (s: string) => new Date(`${s}T00:00:00.000Z`);

export interface PeriodoSinGenerar extends PeriodoPlanilla {
  /** Las sucursales sin su planilla, con el grupo sólo si hay más de uno. */
  sucursales: string[];
  empleados: number;
  /** Ya terminó: hay gente sin pagar. */
  vencido: boolean;
}

/** El período anterior al que contiene `p.desde`. */
export function periodoAnterior(p: PeriodoPlanilla): PeriodoPlanilla {
  return periodoQueContiene(p.tipo, new Date(fecha(p.desde).getTime() - DIA).toISOString().slice(0, 10));
}

/** ¿Toca avisar del período en curso? */
export function avisarDelEnCurso(p: PeriodoPlanilla, hoy: string, yaTieneAlguna: boolean): boolean {
  return yaTieneAlguna || (fecha(p.hasta).getTime() - fecha(hoy).getTime()) / DIA <= DIAS_AVISO;
}

export async function periodosSinGenerar(
  db: PrismaClient,
  usuario: UsuarioConAlcance,
  hoy: string,
  conDivisiones: boolean,
): Promise<PeriodoSinGenerar[]> {
  // Sólo las frecuencias en que hoy cobra alguien dentro del alcance de la cuenta.
  const conGente = await db.empleado.groupBy({
    by: ["tipoPlanilla"],
    where: { AND: [filtroCobraEnPeriodo(fecha(hoy)), filtroEmpleados(usuario)] },
    _count: { _all: true },
  });
  const tipos = TIPOS_PLANILLA.filter((t) => conGente.some((c) => c.tipoPlanilla === t && c._count._all > 0));

  const salida: PeriodoSinGenerar[] = [];
  for (const tipo of tipos) {
    const actual = periodoQueContiene(tipo, hoy);
    const anterior = periodoAnterior(actual);
    const buscar = (p: PeriodoPlanilla) => faltantesDelPeriodo(db, { tipo: tipo as TipoPlanilla, desde: fecha(p.desde), hasta: fecha(p.hasta) }, usuario, { conDivisiones });
    const [usadoAntes, ra, rc] = await Promise.all([
      db.planilla.count({ where: { AND: [{ tipo: tipo as TipoPlanilla, fechaFin: { lt: fecha(anterior.desde) }, estado: { not: "ANULADA" } }, filtroPlanillas(usuario)] } }),
      buscar(anterior),
      buscar(actual),
    ]);
    const anotar = (p: PeriodoPlanilla, r: Awaited<ReturnType<typeof buscar>>, vencido: boolean) => salida.push({
      ...p, sucursales: nombresDeUnidades(r.faltan), empleados: r.faltan.reduce((n, u) => n + u.empleados, 0), vencido,
    });
    if (ra.faltan.length > 0 && (usadoAntes > 0 || ra.planillas.length > 0)) anotar(anterior, ra, true);
    if (rc.faltan.length > 0 && avisarDelEnCurso(actual, hoy, rc.planillas.length > 0)) anotar(actual, rc, false);
  }
  return salida;
}
