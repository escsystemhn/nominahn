import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zId } from "@/lib/http/validar";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  codigo: z.string().trim().min(1).max(50),
  direccion: z.string().trim().max(300).optional(),
  telefono: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
  empresaId: zId,
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const sucursal = await prisma.sucursal.create({ data: parsed.data });
  return NextResponse.json(sucursal, { status: 201 });
}
