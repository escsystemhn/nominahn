/**
 * POST /api/capacitaciones/material/[materialId]/acceso — lo pide el visor al abrir un
 * material: devuelve el enlace firmado (vence en 10 minutos y sólo sirve a esta cuenta)
 * y el texto de la marca de agua. Si lo abre un participante, cuenta para su avance.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { accesoAMaterial } from "@/lib/capacitaciones/material-bd";
import { firmarEnlace, textoMarca } from "@/lib/capacitaciones/material";

type Params = { params: Promise<{ materialId: string }> };

const VISOR: Record<string, "pdf" | "video" | "imagen"> = {
  "application/pdf": "pdf",
  "video/mp4": "video",
  "video/webm": "video",
  "image/png": "imagen",
  "image/jpeg": "imagen",
};

export async function POST(_req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const { materialId } = await params;
  const acceso = await accesoAMaterial(g.usuario, materialId);
  if (!acceso || !g.usuario.id) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const empleado = g.usuario.empleadoId
    ? await prisma.empleado.findUnique({ where: { id: g.usuario.empleadoId }, select: { primerNombre: true, primerApellido: true, identidad: true } })
    : null;
  if (acceso.comoParticipante && g.usuario.empleadoId) {
    await prisma.vistaMaterial.upsert({
      where: { materialId_empleadoId: { materialId, empleadoId: g.usuario.empleadoId } },
      create: { materialId, empleadoId: g.usuario.empleadoId },
      update: { ultimaVez: new Date(), veces: { increment: 1 } },
    });
  }

  const nombre = empleado ? `${empleado.primerNombre} ${empleado.primerApellido}` : g.usuario.email ?? "Usuario";
  return NextResponse.json({
    titulo: acceso.material.titulo,
    visor: VISOR[acceso.material.mime] ?? "pdf",
    mime: acceso.material.mime,
    url: `/api/capacitaciones/material/${materialId}/contenido?t=${encodeURIComponent(firmarEnlace(materialId, g.usuario.id))}`,
    marca: textoMarca(nombre, empleado?.identidad ?? null, new Date()),
  });
}
