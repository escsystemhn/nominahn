import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { registrarMarcaje } from "@/lib/asistencia/registrar-marcaje";
import { turnoDe } from "@/lib/asistencia/turnos";
import { resolverDescanso } from "@/lib/asistencia/descanso";
import { z } from "zod";
import { parsearBody, zId, zFecha, zEnteroNoNeg } from "@/lib/http/validar";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("asistencia.ver");
  if (!g.ok) return g.response;

  const { searchParams } = new URL(req.url);
  const fecha = searchParams.get("fecha");
  const empleadoId = searchParams.get("empleadoId");
  const sucursalId = searchParams.get("sucursalId");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  const where: Prisma.MarcajeWhereInput = {};
  if (empleadoId) where.empleadoId = empleadoId;
  if (fecha) where.fecha = new Date(fecha);
  if (desde && hasta) {
    where.fecha = { gte: new Date(desde), lte: new Date(hasta) };
  }
  if (sucursalId) {
    where.empleado = { sucursalId };
  }

  const marcajes = await prisma.marcaje.findMany({
    where,
    include: {
      empleado: {
        select: {
          id: true,
          codigo: true,
          primerNombre: true,
          primerApellido: true,
          sucursal: { select: { nombre: true } },
        },
      },
    },
    orderBy: [{ fecha: "desc" }, { empleado: { primerApellido: "asc" } }],
  });

  return NextResponse.json(marcajes);
}

const schema = z.object({
  empleadoId: zId,
  fecha: zFecha,
  horaEntrada: zFecha.optional(),
  horaSalida: zFecha.optional(),
  esAusencia: z.boolean().optional(),
  /** Día de descanso semanal: si se trabaja, la jornada lleva recargo (Art. 339). */
  esDiaLibre: z.boolean().optional(),
  observacion: z.string().trim().max(500).optional(),
  fuente: z.enum(["BIOMETRICO", "MANUAL"]).optional(),
  /**
   * Almuerzo a descontar, si quien registra lo sabe. Si no viene, se aplica el
   * del turno: el almuerzo nunca es tiempo de trabajo.
   */
  minutosDescanso: zEnteroNoNeg.optional(),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { empleadoId, fecha, horaEntrada, minutosDescanso } = parsed.data;
  let { horaSalida } = parsed.data;

  const turno = await turnoDe(empleadoId, fecha);

  // Turno nocturno: quien teclea entrada 22:00 y salida 06:00 sobre la misma
  // fecha quiere decir las 06:00 del día siguiente. Sólo con un turno que cruza
  // la medianoche: en un turno de día, una salida anterior a la entrada es un
  // error de tecleo y debe rechazarse.
  if (horaEntrada && horaSalida && turno.cruzaMedianoche && horaSalida.getTime() <= horaEntrada.getTime()) {
    horaSalida = new Date(horaSalida.getTime() + 86_400_000);
  }

  // Quien teclea 07:00 a 16:00 espera 8 horas, no 9: sin indicar almuerzo, se
  // descuenta el fijo del turno, igual que cuando el reloj no lo registra.
  const descanso =
    minutosDescanso !== undefined
      ? minutosDescanso
      : horaEntrada && horaSalida
        ? resolverDescanso({ entrada: horaEntrada, salida: horaSalida, regla: turno.descanso }).minutos
        : 0;

  // El reparto de jornada vive en lib/asistencia/registrar-marcaje.ts porque la
  // ingesta del reloj biométrico llama exactamente al mismo sitio. Ver el
  // encabezado de ese módulo.
  const resultado = await registrarMarcaje({
    ...parsed.data,
    horaSalida,
    jornadaHoras: turno.jornadaHoras,
    minutosDescanso: descanso,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }

  return NextResponse.json(resultado.marcaje, { status: 201 });
}
