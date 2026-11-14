import { NextRequest, NextResponse } from "next/server";
import { requerirSesion, puede } from "@/lib/auth/guard";
import type { Permiso } from "@/lib/auth/permisos";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { prisma } from "@/lib/prisma";
import { audit, getClientInfo } from "@/lib/audit";
import { bonoParaCalificacion } from "@/lib/evaluaciones/bonus-engine";
import { calificacionPonderada, consolidarCriterios, consolidarParticipantes } from "@/lib/evaluaciones/calificacion";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";
import { EstadoEvaluacion as EstadoEvaluacionEnum } from "@prisma/client";

type EstadoEvaluacion = "BORRADOR" | "EN_PROGRESO" | "PENDIENTE_FIRMA" | "FINALIZADA" | "CANCELADA";

const schema = z.object({ nuevoEstado: z.enum(EstadoEvaluacionEnum) });

// Transiciones permitidas por estado actual
const TRANSICIONES: Record<EstadoEvaluacion, EstadoEvaluacion[]> = {
  BORRADOR: ["EN_PROGRESO", "CANCELADA"],
  EN_PROGRESO: ["PENDIENTE_FIRMA", "CANCELADA"],
  PENDIENTE_FIRMA: ["FINALIZADA", "EN_PROGRESO"],
  FINALIZADA: [],
  CANCELADA: [],
};

/**
 * Permiso exigido por cada transición.
 *
 * Lanzar y avanzar una evaluación es tarea del jefe directo, así que basta con
 * poder gestionar evaluaciones. CERRARLA o CANCELARLA fija la calificación —de
 * la que cuelga el bono— y por eso queda reservado a quien administra el
 * proceso: es el mismo reparto que hacía la matriz de roles anterior.
 */
const PERMISOS_TRANSICION: Record<string, string> = {
  BORRADOR_EN_PROGRESO: "talento.evaluaciones_gestionar",
  EN_PROGRESO_PENDIENTE_FIRMA: "talento.evaluaciones_gestionar",
  PENDIENTE_FIRMA_FINALIZADA: "talento.evaluaciones_cerrar",
  PENDIENTE_FIRMA_EN_PROGRESO: "talento.evaluaciones_cerrar",
  BORRADOR_CANCELADA: "talento.evaluaciones_cerrar",
  EN_PROGRESO_CANCELADA: "talento.evaluaciones_cerrar",
};

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const nuevoEstado = parsed.data.nuevoEstado as EstadoEvaluacion;

  const evaluacion = await prisma.evaluacion.findUnique({ where: { id } });
  // Fuera de su alcance responde igual que si no existiera (ver alcanzaEmpleado).
  if (!evaluacion || !(await empleadoAlAlcance(g.usuario, evaluacion.empleadoId))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const estadoActual = evaluacion.estado as EstadoEvaluacion;

  if (!TRANSICIONES[estadoActual]?.includes(nuevoEstado)) {
    return NextResponse.json(
      { error: `Transición ${estadoActual} → ${nuevoEstado} no permitida` },
      { status: 422 }
    );
  }

  const clave = `${estadoActual}_${nuevoEstado}`;
  const requerido = PERMISOS_TRANSICION[clave];
  // Una transición sin permiso declarado no se ejecuta: el hueco debe cerrar el
  // paso, no abrirlo.
  if (!requerido || !puede(g.usuario, requerido as Permiso)) {
    return NextResponse.json({ error: "Sin permisos para esta transición" }, { status: 403 });
  }

  // Al finalizar: consolidar la calificación, dejar a la vista el bono y la fecha de firma.
  const extraData: Record<string, unknown> = {};
  let consolidados: ReturnType<typeof consolidarCriterios> | null = null;
  if (nuevoEstado === "FINALIZADA") {
    const participantes = await prisma.evaluacionParticipante.findMany({
      where: { evaluacionId: id, estado: "COMPLETADO" },
      select: {
        calificacion: true,
        criteriosParticipante: { select: { competenciaId: true, criterio: true, calificacion: true, peso: true } },
      },
    });

    let nota: number | null;
    if (participantes.length > 0) {
      // 360°: cada evaluador vale lo mismo, y cada uno por sus aspectos ponderados.
      const filas = participantes.map((p) => ({
        calificacion: p.calificacion === null ? null : Number(p.calificacion),
        criterios: p.criteriosParticipante.map((c) => ({
          competenciaId: c.competenciaId,
          criterio: c.criterio,
          calificacion: Number(c.calificacion),
          peso: Number(c.peso),
        })),
      }));
      nota = consolidarParticipantes(filas);
      consolidados = consolidarCriterios(filas.flatMap((f) => f.criterios));
    } else {
      // Directa: la nota de sus aspectos (lo que ya se guardó al calificarlos).
      const criterios = await prisma.criterioEvaluacion.findMany({
        where: { evaluacionId: id, participanteId: null },
        select: { calificacion: true, peso: true },
      });
      nota = calificacionPonderada(criterios.map((c) => ({ calificacion: Number(c.calificacion), peso: Number(c.peso) })));
    }

    // Antes una evaluación sin respuestas se cerraba con 0 y así quedaba para siempre.
    if (nota === null) {
      return NextResponse.json({ error: "La evaluación no tiene calificaciones: califique sus aspectos antes de finalizarla." }, { status: 422 });
    }

    extraData.calificacion = nota;
    if (evaluacion.desempeno === null) extraData.desempeno = nota;
    extraData.fechaFirma = new Date();

    // El bono queda a la vista, pero NO se marca aplicado: lo marca la planilla que lo
    // paga (calculo-planilla-bd.ts). Antes se marcaba aquí y la planilla nunca lo pagaba.
    const bono = await bonoParaCalificacion(evaluacion.empleadoId, evaluacion.tipo, nota);
    extraData.bonoPorcentaje = bono?.bonoPorcentaje ?? null;
    extraData.bonoMonto = bono?.bonoMonto ?? null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (consolidados && consolidados.length > 0) {
      await tx.criterioEvaluacion.deleteMany({ where: { evaluacionId: id, participanteId: null } });
      await tx.criterioEvaluacion.createMany({
        data: consolidados.map((c) => ({
          evaluacionId: id,
          participanteId: null,
          competenciaId: c.competenciaId,
          criterio: c.criterio,
          calificacion: c.calificacion as number,
          peso: c.peso,
        })),
      });
    }
    return tx.evaluacion.update({ where: { id }, data: { estado: nuevoEstado, ...extraData } });
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "APPROVE",
    tabla: "Evaluacion",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { estado: estadoActual },
    valorNuevo: { estado: nuevoEstado, ...(nuevoEstado === "FINALIZADA" ? { calificacion: extraData.calificacion } : {}) },
    ip,
    userAgent,
  });

  return NextResponse.json(updated);
}
