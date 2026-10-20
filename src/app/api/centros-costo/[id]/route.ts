/**
 * Edición y baja de un centro de costo, y asignación a departamentos.
 *
 * NO SE BORRA UN CENTRO EN USO: las planillas ya emitidas se imputaron a él, y
 * borrarlo dejaría partidas contables apuntando a un centro inexistente. Se
 * DESACTIVA, que lo retira de los desplegables sin romper el histórico.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { z } from "zod";

const schema = z.object({
  nombre: z.string().trim().min(1).max(80).optional(),
  descripcion: z.string().trim().max(300).nullable().optional(),
  cuentaGasto: z.string().trim().max(30).nullable().optional(),
  activo: z.boolean().optional(),
  /** Departamentos cuyo centro de costo por omisión pasa a ser este. */
  departamentosIds: z.array(zId).max(200).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("organizacion.centros_costo");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const cambios = parsed.data;

  const centro = await prisma.centroCosto.findUnique({
    where: { id },
    select: { id: true, codigo: true, nombre: true, activo: true, cuentaGasto: true },
  });
  if (!centro) return NextResponse.json({ error: "El centro de costo no existe." }, { status: 404 });

  const actualizado = await prisma.$transaction(async (tx) => {
    const c = await tx.centroCosto.update({
      where: { id },
      data: {
        ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
        ...(cambios.descripcion !== undefined ? { descripcion: cambios.descripcion } : {}),
        ...(cambios.cuentaGasto !== undefined ? { cuentaGasto: cambios.cuentaGasto } : {}),
        ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
      },
    });

    if (cambios.departamentosIds) {
      // Se reemplaza el conjunto: los que salen de la lista quedan sin centro,
      // no conservando el anterior en silencio.
      await tx.departamento.updateMany({
        where: { centroCostoId: id, id: { notIn: cambios.departamentosIds } },
        data: { centroCostoId: null },
      });
      await tx.departamento.updateMany({
        where: { id: { in: cambios.departamentosIds } },
        data: { centroCostoId: id },
      });
    }

    return c;
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "CentroCosto",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: centro.nombre, activo: centro.activo, cuentaGasto: centro.cuentaGasto },
    valorNuevo: {
      nombre: actualizado.nombre,
      activo: actualizado.activo,
      cuentaGasto: actualizado.cuentaGasto,
      ...(cambios.departamentosIds ? { departamentos: cambios.departamentosIds.length } : {}),
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ centro: actualizado });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("organizacion.centros_costo");
  if (!g.ok) return g.response;

  const { id } = await params;
  const centro = await prisma.centroCosto.findUnique({
    where: { id },
    include: { _count: { select: { departamentos: true, empleados: true } } },
  });
  if (!centro) return NextResponse.json({ error: "El centro de costo no existe." }, { status: 404 });

  const enUso = centro._count.departamentos + centro._count.empleados;
  if (enUso > 0) {
    return NextResponse.json(
      {
        error: `Hay ${centro._count.departamentos} departamento(s) y ${centro._count.empleados} empleado(s) imputando a este centro. Reasígnelos, o desactívelo para retirarlo de los desplegables sin perder el histórico contable.`,
      },
      { status: 409 }
    );
  }

  await prisma.centroCosto.delete({ where: { id } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "CentroCosto",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { codigo: centro.codigo, nombre: centro.nombre },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
