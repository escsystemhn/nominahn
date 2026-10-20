/**
 * De marcaciones crudas a la jornada del día.
 *
 * El reloj emite eventos sueltos; `Marcaje` es un agregado diario. Este módulo
 * es el puente, y toma cinco decisiones que conviene tener escritas:
 *
 * 1. ENTRADA ES LA PRIMERA MARCA Y SALIDA LA ÚLTIMA. No porque sea obvio, sino
 *    porque ZKTeco no reporta el tipo de marca: `getAttendances()` devuelve un
 *    timestamp pelado. Incluso con un único turno diurno, decidir cuál marca es
 *    la entrada YA ES UNA INFERENCIA. Cuando el equipo sí informa el tipo
 *    (Hikvision en algunos modelos), se respeta lo que diga.
 *
 * 2. EL ALMUERZO NO ES TIEMPO DE TRABAJO. Si la persona lo marcó se descuenta el
 *    hueco real; si no, el fijo del turno. Ver `descanso.ts`.
 *
 * 3. EL DÍA SE RECALCULA CON TODAS SUS MARCAS, NO SÓLO CON LAS NUEVAS. El sondeo
 *    del reloj trae un día en varias tandas —la entrada a media mañana, el resto
 *    por la tarde—. Recalcularlo sólo con la última tanda tomaba el regreso del
 *    almuerzo como si fuera la entrada. Las marcas nuevas deciden QUÉ días se
 *    recalculan; el cálculo usa todas las del día.
 *
 * 4. UNA SOLA MARCA EN EL DÍA NO ES UNA JORNADA DE CERO HORAS. Es alguien que
 *    olvidó marcar la salida. Se registra el día con la hora que hay y una
 *    observación, para que aparezca en la revisión — nunca se liquida en
 *    silencio como si no hubiera trabajado.
 *
 * 5. NO SE PISA UNA CORRECCIÓN MANUAL. Si un supervisor arregló el día a mano,
 *    la siguiente sincronización lo respeta. Ver `sobrescribirManual` en
 *    `registrar-marcaje.ts`.
 */

import { prisma } from "@/lib/prisma";
import { registrarMarcaje } from "./registrar-marcaje";
import { turnoDe, type Turno } from "./turnos";
import { perteneceAlDiaAnterior } from "./turnos-reglas";
import { extremos } from "./extremos";
import { depurarDuplicados, resolverDescanso } from "./descanso";
import type { MarcajeEvento } from "@prisma/client";

export interface ResumenAgregacion {
  diasProcesados: number;
  diasOmitidos: number;
  eventosProcesados: number;
  incidencias: string[];
}

const claveDia = (empleadoId: string, fecha: Date) => `${empleadoId}|${fecha.getTime()}`;
const MS_DIA = 86_400_000;

/**
 * Convierte en jornadas los días que tienen eventos PENDIENTE y marca esos
 * eventos como procesados.
 *
 * `empleadoId` acota el reproceso a una persona: es lo que se usa después de
 * asignar un PIN que estaba en cuarentena.
 */
export async function agregarEventosPendientes(opts?: {
  empleadoId?: string;
  desde?: Date;
}): Promise<ResumenAgregacion> {
  const pendientes = await prisma.marcajeEvento.findMany({
    where: {
      estado: "PENDIENTE",
      empleadoId: opts?.empleadoId ?? { not: null },
      ...(opts?.desde ? { fechaLocal: { gte: opts.desde } } : {}),
    },
    select: { id: true, empleadoId: true, fechaLocal: true, ocurridoEn: true },
  });

  const resumen: ResumenAgregacion = {
    diasProcesados: 0,
    diasOmitidos: 0,
    eventosProcesados: 0,
    incidencias: [],
  };
  if (pendientes.length === 0) return resumen;

  // Turno por empleado y día, consultado una sola vez.
  const cacheTurnos = new Map<string, Promise<Turno>>();
  const turnoEn = (empleadoId: string, fecha: Date) => {
    const k = claveDia(empleadoId, fecha);
    let t = cacheTurnos.get(k);
    if (!t) {
      t = turnoDe(empleadoId, fecha);
      cacheTurnos.set(k, t);
    }
    return t;
  };

  /**
   * Día LABORAL de una marca: el de calendario, salvo que el turno de ayer
   * cruce la medianoche y la marca caiga en la madrugada, antes de su salida
   * más un margen. Así la salida de las 06:00 de un turno de 22:00 a 06:00 se
   * suma a la jornada que empezó ayer y no abre una jornada nueva hoy.
   */
  const fechaLaboral = async (empleadoId: string, fechaLocal: Date, ocurridoEn: Date): Promise<Date> => {
    const ayer = new Date(fechaLocal.getTime() - MS_DIA);
    const t = await turnoEn(empleadoId, ayer);
    const turnoAyer = t.horaEntrada && t.horaSalida ? { horaEntrada: t.horaEntrada, horaSalida: t.horaSalida } : null;
    return perteneceAlDiaAnterior(ocurridoEn, turnoAyer) ? ayer : fechaLocal;
  };

  // Días a recalcular: los que recibieron alguna marca nueva.
  const dias = new Map<string, { empleadoId: string; fecha: Date; pendientes: string[] }>();
  for (const p of pendientes) {
    if (!p.empleadoId) continue;
    const fl = await fechaLaboral(p.empleadoId, p.fechaLocal, p.ocurridoEn);
    const k = claveDia(p.empleadoId, fl);
    const d = dias.get(k) ?? { empleadoId: p.empleadoId, fecha: fl, pendientes: [] };
    d.pendientes.push(p.id);
    dias.set(k, d);
  }

  // TODAS las marcas vigentes de esos días, en una sola consulta. Se piden
  // también las del día siguiente: la madrugada puede ser de la jornada de hoy.
  const fechasConsulta = new Set<number>();
  for (const d of dias.values()) {
    fechasConsulta.add(d.fecha.getTime());
    fechasConsulta.add(d.fecha.getTime() + MS_DIA);
  }
  const todas = await prisma.marcajeEvento.findMany({
    where: {
      empleadoId: { in: [...new Set([...dias.values()].map((d) => d.empleadoId))] },
      fechaLocal: { in: [...fechasConsulta].map((t) => new Date(t)) },
      estado: { in: ["PENDIENTE", "PROCESADO"] },
    },
    orderBy: { ocurridoEn: "asc" },
  });
  const porDia = new Map<string, MarcajeEvento[]>();
  for (const e of todas) {
    if (!e.empleadoId) continue;
    const k = claveDia(e.empleadoId, await fechaLaboral(e.empleadoId, e.fechaLocal, e.ocurridoEn));
    if (!dias.has(k)) continue; // la consulta cruza empleados y fechas; sólo los días pedidos
    const l = porDia.get(k);
    if (l) l.push(e);
    else porDia.set(k, [e]);
  }

  for (const [k, dia] of dias) {
    const { empleadoId, fecha } = dia;
    const marcas = depurarDuplicados(porDia.get(k) ?? []);
    const { entrada, salida } = extremos(marcas);
    const turno = await turnoEn(empleadoId, fecha);

    const descanso =
      entrada && salida
        ? resolverDescanso({ entrada, salida, regla: turno.descanso, marcas })
        : null;

    // Una marca suelta: el día queda registrado y señalado, no liquidado a cero.
    const observacion =
      salida === null
        ? "Marcación incompleta: el reloj sólo reportó una marca. Requiere revisión."
        : descanso?.aviso ?? null;

    const res = await registrarMarcaje({
      empleadoId,
      fecha,
      horaEntrada: entrada,
      horaSalida: salida,
      minutosDescanso: descanso?.minutos ?? 0,
      observacion,
      fuente: "BIOMETRICO",
      jornadaHoras: turno.jornadaHoras,
      // Lo que corrigió una persona pesa más que lo que reporta un aparato.
      sobrescribirManual: false,
    });

    if (!res.ok) {
      resumen.incidencias.push(`Empleado ${empleadoId} el ${fecha.toISOString().slice(0, 10)}: ${res.error}`);
      continue;
    }

    if (res.omitido) resumen.diasOmitidos += 1;
    else resumen.diasProcesados += 1;

    // Se marcan como procesados incluso cuando se omitió el día: el evento ya
    // fue considerado, y dejarlo PENDIENTE lo haría reintentar en cada sync.
    await prisma.marcajeEvento.updateMany({
      where: { id: { in: dia.pendientes } },
      data: { estado: "PROCESADO", procesadoEn: new Date() },
    });
    resumen.eventosProcesados += dia.pendientes.length;
  }

  return resumen;
}
