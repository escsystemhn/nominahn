import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroPorEmpleado } from "@/lib/auth/alcance";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { registrarJornadaManual } from "@/lib/asistencia/registrar-jornada";
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
    where: { AND: [where, filtroPorEmpleado(g.usuario)] },
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
  const { empleadoId } = parsed.data;

  // Fuera de su alcance responde igual que si no existiera.
  if (!(await empleadoAlAlcance(g.usuario, empleadoId))) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  // Turno del día, salida que cruza la medianoche, almuerzo y reparto de horas: en
  // lib/asistencia/registrar-jornada.ts, el mismo camino que la carga rápida en lote.
  const resultado = await registrarJornadaManual(parsed.data);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }

  return NextResponse.json(resultado.marcaje, { status: 201 });
}
