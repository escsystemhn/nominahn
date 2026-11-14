/**
 * Corregir el contrato vigente. Un contrato terminado no se edita: es historial.
 * El tipo, el inicio y el salario tampoco: esos cambios son un contrato nuevo.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha } from "@/lib/http/validar";
import { motivoFinInvalido } from "@/lib/empleados/contratos";

const schema = z.object({
  fechaFin: z.union([z.null(), zFecha]).optional(),
  cargo: z.string().trim().min(1).max(150).optional(),
  jornada: z.string().trim().max(150).nullable().optional(),
  horario: z.string().trim().max(150).nullable().optional(),
  observaciones: z.string().trim().max(1000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; contratoId: string }> }) {
  const g = await requerirPermiso("empleados.editar");
  if (!g.ok) return g.response;

  const { id, contratoId } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const antes = await prisma.contrato.findFirst({
    where: { id: contratoId, empleadoId: id },
    select: {
      activo: true, tipoContrato: true, fechaInicio: true, fechaFin: true, cargo: true, jornada: true, horario: true, observaciones: true,
      empleado: { select: { id: true, sucursalId: true, departamentoId: true } },
    },
  });
  if (!antes || !alcanzaEmpleado(g.usuario, antes.empleado)) return NextResponse.json({ error: "Contrato no encontrado" }, { status: 404 });
  if (!antes.activo) return NextResponse.json({ error: "Este contrato ya terminó: forma parte del historial y no se edita." }, { status: 409 });

  const fechaFin = c.fechaFin !== undefined ? c.fechaFin : antes.fechaFin;
  const motivo = motivoFinInvalido(antes.tipoContrato, antes.fechaInicio, fechaFin);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 400 });

  const contrato = await prisma.contrato.update({
    where: { id: contratoId },
    data: {
      fechaFin,
      ...(c.cargo !== undefined ? { cargo: c.cargo } : {}),
      ...(c.jornada !== undefined ? { jornada: c.jornada || null } : {}),
      ...(c.horario !== undefined ? { horario: c.horario || null } : {}),
      ...(c.observaciones !== undefined ? { observaciones: c.observaciones || null } : {}),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Contrato", registroId: contratoId, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { fechaFin: antes.fechaFin, cargo: antes.cargo, jornada: antes.jornada, horario: antes.horario, observaciones: antes.observaciones },
    valorNuevo: { fechaFin: contrato.fechaFin, cargo: contrato.cargo, jornada: contrato.jornada, horario: contrato.horario, observaciones: contrato.observaciones },
    ip, userAgent,
  });
  return NextResponse.json(contrato);
}
