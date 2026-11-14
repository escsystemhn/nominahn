import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { zCompetenciaCambios } from "@/lib/evaluaciones/competencias";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/competencias/[id] — editar un aspecto del catálogo o desactivarlo
 * (`activa: false`). No se borra: las evaluaciones ya hechas lo siguen nombrando.
 * Un cambio de peso aquí afecta al aspecto como GENERAL; en cada puesto manda su peso.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = zCompetenciaCambios.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const actual = await prisma.competenciaDefinicion.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const updated = await prisma.competenciaDefinicion.update({ where: { id }, data: parsed.data });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "CompetenciaDefinicion",
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
