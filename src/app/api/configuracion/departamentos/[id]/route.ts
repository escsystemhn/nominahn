/**
 * Edición de un departamento: nombre, código, estado y —con las divisiones
 * habilitadas— su división. Así se ubican en la jerarquía los departamentos
 * que existían antes del nivel División.
 *
 * La sucursal no cambia aquí: sus empleados y puestos pertenecen a ella, y
 * moverla en silencio dejaría a esas personas en una sucursal distinta de la de
 * su departamento.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zIdOpcional } from "@/lib/http/validar";
import { divisionesHabilitadas, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  codigo: z.string().trim().max(50).nullable().optional(),
  activo: z.boolean().optional(),
  /** Presente = se cambia (null la quita). Ausente = no se toca. */
  divisionId: zIdOpcional.optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const antes = await prisma.departamento.findUnique({
    where: { id },
    select: { nombre: true, codigo: true, activo: true, sucursalId: true, divisionId: true },
  });
  if (!antes) return NextResponse.json({ error: "El departamento no existe." }, { status: 404 });

  const cambiaDivision = c.divisionId !== undefined && c.divisionId !== antes.divisionId;
  if (cambiaDivision) {
    const error = await validarDivisionDeDepartamento(
      prisma,
      { sucursalId: antes.sucursalId, divisionId: c.divisionId ?? null },
      await divisionesHabilitadas(prisma)
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
  }

  const dept = await prisma.departamento.update({
    where: { id },
    data: {
      ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
      ...(c.codigo !== undefined ? { codigo: c.codigo || null } : {}),
      ...(c.activo !== undefined ? { activo: c.activo } : {}),
      ...(cambiaDivision ? { divisionId: c.divisionId ?? null } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Departamento", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes,
    valorNuevo: { nombre: dept.nombre, codigo: dept.codigo, activo: dept.activo, sucursalId: dept.sucursalId, divisionId: dept.divisionId },
    ip, userAgent,
  });
  return NextResponse.json(dept);
}
