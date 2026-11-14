/**
 * Un material de capacitación: cambiar título, descripción u orden, o quitarlo (se borra
 * también el archivo del disco).
 */
import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { filtroCapacitaciones } from "@/lib/capacitaciones/alcance";
import { rutaMaterial } from "@/lib/capacitaciones/material";

type Params = { params: Promise<{ materialId: string }> };

const schema = z
  .object({
    titulo: z.string().trim().min(1).max(200).optional(),
    descripcion: z.string().trim().max(1000).nullable().optional(),
    tipo: z.enum(["MANUAL", "VIDEO", "DOCUMENTO"]).optional(),
    orden: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { error: "Sin cambios" });

async function delAlcance(usuario: Parameters<typeof filtroCapacitaciones>[0], materialId: string) {
  return prisma.materialCapacitacion.findFirst({ where: { id: materialId, capacitacion: filtroCapacitaciones(usuario) } });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { materialId } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  if (!(await delAlcance(g.usuario, materialId))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const m = await prisma.materialCapacitacion.update({ where: { id: materialId }, data: parsed.data, select: { id: true, titulo: true, tipo: true, orden: true } });
  return NextResponse.json(m);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { materialId } = await params;
  const m = await delAlcance(g.usuario, materialId);
  if (!m) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  await prisma.materialCapacitacion.delete({ where: { id: materialId } });
  await unlink(rutaMaterial(m.archivo)).catch(() => {});

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "MaterialCapacitacion",
    registroId: materialId,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { capacitacionId: m.capacitacionId, titulo: m.titulo, tamano: m.tamano },
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true });
}
