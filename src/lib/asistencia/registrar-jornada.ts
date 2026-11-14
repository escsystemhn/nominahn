/**
 * Registrar a mano la jornada de un día: lo que hace «Registrar marcaje» y, en lote, la
 * carga rápida de Asistencia.
 *
 * Vivía dentro de `POST /api/marcajes`. La carga rápida guarda decenas de filas con la
 * misma lógica, así que se sacó aquí: un solo camino para el turno del día, la salida
 * que cruza la medianoche, el almuerzo y el reparto de horas (`registrarMarcaje`).
 */
import { prisma } from "@/lib/prisma";
import { registrarMarcaje, type ResultadoMarcaje } from "./registrar-marcaje";
import { turnoDe } from "./turnos";
import { resolverDescanso } from "./descanso";
import { formatDate, hoyHN } from "@/lib/utils";

export interface JornadaManual {
  empleadoId: string;
  /** Fecha de calendario (medianoche UTC). */
  fecha: Date;
  horaEntrada?: Date | null;
  horaSalida?: Date | null;
  esAusencia?: boolean;
  esDiaLibre?: boolean;
  observacion?: string | null;
  /** Almuerzo a descontar; si no viene, el del turno. */
  minutosDescanso?: number;
  /** Quien registra a mano es MANUAL; la ruta lo deja indicar, como antes. */
  fuente?: "BIOMETRICO" | "MANUAL";
}

/**
 * ¿Ya está ese día en una planilla aprobada o pagada de esa persona? Entonces lo que se
 * registre no se pagaría: se rechaza, como en la importación de horas. Una planilla
 * cerrada no se recalcula (ver planilla-cerrada-inmutable).
 */
export async function planillaCerradaDelDia(empleadoId: string, fecha: Date): Promise<string | null> {
  const p = await prisma.planilla.findFirst({
    where: {
      estado: { in: ["APROBADA", "PAGADA"] },
      fechaInicio: { lte: fecha },
      fechaFin: { gte: fecha },
      detalles: { some: { empleadoId } },
    },
    select: { estado: true, fechaInicio: true, fechaFin: true },
  });
  return p
    ? `Este día ya está en una planilla ${p.estado === "PAGADA" ? "pagada" : "aprobada"} (${formatDate(p.fechaInicio)} a ${formatDate(p.fechaFin)}): lo que registre no se pagaría.`
    : null;
}

export async function registrarJornadaManual(d: JornadaManual): Promise<ResultadoMarcaje> {
  if (d.fecha > hoyHN()) return { ok: false, error: "Es una fecha futura: registre la jornada cuando ya se haya trabajado.", status: 400 };
  const cerrada = await planillaCerradaDelDia(d.empleadoId, d.fecha);
  if (cerrada) return { ok: false, error: cerrada, status: 409 };

  const turno = await turnoDe(d.empleadoId, d.fecha);
  const horaEntrada = d.horaEntrada ?? null;
  let horaSalida = d.horaSalida ?? null;

  // Turno nocturno: quien teclea entrada 22:00 y salida 06:00 sobre la misma fecha
  // quiere decir las 06:00 del día siguiente. Sólo con un turno que cruza la
  // medianoche: en un turno de día, una salida anterior a la entrada es un error de
  // tecleo y debe rechazarse.
  if (horaEntrada && horaSalida && turno.cruzaMedianoche && horaSalida.getTime() <= horaEntrada.getTime()) {
    horaSalida = new Date(horaSalida.getTime() + 86_400_000);
  }

  // Quien teclea 07:00 a 16:00 espera 8 horas, no 9: sin indicar almuerzo, se descuenta
  // el fijo del turno, igual que cuando el reloj no lo registra.
  const descanso =
    d.minutosDescanso !== undefined
      ? d.minutosDescanso
      : horaEntrada && horaSalida
        ? resolverDescanso({ entrada: horaEntrada, salida: horaSalida, regla: turno.descanso }).minutos
        : 0;

  return registrarMarcaje({
    empleadoId: d.empleadoId,
    fecha: d.fecha,
    horaEntrada,
    horaSalida,
    esAusencia: d.esAusencia,
    esDiaLibre: d.esDiaLibre,
    observacion: d.observacion,
    fuente: d.fuente ?? "MANUAL",
    jornadaHoras: turno.jornadaHoras,
    tipoJornada: turno.tipoJornada,
    minutosDescanso: descanso,
  });
}
