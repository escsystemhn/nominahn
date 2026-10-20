import { NextRequest, NextResponse } from "next/server";
import { requerirSesion, puede } from "@/lib/auth/guard";
import type { Permiso } from "@/lib/auth/permisos";
import { prisma } from "@/lib/prisma";
import { audit, getClientInfo } from "@/lib/audit";
import { calcularBonoEvaluacion, marcarBonoAplicado } from "@/lib/evaluaciones/bonus-engine";
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
  if (!evaluacion) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

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

  // Al finalizar: consolidar calificación, calcular bono, registrar fecha de firma
  const extraData: Record<string, unknown> = {};
  if (nuevoEstado === "FINALIZADA") {
    // Calcular promedio ponderado de participantes completados
    const participantes = await prisma.evaluacionParticipante.findMany({
      where: { evaluacionId: id, estado: "COMPLETADO", calificacion: { not: null } },
    });

    if (participantes.length > 0) {
      const suma = participantes.reduce((acc, p) => acc + Number(p.calificacion), 0);
      extraData.calificacion = suma / participantes.length;
    }

    extraData.fechaFirma = new Date();

    // Motor de bono
    const bono = await calcularBonoEvaluacion(
      evaluacion.empleadoId,
      evaluacion.tipo
    );
    if (bono) {
      extraData.bonoPorcentaje = bono.bonoPorcentaje;
      extraData.bonoMonto = bono.bonoMonto;
    }
  }

  const updated = await prisma.evaluacion.update({
    where: { id },
    data: { estado: nuevoEstado, ...extraData },
  });

  // Si finalizó con bono, marcarlo aplicado
  if (nuevoEstado === "FINALIZADA" && extraData.bonoMonto) {
    const bono = await calcularBonoEvaluacion(evaluacion.empleadoId, evaluacion.tipo);
    if (bono) await marcarBonoAplicado(bono.evaluacionId, bono.bonoMonto, bono.bonoPorcentaje);
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "APPROVE",
    tabla: "Evaluacion",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { estado: estadoActual },
    valorNuevo: { estado: nuevoEstado },
    ip,
    userAgent,
  });

  return NextResponse.json(updated);
}
