/**
 * Qué sucursales no tienen todavía su planilla en un período (fase 2 de Planillas por
 * período, 2026-11-24). Se mira a la PERSONA, igual que el cálculo: quien cobra en el
 * período (`filtroCobraEnPeriodo`, ingresó a más tardar al cierre, con ese tipo de
 * planilla) y no está en ninguna planilla vigente que toque esas fechas. Así no importa
 * si la empresa genera por sucursal, por grupo o de toda la empresa.
 */

import type { EstadoPlanilla as EstadoPlanillaBd, Prisma, PrismaClient, TipoPlanilla } from "@prisma/client";
import { filtroEmpleados, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { filtroPlanillas } from "./alcance-planilla";
import { filtroCobraEnPeriodo } from "./elegibles";
import { ESTADOS_OCUPAN_PERIODO } from "./estado-planilla";
import { unidadesSinPlanilla, type UnidadSinPlanilla } from "./lote-planillas";
import type { EstadoLista } from "./planillas-por-periodo";

export interface FaltantesDelPeriodo {
  /** Sin planilla propia: hay que generarla. */
  faltan: UnidadSinPlanilla[];
  /** Con planilla, pero con personas que no están en ella. */
  fuera: UnidadSinPlanilla[];
  /** Las planillas vigentes del período (dentro del alcance de la cuenta). */
  planillas: Array<{ id: string; estado: EstadoLista; empresaId: string; sucursalId: string | null; divisionId: string | null; departamentoId: string | null; sucursal: string | null; division: string | null; departamento: string | null }>;
}

export async function faltantesDelPeriodo(
  db: PrismaClient,
  periodo: { tipo: TipoPlanilla; desde: Date; hasta: Date },
  usuario: UsuarioConAlcance,
  opciones: {
    conDivisiones: boolean;
    /** El filtro de la lista, sobre las personas… */
    filtroOrg?: Prisma.EmpleadoWhereInput;
    /** …y sobre las planillas: con un grupo elegido, las de los demás no cuentan. */
    filtroPlanillasOrg?: Prisma.PlanillaWhereInput;
  },
): Promise<FaltantesDelPeriodo> {
  const { tipo, desde, hasta } = periodo;
  const ocupan = [...ESTADOS_OCUPAN_PERIODO] as EstadoPlanillaBd[];
  const [empleados, planillas] = await Promise.all([
    db.empleado.findMany({
      where: { AND: [{ tipoPlanilla: tipo, fechaIngreso: { lte: hasta }, ...filtroCobraEnPeriodo(desde) }, filtroEmpleados(usuario), opciones.filtroOrg ?? {}] },
      select: {
        id: true, sucursalId: true,
        sucursal: { select: { nombre: true, empresaId: true } },
        departamento: { select: { divisionId: true, division: { select: { nombre: true } } } },
      },
    }),
    db.planilla.findMany({
      where: { AND: [{ tipo, fechaInicio: desde, fechaFin: hasta, estado: { in: ocupan } }, filtroPlanillas(usuario), opciones.filtroPlanillasOrg ?? {}] },
      select: {
        id: true, estado: true, empresaId: true, sucursalId: true, divisionId: true, departamentoId: true,
        sucursal: { select: { nombre: true } }, division: { select: { nombre: true } }, departamento: { select: { nombre: true } },
      },
    }),
  ]);

  // Quién ya está en una planilla vigente que toca estas fechas, de cualquier alcance o tipo.
  const enPlanilla = new Set(
    empleados.length === 0 ? [] : (await db.planillaDetalle.findMany({
      where: {
        empleadoId: { in: empleados.map((e) => e.id) },
        planilla: { estado: { in: ocupan }, fechaInicio: { lte: hasta }, fechaFin: { gte: desde } },
      },
      select: { empleadoId: true },
      distinct: ["empleadoId"],
    })).map((d) => d.empleadoId),
  );

  const lista = planillas.map((p) => ({
    id: p.id, estado: p.estado as EstadoLista, empresaId: p.empresaId,
    sucursalId: p.sucursalId, divisionId: p.divisionId, departamentoId: p.departamentoId,
    sucursal: p.sucursal?.nombre ?? null, division: p.division?.nombre ?? null, departamento: p.departamento?.nombre ?? null,
  }));
  const unidades = unidadesSinPlanilla(
    empleados.map((e) => ({
      id: e.id, empresaId: e.sucursal.empresaId, sucursalId: e.sucursalId, sucursal: e.sucursal.nombre,
      divisionId: e.departamento.divisionId, division: e.departamento.division?.nombre ?? null,
    })),
    enPlanilla,
    lista,
    opciones.conDivisiones,
  );
  return { faltan: unidades.filter((u) => !u.planilla), fuera: unidades.filter((u) => u.planilla), planillas: lista };
}
