/**
 * Reporte de puntualidad: llegadas tarde y días laborales sin marca, según el
 * turno de cada día. INFORMATIVO: no descuenta salario ni crea ausencias.
 */

import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import { turnoDesdeFila, TURNO_DIURNO, type Turno } from "./turnos";
import { esDiaLaboral, minutosTardanza } from "./turnos-reglas";

const MS_DIA = 86_400_000;
export const MAX_DIAS_REPORTE = 92;

export interface FilaPuntualidad {
  empleado: string;
  sucursal: string;
  turno: string;
  diasConMarca: number;
  llegadasTarde: number;
  minutosTarde: number;
  diasSinMarca: number;
}

/** Resuelve el turno de cada empleado y día con dos consultas, sin una por día. */
export async function resolutorTurnos(empleadoIds: string[], desde: Date, hasta: Date): Promise<(empleadoId: string, fecha: Date) => Turno> {
  const [asignaciones, porDefecto] = await Promise.all([
    prisma.asignacionTurno.findMany({
      where: { empleadoId: { in: empleadoIds }, desde: { lte: hasta }, OR: [{ hasta: null }, { hasta: { gte: desde } }], turno: { activo: true } },
      orderBy: { desde: "desc" },
      include: { turno: true },
    }),
    prisma.turno.findFirst({ where: { esPorDefecto: true, activo: true } }),
  ]);
  const base = porDefecto ? turnoDesdeFila(porDefecto) : TURNO_DIURNO;
  const porEmp = new Map<string, typeof asignaciones>();
  for (const a of asignaciones) porEmp.set(a.empleadoId, [...(porEmp.get(a.empleadoId) ?? []), a]);
  return (empleadoId, fecha) => {
    const a = (porEmp.get(empleadoId) ?? []).find((x) => x.desde <= fecha && (!x.hasta || x.hasta >= fecha));
    return a ? turnoDesdeFila(a.turno) : base;
  };
}

export async function reportePuntualidad(desde: Date, hasta: Date, filtro: { sucursalId?: string; departamentoId?: string }): Promise<FilaPuntualidad[]> {
  const empleados = await prisma.empleado.findMany({
    where: {
      estado: { not: "INACTIVO" },
      fechaIngreso: { lte: hasta },
      ...(filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {}),
      ...(filtro.departamentoId ? { departamentoId: filtro.departamentoId } : {}),
    },
    select: {
      id: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
      fechaIngreso: true, fechaSalida: true, sucursalId: true, sucursal: { select: { nombre: true } },
    },
  });
  if (empleados.length === 0) return [];
  const ids = empleados.map((e) => e.id);

  const [turnoDe, marcajes, feriados, permisos, incapacidades] = await Promise.all([
    resolutorTurnos(ids, desde, hasta),
    prisma.marcaje.findMany({ where: { empleadoId: { in: ids }, fecha: { gte: desde, lte: hasta } }, select: { empleadoId: true, fecha: true, horaEntrada: true, esAusencia: true } }),
    prisma.feriado.findMany({ where: { activo: true, fecha: { gte: desde, lte: hasta } }, select: { fecha: true, sucursalId: true } }),
    prisma.permiso.findMany({ where: { empleadoId: { in: ids }, estado: "APROBADO", fechaInicio: { lte: hasta }, fechaFin: { gte: desde } }, select: { empleadoId: true, fechaInicio: true, fechaFin: true } }),
    prisma.incapacidad.findMany({ where: { empleadoId: { in: ids }, anulada: false, fechaInicio: { lte: hasta }, fechaFin: { gte: desde } }, select: { empleadoId: true, fechaInicio: true, fechaFin: true } }),
  ]);

  const marcaPorDia = new Map(marcajes.map((m) => [`${m.empleadoId}|${m.fecha.getTime()}`, m]));
  const esFeriado = (fecha: Date, sucursalId: string) => feriados.some((f) => f.fecha.getTime() === fecha.getTime() && (!f.sucursalId || f.sucursalId === sucursalId));
  const justificado = (empleadoId: string, fecha: Date) =>
    permisos.some((p) => p.empleadoId === empleadoId && p.fechaInicio <= fecha && p.fechaFin >= fecha) ||
    incapacidades.some((i) => i.empleadoId === empleadoId && i.fechaInicio <= fecha && i.fechaFin >= fecha);

  const filas: FilaPuntualidad[] = [];
  for (const e of empleados) {
    const fila: FilaPuntualidad = { empleado: nombreCompleto(e), sucursal: e.sucursal.nombre, turno: "", diasConMarca: 0, llegadasTarde: 0, minutosTarde: 0, diasSinMarca: 0 };
    const turnos = new Set<string>();
    for (let t = desde.getTime(); t <= hasta.getTime(); t += MS_DIA) {
      const fecha = new Date(t);
      if (fecha < e.fechaIngreso || (e.fechaSalida && fecha > e.fechaSalida)) continue;
      const turno = turnoDe(e.id, fecha);
      turnos.add(turno.nombre);
      const marca = marcaPorDia.get(`${e.id}|${t}`);
      if (marca && marca.horaEntrada && !marca.esAusencia) {
        fila.diasConMarca++;
        if (turno.horaEntrada) {
          const tarde = minutosTardanza(marca.horaEntrada, { horaEntrada: turno.horaEntrada, toleranciaMinutos: turno.toleranciaMinutos });
          if (tarde > 0) {
            fila.llegadasTarde++;
            fila.minutosTarde += tarde;
          }
        }
        continue;
      }
      if (esDiaLaboral(fecha, turno.diasLaborales) && !esFeriado(fecha, e.sucursalId) && !justificado(e.id, fecha)) fila.diasSinMarca++;
    }
    fila.turno = [...turnos].join(", ");
    filas.push(fila);
  }
  return filas.sort((a, b) => b.minutosTarde - a.minutosTarde || a.empleado.localeCompare(b.empleado));
}
