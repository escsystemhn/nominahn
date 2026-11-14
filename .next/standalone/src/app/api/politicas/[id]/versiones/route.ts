import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({
  contenido: z.string().trim().min(1).max(50000),
  notasCambio: z.string().trim().max(500).optional(),
});

// POST: publicar una nueva versión de la política. La versión anterior deja de
// ser vigente y la nueva toma el número consecutivo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("comunicacion.politicas");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { contenido, notasCambio } = parsed.data;

  const politica = await prisma.politica.findUnique({ where: { id } });
  if (!politica) return NextResponse.json({ error: "Política no encontrada" }, { status: 404 });

  const version = await prisma.$transaction(async (tx) => {
    const ultima = await tx.versionPolitica.findFirst({
      where: { politicaId: id },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
    const numero = (ultima?.numero ?? 0) + 1;

    await tx.versionPolitica.updateMany({ where: { politicaId: id, vigente: true }, data: { vigente: false } });

    return tx.versionPolitica.create({
      data: {
        politicaId: id,
        numero,
        contenido,
        notasCambio: notasCambio ?? null,
        vigente: true,
        publicadaPor: g.usuario.id ?? null,
      },
    });
  });

  return NextResponse.json(version, { status: 201 });
}
