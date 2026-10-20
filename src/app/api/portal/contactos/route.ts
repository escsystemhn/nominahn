import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody } from "@/lib/http/validar";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  cargo: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
  telefono: z.string().trim().max(50).optional(),
  extension: z.string().trim().max(20).optional(),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("comunicacion.publicar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const contacto = await prisma.contactoRRHH.create({ data: parsed.data });
  return NextResponse.json(contacto, { status: 201 });
}
