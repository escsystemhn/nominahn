import { NextRequest, NextResponse } from "next/server";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { alcanzaEmpleado, filtroEmpleados, alcanceEsTotal } from "@/lib/auth/alcance";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const submitSchema = z.object({
  participanteId: z.string(),
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

/** GET /api/evaluaciones/[id]/participantes — lista los participantes */
export async function GET(_req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

  /**
   * Una evaluación que no existe da una lista vacía, y eso mismo da una fuera de su
   * alcance. Quien evalúa sigue viendo su propia fila, con la que envía el formulario;
   * en la propia evaluación se ve a todos, y en una ajena, a los evaluadores de su alcance.
   */
  const yo = g.usuario.empleadoId;
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id }, select: { empleadoId: true } });
  const esPropia = !!yo && evaluacion?.empleadoId === yo;
  // Sin permiso de consultar evaluaciones sólo queda la propia: una cuenta sin perfil tiene alcance total.
  const alcanzada = !!evaluacion && puede(g.usuario, "talento.evaluaciones_ver") && (await empleadoAlAlcance(g.usuario, evaluacion.empleadoId));
  const miFila = yo ? [{ evaluadorId: yo }] : [];
  // Con alcance total no se acota: un filtro vacío dentro de un OR no significa «todos».
  const visibles = esPropia || (alcanzada && alcanceEsTotal(g.usuario))
    ? {}
    : { OR: alcanzada ? [{ evaluador: filtroEmpleados(g.usuario) }, ...miFila] : miFila };

  const participantes = await prisma.evaluacionParticipante.findMany({
    where: { evaluacionId: id, ...visibles },
    // El token es el enlace para calificar: quien lo tiene, califica en nombre de ese evaluador.
    omit: { tokenAcceso: true },
    include: {
      evaluador: { select: { id: true, primerNombre: true, primerApellido: true, fotoPerfil: true } },
      criteriosParticipante: { include: { competencia: { select: { id: true, nombre: true } } } },
    },
    orderBy: { rol: "asc" },
  });

  return NextResponse.json(participantes);
}

/** POST /api/evaluaciones/[id]/participantes — enviar formulario de un participante */
export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;
  const body = await req.json();
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { participanteId, calificacion, comentarios, criterios } = parsed.data;

  const participante = await prisma.evaluacionParticipante.findFirst({
    where: { id: participanteId, evaluacionId: id },
    include: {
      evaluador: { select: { id: true, sucursalId: true, departamentoId: true } },
      evaluacion: { select: { empleado: { select: { id: true, sucursalId: true, departamentoId: true } } } },
    },
  });
  if (!participante) return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });

  // Su propio formulario lo envía siempre. En nombre de otro, sólo si alcanza al evaluado
  // y a ese evaluador: lo demás responde igual que si el participante no existiera.
  const esSuFormulario = !!g.usuario.empleadoId && participante.evaluadorId === g.usuario.empleadoId;
  if (!esSuFormulario && !(alcanzaEmpleado(g.usuario, participante.evaluacion.empleado) && alcanzaEmpleado(g.usuario, participante.evaluador))) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  if (participante.estado === "COMPLETADO") {
    return NextResponse.json({ error: "Ya fue completada por este evaluador" }, { status: 409 });
  }

  /**
   * Quien envía la evaluación tiene que ser el evaluador asignado. Quien
   * administra el proceso puede hacerlo en su lugar —para desatascar una
   * campaña—, y eso queda en la auditoría.
   */
  if (
    !puede(g.usuario, "talento.evaluaciones_cerrar") &&
    participante.evaluadorId !== g.usuario.empleadoId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.evaluacionParticipante.update({
      where: { id: participanteId },
      data: {
        calificacion,
        comentarios,
        estado: "COMPLETADO",
        fechaCompletado: new Date(),
      },
    });

    if (criterios.length > 0) {
      await tx.criterioEvaluacion.createMany({
        data: criterios.map((c) => ({
          evaluacionId: id,
          participanteId,
          competenciaId: c.competenciaId,
          criterio: c.criterio,
          calificacion: c.calificacion,
          peso: c.peso,
          comentario: c.comentario,
        })),
      });
    }

    // Verificar si todos los participantes completaron → pasar a PENDIENTE_FIRMA automáticamente
    const pendientes = await tx.evaluacionParticipante.count({
      where: { evaluacionId: id, estado: { not: "COMPLETADO" } },
    });

    if (pendientes === 0) {
      await tx.evaluacion.update({
        where: { id },
        data: { estado: "PENDIENTE_FIRMA" },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
