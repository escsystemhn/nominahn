import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({
  titulo: z.string().trim().min(1).max(200),
  contenido: z.string().trim().min(1).max(50000),
  categoria: z.string().trim().max(80).optional(),
  descripcion: z.string().trim().max(500).optional(),
});

// GET: catálogo de políticas (todos los usuarios autenticados pueden leer).
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const politicas = await prisma.politica.findMany({
    where: { activa: true },
    include: { _count: { select: { versiones: true } } },
    orderBy: [{ categoria: "asc" }, { titulo: "asc" }],
  });
  return NextResponse.json(politicas);
}

// POST: crear una política con su primera versión.
export async function POST(req: NextRequest) {
  const g = await requerirPermiso("comunicacion.politicas");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { titulo, contenido, categoria, descripcion } = parsed.data;
  const usuarioId = g.usuario.id ?? null;

  const politica = await prisma.politica.create({
    data: {
      titulo,
      categoria: categoria || "General",
      descripcion: descripcion ?? null,
      creadoPor: usuarioId,
      versiones: {
        create: {
          numero: 1,
          contenido,
          notasCambio: "Versión inicial",
          vigente: true,
          publicadaPor: usuarioId,
        },
      },
    },
  });
  return NextResponse.json(politica, { status: 201 });
}
