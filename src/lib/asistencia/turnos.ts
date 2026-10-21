/**
 * Turno al que pertenece la jornada de un empleado en un día.
 *
 * Orden de resolución:
 *   1. La asignación vigente del empleado (`AsignacionTurno` con `desde` ≤ fecha
 *      y sin `hasta` o con `hasta` ≥ fecha; la de `desde` más reciente).
 *   2. El turno marcado como «por omisión».
 *   3. El diurno de siempre (8 h, almuerzo de 60 min), que era el único que
 *      existía antes de los turnos: una instalación sin turnos configurados
 *      sigue calculando exactamente igual.
 *
 * Por qué todo pasa por aquí: convertir marcaciones en un día trabajado exige
 * saber a qué turno pertenecen. Dos preguntas que TOCAN EL PAGO dependen de esto:
 *   · ¿La marca de las 06:00 es la salida del nocturno de ayer o la entrada de hoy?
 *   · ¿Cuántas horas ordinarias tiene esa persona antes de que empiece la extra?
 * El ingestor, el agregador y el registro manual consultan esta función en vez
 * de asumir una jornada fija.
 */

import { prisma } from "@/lib/prisma";
import { JORNADA_HORAS } from "@/lib/payroll/calculos-hn";
import type { ReglaDescanso } from "./descanso";
import { cruzaMedianoche, describirTurno, type TipoJornada } from "./turnos-reglas";
import { tipoJornada as tipoJornadaPorHoras, horaDeMinutos, MAX_DIARIO_H, PAUSA_COMPUTABLE_MAX_MIN } from "@/lib/horarios/ley";

export interface Turno {
  /** Horas de la jornada ordinaria. Por encima de esto empieza la extra. */
  jornadaHoras: number;
  /**
   * El almuerzo no es tiempo de trabajo. Cuánto se descuenta cuando nadie lo
   * marcó, y a partir de qué lapso se asume que lo hubo. Ver `descanso.ts`.
   */
  descanso: ReglaDescanso;
  /** ¿La jornada termina al día siguiente? (turno nocturno). */
  cruzaMedianoche: boolean;
  /** Etiqueta para mostrar. */
  nombre: string;
  /** `null` en el turno implícito, que no está guardado. */
  id: string | null;
  tipoJornada: TipoJornada;
  /** "HH:MM"; `null` en el turno implícito, que no tiene horario fijo. */
  horaEntrada: string | null;
  horaSalida: string | null;
  toleranciaMinutos: number;
  diasLaborales: string;
}

export const TURNO_DIURNO: Turno = {
  jornadaHoras: JORNADA_HORAS,
  // Una hora: es lo que implica el horario por defecto sembrado en la
  // configuración (08:00 a 17:00 con jornada de 8 h). Por debajo de 6 h de
  // lapso —medio día, un sábado— no se asume almuerzo.
  descanso: { almuerzoMinutos: 60, almuerzoDesdeHoras: 6 },
  cruzaMedianoche: false,
  nombre: "Diurno",
  id: null,
  tipoJornada: "DIURNA",
  horaEntrada: null,
  horaSalida: null,
  toleranciaMinutos: 0,
  diasLaborales: "1,2,3,4,5",
};

interface FilaTurno {
  id: string;
  nombre: string;
  tipoJornada: TipoJornada;
  horaEntrada: string;
  horaSalida: string;
  jornadaHoras: { toString(): string } | number;
  almuerzoMinutos: number;
  almuerzoDesdeHoras: { toString(): string } | number;
  toleranciaMinutos: number;
  diasLaborales: string;
}

export function turnoDesdeFila(t: FilaTurno): Turno {
  return {
    id: t.id,
    nombre: t.nombre,
    tipoJornada: t.tipoJornada,
    horaEntrada: t.horaEntrada,
    horaSalida: t.horaSalida,
    jornadaHoras: Number(t.jornadaHoras),
    descanso: { almuerzoMinutos: t.almuerzoMinutos, almuerzoDesdeHoras: Number(t.almuerzoDesdeHoras) },
    cruzaMedianoche: cruzaMedianoche(t.horaEntrada, t.horaSalida),
    toleranciaMinutos: t.toleranciaMinutos,
    diasLaborales: t.diasLaborales,
  };
}

type ClienteLectura = Pick<typeof prisma, "asignacionTurno" | "turno" | "horarioDia">;

/**
 * Turno de un día que viene de un horario rotativo PUBLICADO (src/lib/horarios).
 * Es la fuente más específica: dice qué hizo esa persona ESE día, no qué turno
 * tiene en general. La pausa de hasta 30 min de una jornada continua cuenta como
 * trabajo (Art. 326) y no se descuenta; un almuerzo más largo sí.
 */
function turnoDePlan(d: {
  entrada: number; salida: number; pausa: number;
  turno: { id: string; nombre: string; jornadaHoras: { toString(): string } | number; almuerzoDesdeHoras: { toString(): string } | number; toleranciaMinutos: number } | null;
}): Turno {
  const tipo = tipoJornadaPorHoras(d.entrada, d.salida);
  const legal = MAX_DIARIO_H[tipo];
  return {
    id: d.turno?.id ?? null,
    nombre: d.turno?.nombre ?? "Horario del plan",
    tipoJornada: tipo,
    horaEntrada: horaDeMinutos(d.entrada),
    horaSalida: horaDeMinutos(d.salida),
    jornadaHoras: d.turno ? Math.min(legal, Number(d.turno.jornadaHoras)) : legal,
    descanso: { almuerzoMinutos: d.pausa > PAUSA_COMPUTABLE_MAX_MIN ? d.pausa : 0, almuerzoDesdeHoras: d.turno ? Number(d.turno.almuerzoDesdeHoras) : 6 },
    cruzaMedianoche: d.salida > 1440,
    toleranciaMinutos: d.turno?.toleranciaMinutos ?? 0,
    diasLaborales: "1,2,3,4,5,6,7",
  };
}

/** El turno vigente de un empleado en una fecha de calendario. */
export async function turnoDe(empleadoId: string, fecha: Date, db: ClienteLectura = prisma): Promise<Turno> {
  const planificado = await db.horarioDia
    .findFirst({
      where: { empleadoId, fecha, estado: "TURNO", entrada: { not: null }, salida: { not: null }, plan: { estado: "PUBLICADO" } },
      include: { turno: true },
    })
    .catch((e: unknown) => {
      // Base sin las tablas de horarios todavía (P2021): se sigue como antes de
      // que existieran, en vez de tumbar la asistencia y la planilla.
      if ((e as { code?: string })?.code === "P2021") return null;
      throw e;
    });
  if (planificado && planificado.entrada !== null && planificado.salida !== null) {
    return turnoDePlan({ entrada: planificado.entrada, salida: planificado.salida, pausa: planificado.pausa, turno: planificado.turno });
  }

  const asignacion = await db.asignacionTurno.findFirst({
    where: { empleadoId, desde: { lte: fecha }, OR: [{ hasta: null }, { hasta: { gte: fecha } }], turno: { activo: true } },
    orderBy: { desde: "desc" },
    include: { turno: true },
  });
  if (asignacion) return turnoDesdeFila(asignacion.turno);

  const porDefecto = await db.turno.findFirst({ where: { esPorDefecto: true, activo: true } });
  return porDefecto ? turnoDesdeFila(porDefecto) : TURNO_DIURNO;
}

/** Atajo para quien sólo necesita el número de horas ordinarias. */
export async function jornadaHorasDe(empleadoId: string, fecha: Date): Promise<number> {
  return (await turnoDe(empleadoId, fecha)).jornadaHoras;
}

/** Jornada y horario en palabras, para el contrato; `null` si el turno no tiene horario fijo. */
export function textoTurno(t: Turno): { jornada: string; horario: string } | null {
  if (!t.horaEntrada || !t.horaSalida) return null;
  return describirTurno({ tipoJornada: t.tipoJornada, horaEntrada: t.horaEntrada, horaSalida: t.horaSalida, diasLaborales: t.diasLaborales });
}
