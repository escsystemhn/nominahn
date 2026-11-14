import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const asignarSchema = z.object({
  competenciaId: z.string(),
  nivelRequerido: z.enum(["INICIAL", "BASICO", "INTERMEDIO", "AVANZADO", "EXPERTO"]),
  peso: z.coerce.number().min(0.1).max(10).default(1),
  /**
   * Los puestos se copian entre sucursales y departamentos con el mismo nombre
   * («Cajero» de San Pedro Sula y de Choloma son puestos distintos): con esto el
   * aspecto se asigna de una vez a todos los puestos activos que se llaman igual.
   */
  mismoNombre: z.boolean().default(false),
});

export async function GET(_req: NextRequest, { params }: Params) {
  // Antes no tenía guardia: cualquiera, aun sin sesión, leía la matriz del puesto.
  const g = await requerirPermiso(["talento.competencias", "talento.evaluaciones_gestionar", "talento.evaluaciones_ver"]);
  if (!g.ok) return g.response;

  const { id: puestoId } = await params;
  const competencias = await prisma.puestoCompetencia.findMany({
    where: { puestoId, activa: true },
    include: { competencia: true },
    orderBy: { peso: "desc" },
  });
  return NextResponse.json(competencias);
}

export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const { id: puestoId } = await params;
  const parsed = asignarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { competenciaId, nivelRequerido, peso, mismoNombre } = parsed.data;

  const puesto = await prisma.puesto.findUnique({ where: { id: puestoId }, select: { nombre: true } });
  if (!puesto) return NextResponse.json({ error: "Puesto no encontrado" }, { status: 404 });
  const competencia = await prisma.competenciaDefinicion.findFirst({ where: { id: competenciaId, activa: true }, select: { id: true } });
  if (!competencia) return NextResponse.json({ error: "Aspecto no encontrado" }, { status: 404 });

  const puestosIds = mismoNombre
    ? (await prisma.puesto.findMany({ where: { activo: true, nombre: { equals: puesto.nombre, mode: "insensitive" } }, select: { id: true } })).map((p) => p.id)
    : [puestoId];
  if (!puestosIds.includes(puestoId)) puestosIds.push(puestoId);

  await prisma.$transaction(
    puestosIds.map((pid) =>
      prisma.puestoCompetencia.upsert({
        where: { puestoId_competenciaId: { puestoId: pid, competenciaId } },
        update: { nivelRequerido, peso, activa: true },
        create: { puestoId: pid, competenciaId, nivelRequerido, peso },
      })
    )
  );

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "PuestoCompetencia",
    registroId: puestoId,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { competenciaId, nivelRequerido, peso, puestos: puestosIds.length },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true, puestos: puestosIds.length }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const { id: puestoId } = await params;
  const { searchParams } = new URL(req.url);
  const competenciaId = searchParams.get("competenciaId");

  if (!competenciaId) return NextResponse.json({ error: "competenciaId requerido" }, { status: 400 });

  await prisma.puestoCompetencia.updateMany({
    where: { puestoId, competenciaId },
    data: { activa: false },
  });

  return NextResponse.json({ ok: true });
}
