import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId, zIdOpcional } from "@/lib/http/validar";
import { divisionesHabilitadas, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  codigo: z.string().trim().max(50).optional(),
  sucursalId: zId,
  /** Sólo con las divisiones habilitadas; obligatoria si la sucursal ya tiene divisiones. */
  divisionId: zIdOpcional,
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const error = await validarDivisionDeDepartamento(prisma, d, await divisionesHabilitadas(prisma));
  if (error) return NextResponse.json({ error }, { status: 400 });

  const dept = await prisma.departamento.create({
    data: { nombre: d.nombre, codigo: d.codigo || null, sucursalId: d.sucursalId, divisionId: d.divisionId },
  });
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE", tabla: "Departamento", registroId: dept.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { nombre: dept.nombre, sucursalId: dept.sucursalId, divisionId: dept.divisionId }, ip, userAgent,
  });
  return NextResponse.json(dept, { status: 201 });
}
