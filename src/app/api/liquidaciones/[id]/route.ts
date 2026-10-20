/**
 * Una liquidación final: consulta y cambio de estado.
 *
 *   GET   → la liquidación con su desglose congelado y las acciones permitidas
 *   PATCH → { estado: "APROBADA" | "PAGADA" | "ANULADA", motivo?, fechaPago?, reactivarEmpleado? }
 *
 * La matriz de quién puede qué está en `lib/payroll/estado-prestaciones.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha } from "@/lib/http/validar";
import { validarTransicionLiquidacion, accionesLiquidacion, type EstadoLiquidacion } from "@/lib/payroll/estado-prestaciones";
import { hoyHN } from "@/lib/utils";

const schema = z.object({
  estado: z.enum(["APROBADA", "PAGADA", "ANULADA"]),
  motivo: z.string().trim().max(500).optional(),
  fechaPago: zFecha.optional(),
  /** Al anular: devolver al empleado a ACTIVO (la liquidación lo había dado de baja). */
  reactivarEmpleado: z.boolean().optional(),
});

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("prestaciones.ver");
  if (!g.ok) return g.response;
  const { id } = await params;

  const liq = await prisma.liquidacionFinal.findUnique({
    where: { id },
    include: {
      empleado: {
        select: {
          id: true, codigo: true, identidad: true, primerNombre: true, segundoNombre: true,
          primerApellido: true, segundoApellido: true, estado: true,
          puesto: { select: { nombre: true } }, departamento: { select: { nombre: true } },
        },
      },
    },
  });
  if (!liq) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({ ...liq, acciones: accionesLiquidacion(liq.estado as EstadoLiquidacion, g.usuario.permisos ?? []) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // La guardia gruesa: quien no toca prestaciones en absoluto. La transición
  // concreta la decide la matriz.
  const g = await requerirPermiso(["prestaciones.generar", "prestaciones.aprobar", "prestaciones.pagar", "prestaciones.anular_pagada"]);
  if (!g.ok) return g.response;
  const { id } = await params;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { estado, motivo, fechaPago, reactivarEmpleado } = parsed.data;

  const liq = await prisma.liquidacionFinal.findUnique({ where: { id } });
  if (!liq) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const v = validarTransicionLiquidacion(liq.estado as EstadoLiquidacion, estado, g.usuario.permisos, motivo);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const data: Record<string, unknown> = { estado };
  if (estado === "APROBADA") data.aprobadoPor = g.usuario.id ?? null;
  if (estado === "PAGADA") data.fechaPago = fechaPago ?? hoyHN();
  if (estado === "ANULADA") {
    const nota = `Anulada el ${new Date().toISOString().slice(0, 10)}${motivo ? `: ${motivo}` : ""}`;
    data.observaciones = liq.observaciones ? `${liq.observaciones}\n${nota}` : nota;
  }

  const actualizada = await prisma.$transaction(async (tx) => {
    const r = await tx.liquidacionFinal.update({ where: { id }, data });
    if (estado === "ANULADA" && reactivarEmpleado) {
      await tx.empleado.update({ where: { id: liq.empleadoId }, data: { estado: "ACTIVO", fechaSalida: null } });
    }
    return r;
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: estado === "APROBADA" ? "APPROVE" : "UPDATE",
    tabla: "LiquidacionFinal",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { estado: liq.estado },
    valorNuevo: { estado, motivo: motivo ?? undefined, fechaPago: data.fechaPago ?? undefined, reactivarEmpleado: reactivarEmpleado || undefined },
    ip,
    userAgent,
  });

  return NextResponse.json(actualizada);
}
