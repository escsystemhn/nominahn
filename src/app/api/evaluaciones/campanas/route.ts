import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";

const crearCampanaSchema = z.object({
  nombre: z.string().min(1),
  tipo: z.enum(["DESEMPENO_MENSUAL", "COMPETENCIA_TRIMESTRAL"]),
  periodo: z.string().min(1),
  fechaInicio: z.string(),
  fechaFin: z.string(),
  cronExpression: z.string().optional(),
  incluirAuto: z.boolean().default(true),
  incluirJefe: z.boolean().default(true),
  incluirPares: z.boolean().default(false),
  incluirSubord: z.boolean().default(false),
  sucursalId: z.string().optional(),
  departamentoId: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const campanas = await prisma.evaluacionCampana.findMany({
    include: {
      _count: { select: { evaluaciones: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(campanas);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.evaluaciones_gestionar");
  if (!g.ok) return g.response;

  const body = await req.json();
  const parsed = crearCampanaSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const d = parsed.data;

  const campana = await prisma.evaluacionCampana.create({
    data: {
      nombre: d.nombre,
      tipo: d.tipo,
      periodo: d.periodo,
      fechaInicio: new Date(d.fechaInicio),
      fechaFin: new Date(d.fechaFin),
      cronExpression: d.cronExpression,
      incluirAuto: d.incluirAuto,
      incluirJefe: d.incluirJefe,
      incluirPares: d.incluirPares,
      incluirSubord: d.incluirSubord,
      sucursalId: d.sucursalId,
      departamentoId: d.departamentoId,
      createdBy: g.usuario.id ?? "",
      estado: "PROGRAMADA",
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "EvaluacionCampana",
    registroId: campana.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: campana,
    ip,
    userAgent,
  });

  return NextResponse.json(campana, { status: 201 });
}
