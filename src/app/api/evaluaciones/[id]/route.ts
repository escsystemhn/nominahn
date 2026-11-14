import { NextRequest, NextResponse } from "next/server";
import { requerirSesion, puede, requerirPermiso } from "@/lib/auth/guard";
import { filtroEmpleados } from "@/lib/auth/alcance";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { prisma } from "@/lib/prisma";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { parsearBody, zPorcentaje } from "@/lib/http/validar";
import { estadoDirecta, guardarCriteriosConsolidados, zCriterioDirecto } from "@/lib/evaluaciones/consolidado";
import type { EstadoEvaluacion } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

// Los tres puntajes son Decimal(5,2) en escala 0–100 (nine-box). zPorcentaje
// rechaza vacío/NaN/fuera de rango, que antes se escribía tal cual.
const texto = z.string().trim().max(5000).optional();
const schemaPatch = z
  .object({
    comentarios: texto,
    fortalezas: texto,
    mejoras: texto,
    objetivos: texto,
    desempeno: zPorcentaje.optional(),
    potencial: zPorcentaje.optional(),
    calificacion: zPorcentaje.optional(),
    // Calificar o corregir los aspectos de una evaluación directa: recalcula la nota.
    criterios: z.array(zCriterioDirecto).min(1).max(60).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { error: "Sin cambios" });

export async function GET(_req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

  // Una evaluación pertenece a la persona evaluada: fuera de su alcance responde igual que
  // si no existiera, aunque alguno de los evaluadores sea de su sucursal. La propia no se acota.
  const dueno = await prisma.evaluacion.findUnique({ where: { id }, select: { empleadoId: true } });
  if (!dueno) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const esPropia = !!g.usuario.empleadoId && dueno.empleadoId === g.usuario.empleadoId;
  if (!esPropia && !(await empleadoAlAlcance(g.usuario, dueno.empleadoId))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Sin permiso para consultar evaluaciones, sólo se ve la propia.
  if (!puede(g.usuario, "talento.evaluaciones_ver") && !esPropia) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  // De una ajena se ve sólo a los evaluadores de su alcance, y sólo lo que calificaron.
  const evaluador = esPropia ? {} : filtroEmpleados(g.usuario);

  const evaluacion = await prisma.evaluacion.findUnique({
    where: { id },
    include: {
      empleado: {
        select: {
          id: true, codigo: true, primerNombre: true, primerApellido: true,
          salarioBase: true, puesto: { select: { id: true, nombre: true } },
        },
      },
      participantes: {
        // El token es el enlace para calificar: quien lo tiene, califica en nombre de ese evaluador.
        omit: { tokenAcceso: true },
        where: { evaluador },
        include: {
          evaluador: { select: { id: true, primerNombre: true, primerApellido: true } },
          criteriosParticipante: { include: { competencia: { select: { id: true, nombre: true } } } },
        },
      },
      criterios: {
        where: { OR: [{ participanteId: null }, { participante: { evaluador } }] },
        include: { competencia: { select: { id: true, nombre: true } } },
      },
      campana: true,
    },
  });

  if (!evaluacion) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  return NextResponse.json(evaluacion);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  // Cambia la calificación, y de ella sale el bono: bastaba con tener sesión.
  const g = await requerirPermiso("talento.evaluaciones_gestionar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schemaPatch);
  if (!parsed.ok) return parsed.response;
  const { comentarios, fortalezas, mejoras, objetivos, desempeno, potencial, calificacion, criterios } = parsed.data;

  const actual = await prisma.evaluacion.findUnique({ where: { id } });
  // Fuera de su alcance responde igual que si no existiera (ver alcanzaEmpleado).
  if (!actual || !(await empleadoAlAlcance(g.usuario, actual.empleadoId))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  if (actual.estado === "FINALIZADA" || actual.estado === "CANCELADA") {
    return NextResponse.json({ error: "Evaluación no editable en estado " + actual.estado }, { status: 422 });
  }

  // En una 360° las notas las dan sus evaluadores; corregirlas aquí las pisaría al finalizar.
  if (criterios) {
    const evaluadores = await prisma.evaluacionParticipante.count({ where: { evaluacionId: id } });
    if (evaluadores > 0) {
      return NextResponse.json({ error: "Esta evaluación la califican sus evaluadores por su enlace: no se corrige aquí." }, { status: 422 });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    let porCriterios: { calificacion?: number; desempeno?: number; estado?: EstadoEvaluacion } = {};
    if (criterios) {
      const nota = await guardarCriteriosConsolidados(tx, id, criterios);
      porCriterios = {
        calificacion: nota ?? 0,
        // El eje de desempeño del nine-box sigue a la nota, salvo que se fije a mano.
        ...(desempeno === undefined && nota !== null ? { desempeno: nota } : {}),
        estado: estadoDirecta(criterios),
      };
    }
    return tx.evaluacion.update({
      where: { id },
      data: {
        ...(comentarios !== undefined ? { comentarios } : {}),
        ...(fortalezas !== undefined ? { fortalezas } : {}),
        ...(mejoras !== undefined ? { mejoras } : {}),
        ...(objetivos !== undefined ? { objetivos } : {}),
        ...(desempeno !== undefined ? { desempeno } : {}),
        ...(potencial !== undefined ? { potencial } : {}),
        // Con aspectos, la nota sale de ellos; una nota a mano sólo vale sin aspectos.
        ...(calificacion !== undefined && !criterios ? { calificacion } : {}),
        ...porCriterios,
      },
    });
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Evaluacion",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: actual,
    valorNuevo: updated,
    ip,
    userAgent,
  });

  return NextResponse.json(updated);
}
