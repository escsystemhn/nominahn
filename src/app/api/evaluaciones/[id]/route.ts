import { NextRequest, NextResponse } from "next/server";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { parsearBody, zPorcentaje } from "@/lib/http/validar";

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
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { error: "Sin cambios" });

export async function GET(_req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;

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
        include: {
          evaluador: { select: { id: true, primerNombre: true, primerApellido: true } },
          criteriosParticipante: { include: { competencia: { select: { id: true, nombre: true } } } },
        },
      },
      criterios: { include: { competencia: { select: { id: true, nombre: true } } } },
      campana: true,
    },
  });

  if (!evaluacion) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Sin permiso para consultar evaluaciones, sólo se ve la propia.
  if (
    !puede(g.usuario, "talento.evaluaciones_ver") &&
    evaluacion.empleadoId !== g.usuario.empleadoId
  ) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  return NextResponse.json(evaluacion);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schemaPatch);
  if (!parsed.ok) return parsed.response;
  const { comentarios, fortalezas, mejoras, objetivos, desempeno, potencial, calificacion } = parsed.data;

  const actual = await prisma.evaluacion.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (actual.estado === "FINALIZADA" || actual.estado === "CANCELADA") {
    return NextResponse.json({ error: "Evaluación no editable en estado " + actual.estado }, { status: 422 });
  }

  const updated = await prisma.evaluacion.update({
    where: { id },
    data: {
      ...(comentarios !== undefined ? { comentarios } : {}),
      ...(fortalezas !== undefined ? { fortalezas } : {}),
      ...(mejoras !== undefined ? { mejoras } : {}),
      ...(objetivos !== undefined ? { objetivos } : {}),
      ...(desempeno !== undefined ? { desempeno } : {}),
      ...(potencial !== undefined ? { potencial } : {}),
      ...(calificacion !== undefined ? { calificacion } : {}),
    },
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
