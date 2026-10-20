/**
 * Registro de la jornada de un empleado en un día.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO DENTRO DE LA RUTA. Esta lógica vivía dentro de
 * `POST /api/marcajes`. Al llegar la ingesta desde el reloj biométrico había dos
 * caminos posibles: que el ingestor reimplementara el reparto de jornada, o que
 * ambos llamaran al mismo sitio. Lo primero deja DOS motores de horas extra que
 * se desincronizan en cuanto alguien toque uno — y la divergencia no aparece
 * como un error, aparece como diferencias de pago meses después.
 *
 * Aquí está el único camino: valida, resuelve si el día lleva recargo y reparte
 * la jornada con `repartirJornada` (Arts. 322-325, 330 y 339).
 */

import { prisma } from "@/lib/prisma";
import { repartirJornada, type HorasExtraPorJornada } from "@/lib/payroll/calculos-hn";
import type { Marcaje, Prisma } from "@prisma/client";

export type FuenteMarcaje = "BIOMETRICO" | "MANUAL";

export interface DatosMarcaje {
  empleadoId: string;
  /** Fecha de CALENDARIO (medianoche UTC), como manda la doctrina de utils.ts. */
  fecha: Date;
  horaEntrada?: Date | null;
  horaSalida?: Date | null;
  esAusencia?: boolean;
  esDiaLibre?: boolean;
  observacion?: string | null;
  fuente?: FuenteMarcaje;
  /** Horas de la jornada ordinaria del turno. Ver `lib/asistencia/turnos.ts`. */
  jornadaHoras?: number;
  /**
   * Almuerzo u otra pausa que se descuenta del lapso: no es tiempo de trabajo.
   * Lo resuelve quien llama con `resolverDescanso` (marcado o fijo del turno);
   * aquí sólo se aplica y se guarda.
   */
  minutosDescanso?: number;
  /**
   * Si es `false`, no se pisa un marcaje que ya existe con `fuente = MANUAL`.
   *
   * Lo usa la ingesta del reloj: cuando un supervisor corrige a mano el día de
   * alguien —porque olvidó marcar la salida, típicamente— la siguiente
   * sincronización no debe deshacer esa corrección.
   */
  sobrescribirManual?: boolean;
}

export type ResultadoMarcaje =
  | { ok: true; marcaje: Marcaje; omitido?: false }
  | { ok: true; marcaje: Marcaje; omitido: true; motivo: string }
  | { ok: false; error: string; status: number };

/** Cliente Prisma o transacción: permite componer con otras escrituras. */
type ClientePrisma = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * ¿El día lleva el recargo del Art. 339?
 *
 * Cubre feriado nacional y asueto de la sucursal. El descanso semanal llega por
 * `esDiaLibre`, que decide quien registra.
 */
async function esDiaConRecargo(
  db: ClientePrisma,
  empleadoId: string,
  fecha: Date
): Promise<{ ok: true; recargo: boolean } | { ok: false; error: string; status: number }> {
  const empleado = await db.empleado.findUnique({
    where: { id: empleadoId },
    select: { sucursalId: true },
  });
  if (!empleado) return { ok: false, error: "Empleado no encontrado", status: 404 };

  const feriado = await db.feriado.findFirst({
    where: {
      fecha,
      activo: true,
      OR: [{ sucursalId: null }, { sucursalId: empleado.sucursalId }],
    },
    select: { id: true },
  });

  return { ok: true, recargo: !!feriado };
}

export async function registrarMarcaje(
  datos: DatosMarcaje,
  db: ClientePrisma = prisma
): Promise<ResultadoMarcaje> {
  const {
    empleadoId,
    fecha,
    horaEntrada,
    horaSalida,
    esAusencia,
    esDiaLibre,
    observacion,
    fuente = "MANUAL",
    jornadaHoras,
    sobrescribirManual = true,
  } = datos;

  let horasNormales = 0;
  let horasExtra = 0;
  let extra: HorasExtraPorJornada = {};
  // Sin las dos marcas no hay lapso del que descontar nada.
  const minutosDescanso = horaEntrada && horaSalida ? Math.max(datos.minutosDescanso ?? 0, 0) : 0;

  if (horaEntrada && horaSalida) {
    // Salida anterior o igual a la entrada: dato imposible. Antes producía horas
    // NEGATIVAS que se propagaban al cálculo de planilla.
    if (horaSalida.getTime() <= horaEntrada.getTime()) {
      return { ok: false, error: "La hora de salida debe ser posterior a la de entrada", status: 400 };
    }

    const lapsoMin = (horaSalida.getTime() - horaEntrada.getTime()) / 60_000;
    if (minutosDescanso >= lapsoMin) {
      return { ok: false, error: "El descanso no puede ser igual o mayor que la jornada", status: 400 };
    }

    const recargo = await esDiaConRecargo(db, empleadoId, fecha);
    if (!recargo.ok) return recargo;

    const jornada = repartirJornada({
      horaEntrada,
      horaSalida,
      jornadaHoras,
      esFeriado: recargo.recargo || !!esDiaLibre,
      minutosDescanso,
    });

    horasNormales = jornada.horasNormales;
    horasExtra = jornada.totalExtra;
    extra = jornada.extra;
  } else {
    // Sin las dos marcas no hay jornada que repartir, pero el empleado debe
    // existir igualmente: si no, el upsert falla con un error de clave foránea
    // que no dice nada útil.
    const existe = await db.empleado.count({ where: { id: empleadoId } });
    if (existe === 0) return { ok: false, error: "Empleado no encontrado", status: 404 };
  }

  // El desglose por jornada es lo que permite aplicar el recargo correcto de
  // cada tramo (Art. 330). `horasExtra` se conserva como total agregado.
  const horasPorJornada = {
    horasExtraDiurna: extra.diurnas ?? 0,
    horasExtraMixta: extra.mixtas ?? 0,
    horasExtraNocturna: extra.nocturnas ?? 0,
    horasFeriado: extra.feriado ?? 0,
  };

  const existente = await db.marcaje.findUnique({
    where: { empleadoId_fecha: { empleadoId, fecha } },
  });

  if (existente && !sobrescribirManual && existente.fuente === "MANUAL") {
    return {
      ok: true,
      marcaje: existente,
      omitido: true,
      motivo: "El día tiene una corrección manual y no se sobrescribe.",
    };
  }

  const comun = {
    horaEntrada: horaEntrada ?? null,
    horaSalida: horaSalida ?? null,
    horasNormales,
    horasExtra,
    ...horasPorJornada,
    minutosDescanso,
    esAusencia: esAusencia ?? false,
    esDiaLibre: esDiaLibre ?? false,
    observacion: observacion ?? null,
    // `fuente` TAMBIÉN se actualiza, no sólo se fija al crear.
    //
    // Cuando no lo hacía, una corrección manual sobre un día que había llegado
    // del reloj dejaba la fila etiquetada BIOMETRICO. Y como la protección de
    // abajo mira precisamente esa etiqueta, no se disparaba nunca en el único
    // caso para el que existe: la siguiente sincronización deshacía la
    // corrección del supervisor en silencio. Quien escribe el marcaje es quien
    // pone su nombre en él.
    fuente,
  } satisfies Prisma.MarcajeUncheckedUpdateInput;

  const marcaje = await db.marcaje.upsert({
    where: { empleadoId_fecha: { empleadoId, fecha } },
    create: { ...comun, empleadoId, fecha },
    update: comun,
  });

  return { ok: true, marcaje };
}
