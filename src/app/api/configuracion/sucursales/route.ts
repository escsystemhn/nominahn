import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { motivoSucursalRepetida } from "@/lib/organizacion/sucursales";

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

  const otras = await prisma.sucursal.findMany({ where: { empresaId: parsed.data.empresaId }, select: { nombre: true, codigo: true } });
  const repetida = motivoSucursalRepetida(parsed.data, otras);
  if (repetida) return NextResponse.json({ error: repetida }, { status: 409 });

  const sucursal = await prisma.sucursal.create({ data: parsed.data });
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE", tabla: "Sucursal", registroId: sucursal.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { nombre: sucursal.nombre, codigo: sucursal.codigo, empresaId: sucursal.empresaId }, ip, userAgent,
  });
  return NextResponse.json(sucursal, { status: 201 });
}
