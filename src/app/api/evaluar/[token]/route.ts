import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

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
  if (!["BORRADOR", "EN_PROGRESO"].includes(participante.evaluacion.estado)) {
    return NextResponse.json({ error: "La evaluación ya no está disponible" }, { status: 410 });
  }

  // Obtener competencias requeridas del puesto del evaluado
  const puestoId = await prisma.empleado
    .findUnique({ where: { id: participante.evaluacion.empleadoId }, select: { puestoId: true } })
    .then((e) => e?.puestoId);

  const competenciasRequeridas = puestoId
    ? await prisma.puestoCompetencia.findMany({
        where: { puestoId, activa: true },
        include: { competencia: true },
        orderBy: { peso: "desc" },
      })
    : [];

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
    competenciasRequeridas,
  });
}

const submitTokenSchema = z.object({
  calificacion: z.number().min(0).max(100),
  comentarios: z.string().optional(),
  criterios: z
    .array(
      z.object({
        criterio: z.string(),
        competenciaId: z.string().optional(),
        calificacion: z.number().min(0).max(100),
        peso: z.number().default(1),
        comentario: z.string().optional(),
      })
    )
    .default([]),
});

/** POST /api/evaluar/[token] — envía calificaciones por token (sin login) */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;

  const participante = await prisma.evaluacionParticipante.findUnique({
    where: { tokenAcceso: token },
    select: { id: true, evaluacionId: true, estado: true, evaluacion: { select: { estado: true } } },
  });

  if (!participante) return NextResponse.json({ error: "Enlace inválido" }, { status: 404 });
  if (participante.estado === "COMPLETADO") return NextResponse.json({ error: "Ya completada" }, { status: 409 });
  if (!["BORRADOR", "EN_PROGRESO"].includes(participante.evaluacion.estado)) {
    return NextResponse.json({ error: "Evaluación no disponible" }, { status: 410 });
  }

  const body = await req.json();
  const parsed = submitTokenSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { calificacion, comentarios, criterios } = parsed.data;
  const evalId = participante.evaluacionId;

  await prisma.$transaction(async (tx) => {
    await tx.evaluacionParticipante.update({
      where: { id: participante.id },
      data: { calificacion, comentarios, estado: "COMPLETADO", fechaCompletado: new Date() },
    });

    if (criterios.length > 0) {
      await tx.criterioEvaluacion.createMany({
        data: criterios.map((c) => ({
          evaluacionId: evalId,
          participanteId: participante.id,
          competenciaId: c.competenciaId,
          criterio: c.criterio,
          calificacion: c.calificacion,
          peso: c.peso,
          comentario: c.comentario,
        })),
      });
    }

    // Si todos completaron → PENDIENTE_FIRMA
    const pendientes = await tx.evaluacionParticipante.count({
      where: { evaluacionId: evalId, estado: { not: "COMPLETADO" } },
    });
    if (pendientes === 0) {
      await tx.evaluacion.update({ where: { id: evalId }, data: { estado: "PENDIENTE_FIRMA" } });
    } else {
      // Asegurar que está EN_PROGRESO
      await tx.evaluacion.updateMany({
        where: { id: evalId, estado: "BORRADOR" },
        data: { estado: "EN_PROGRESO" },
      });
    }
  });

  return NextResponse.json({ ok: true, mensaje: "Evaluación enviada correctamente" });
}
