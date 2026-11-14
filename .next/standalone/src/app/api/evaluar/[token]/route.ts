import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aspectosDeEmpleado } from "@/lib/evaluaciones/aspectos-bd";
import { ESTADOS_CALIFICABLES, registrarRespuesta, SinCalificacion, zRespuestaParticipante } from "@/lib/evaluaciones/respuesta";

type Params = { params: Promise<{ token: string }> };

/** GET /api/evaluar/[token] — obtiene la evaluación por token (sin login) */
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;

  const participante = await prisma.evaluacionParticipante.findUnique({
    where: { tokenAcceso: token },
    include: {
      evaluacion: {
        include: {
          empleado: { select: { primerNombre: true, primerApellido: true, puesto: { select: { nombre: true } } } },
          criterios: { where: { participanteId: null }, include: { competencia: true } },
          campana: { select: { nombre: true, tipo: true } },
        },
      },
      evaluador: { select: { primerNombre: true, primerApellido: true } },
      criteriosParticipante: true,
    },
  });

  if (!participante) return NextResponse.json({ error: "Enlace inválido o expirado" }, { status: 404 });
  if (participante.estado === "COMPLETADO") {
    return NextResponse.json({ error: "Esta evaluación ya fue completada", completada: true }, { status: 409 });
  }
  if (!(ESTADOS_CALIFICABLES as readonly string[]).includes(participante.evaluacion.estado)) {
    return NextResponse.json({ error: "La evaluación ya no está disponible" }, { status: 410 });
  }

  // Los mismos aspectos que ve RRHH: los del puesto, o los generales, o la lista base.
  // Antes devolvía las filas de PuestoCompetencia anidadas y con el peso como texto, y la
  // página las leía planas: con competencias en el puesto, el envío fallaba con 400.
  const { origen, aspectos } = await aspectosDeEmpleado(prisma, participante.evaluacion.empleadoId, participante.evaluacion.tipo);

  return NextResponse.json({
    participante: {
      id: participante.id,
      rol: participante.rol,
      evaluador: participante.evaluador,
    },
    evaluacion: {
      id: participante.evaluacion.id,
      tipo: participante.evaluacion.tipo,
      periodo: participante.evaluacion.periodo,
      empleado: participante.evaluacion.empleado,
      campana: participante.evaluacion.campana,
    },
    origen,
    aspectos,
  });
}

/** POST /api/evaluar/[token] — envía calificaciones por token (sin login) */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;

  const participante = await prisma.evaluacionParticipante.findUnique({
    where: { tokenAcceso: token },
    select: { id: true, evaluacionId: true, estado: true, evaluacion: { select: { estado: true } } },
  });

  if (!participante) return NextResponse.json({ error: "Enlace inválido" }, { status: 404 });
  if (participante.estado === "COMPLETADO") return NextResponse.json({ error: "Ya completada" }, { status: 409 });
  if (!(ESTADOS_CALIFICABLES as readonly string[]).includes(participante.evaluacion.estado)) {
    return NextResponse.json({ error: "Evaluación no disponible" }, { status: 410 });
  }

  const body = await req.json().catch(() => null);
  const parsed = zRespuestaParticipante.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    await prisma.$transaction((tx) => registrarRespuesta(tx, participante.evaluacionId, participante.id, parsed.data));
  } catch (e) {
    if (e instanceof SinCalificacion) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  return NextResponse.json({ ok: true, mensaje: "Evaluación enviada correctamente" });
}
