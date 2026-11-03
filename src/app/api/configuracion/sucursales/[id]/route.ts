/**
 * Edición y desactivación de una sucursal. No hay borrado: ver
 * `lib/organizacion/sucursales.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { motivoParaNoDesactivarSucursal, motivoSucursalRepetida } from "@/lib/organizacion/sucursales";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  codigo: z.string().trim().min(1).max(50).optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  telefono: z.string().trim().max(50).nullable().optional(),
  activa: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const antes = await prisma.sucursal.findUnique({
    where: { id },
    select: { nombre: true, codigo: true, direccion: true, telefono: true, activa: true, empresaId: true },
  });
  if (!antes) return NextResponse.json({ error: "La sucursal no existe." }, { status: 404 });

  const nombre = c.nombre ?? antes.nombre;
  const codigo = c.codigo ?? antes.codigo;
  if (nombre !== antes.nombre || codigo !== antes.codigo) {
    const otras = await prisma.sucursal.findMany({ where: { empresaId: antes.empresaId, id: { not: id } }, select: { nombre: true, codigo: true } });
    const repetida = motivoSucursalRepetida({ nombre, codigo }, otras);
    if (repetida) return NextResponse.json({ error: repetida }, { status: 409 });
  }

  if (c.activa === false && antes.activa) {
    const [empleadosVigentes, otrasActivas] = await Promise.all([
      prisma.empleado.count({ where: { sucursalId: id, estado: { not: "INACTIVO" } } }),
      prisma.sucursal.count({ where: { empresaId: antes.empresaId, activa: true, id: { not: id } } }),
    ]);
    const motivo = motivoParaNoDesactivarSucursal({ empleadosVigentes, otrasActivas });
    if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  }

  const sucursal = await prisma.sucursal.update({
    where: { id },
    data: {
      nombre,
      codigo,
      ...(c.direccion !== undefined ? { direccion: c.direccion || null } : {}),
      ...(c.telefono !== undefined ? { telefono: c.telefono || null } : {}),
      ...(c.activa !== undefined ? { activa: c.activa } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Sucursal", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: antes.nombre, codigo: antes.codigo, direccion: antes.direccion, telefono: antes.telefono, activa: antes.activa },
    valorNuevo: { nombre: sucursal.nombre, codigo: sucursal.codigo, direccion: sucursal.direccion, telefono: sucursal.telefono, activa: sucursal.activa },
    ip, userAgent,
  });
  return NextResponse.json(sucursal);
}
