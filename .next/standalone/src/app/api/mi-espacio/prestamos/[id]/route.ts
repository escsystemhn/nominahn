/** El empleado cancela una solicitud suya que sigue pendiente. */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({ accion: z.literal("cancelar") });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const s = await prisma.solicitudPrestamo.findUnique({ where: { id }, select: { empleadoId: true, estado: true } });
  if (!s || s.empleadoId !== g.usuario.empleadoId) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (s.estado !== "PENDIENTE") return NextResponse.json({ error: "Sólo se cancela una solicitud pendiente" }, { status: 409 });
  await prisma.solicitudPrestamo.update({ where: { id }, data: { estado: "CANCELADA", resueltoAt: new Date() } });
  return NextResponse.json({ ok: true });
}
