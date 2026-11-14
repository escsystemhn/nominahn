import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({
  titulo: z.string().trim().min(1).max(300),
  contenido: z.string().trim().min(1).max(20000),
  categoria: z.enum(["BLOG", "ANUNCIO"]).optional(),
  urgente: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  // El autor es SIEMPRE el usuario de la sesión, no un id del body: antes se
  // confiaba en `autorId` del cliente, que permitía publicar en nombre de otro.
  const autorId = g.usuario.empleadoId ?? null;
  if (!autorId) return NextResponse.json({ error: "Su usuario no está vinculado a un empleado" }, { status: 400 });

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { titulo, contenido, categoria, urgente } = parsed.data;

  if (categoria === "ANUNCIO") {
    const anuncio = await prisma.anuncio.create({
      data: { titulo, contenido, urgente: urgente ?? false, autorId },
    });
    return NextResponse.json(anuncio, { status: 201 });
  }

  const post = await prisma.portalPost.create({
    data: { titulo, contenido, categoria: "BLOG", autorId },
  });
  return NextResponse.json(post, { status: 201 });
}
