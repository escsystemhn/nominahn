import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { zCompetencia } from "@/lib/evaluaciones/competencias";

export async function GET() {
  // El catálogo lo consultan quien lo administra y quien evalúa (antes no tenía guardia).
  const g = await requerirPermiso(["talento.competencias", "talento.evaluaciones_gestionar", "talento.evaluaciones_ver"]);
  if (!g.ok) return g.response;

  const competencias = await prisma.competenciaDefinicion.findMany({
    where: { activa: true },
    include: { _count: { select: { puestosCompetencia: { where: { activa: true } } } } },
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json(competencias);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("talento.competencias");
  if (!g.ok) return g.response;

  const parsed = zCompetencia.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const comp = await prisma.competenciaDefinicion.create({ data: parsed.data });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "CREATE", tabla: "CompetenciaDefinicion", registroId: comp.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: comp, ip, userAgent });
  return NextResponse.json(comp, { status: 201 });
}
