/**
 * Aprobar o rechazar una solicitud de préstamo o anticipo.
 *
 * Aprobar crea la deducción a plazo (`DeduccionEmpleado`): la cuota por período
 * como monto, el número de cuotas como plazo y el total como saldo. Desde la
 * siguiente planilla se descuenta y se amortiza sola, como cualquier préstamo.
 *
 * Una solicitud que pasa del límite embargable (Arts. 371 y 372) sólo se
 * aprueba confirmándolo de forma expresa, y queda en el rastro de auditoría.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha } from "@/lib/http/validar";
import { tipoDeduccionPara } from "@/lib/payroll/prestamos-bd";
import { hoyHN } from "@/lib/utils";

const schema = z.object({
  accion: z.enum(["aprobar", "rechazar"]),
  observacion: z.string().trim().max(500).optional(),
  confirmarExceso: z.boolean().optional(),
  /** Desde cuándo se descuenta; por omisión, hoy (entra en la siguiente planilla). */
  fechaInicio: zFecha.optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("deducciones.asignar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { accion, observacion, confirmarExceso, fechaInicio } = parsed.data;

  const s = await prisma.solicitudPrestamo.findUnique({ where: { id } });
  if (!s) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (s.estado !== "PENDIENTE") return NextResponse.json({ error: "La solicitud ya fue resuelta" }, { status: 409 });

  if (accion === "rechazar") {
    if (!observacion) return NextResponse.json({ error: "Indique el motivo del rechazo: lo verá el empleado." }, { status: 422 });
    await prisma.solicitudPrestamo.update({ where: { id }, data: { estado: "RECHAZADA", observacion, resueltoPor: g.usuario.id ?? null, resueltoAt: new Date() } });
    const { ip, userAgent } = getClientInfo(req);
    await audit({ accion: "UPDATE", tabla: "SolicitudPrestamo", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { estado: "RECHAZADA", observacion }, ip, userAgent });
    return NextResponse.json({ ok: true });
  }

  if (s.excedeLimite && !confirmarExceso) {
    return NextResponse.json(
      { error: "La cuota pasa de la parte embargable del salario (Arts. 371 y 372). Para aprobarla igual, confírmelo de forma expresa.", requiereConfirmacion: true },
      { status: 422 }
    );
  }
  const tipoDed = await tipoDeduccionPara(prisma, s.tipo);
  if (!tipoDed) return NextResponse.json({ error: `No hay una deducción de tipo ${s.tipo} configurada en Deducciones.` }, { status: 409 });

  const resultado = await prisma.$transaction(async (tx) => {
    const ded = await tx.deduccionEmpleado.create({
      data: {
        empleadoId: s.empleadoId,
        tipoDeduccionId: tipoDed.id,
        monto: s.cuotaPeriodo,
        cuotasMeses: s.cuotas,
        cuotasPagadas: 0,
        saldo: s.monto,
        fechaInicio: fechaInicio ?? hoyHN(),
        activo: true,
        observacion: `Solicitud del empleado ${s.id}${s.motivo ? `: ${s.motivo}` : ""}`.slice(0, 500),
      },
    });
    await tx.solicitudPrestamo.update({
      where: { id },
      data: { estado: "APROBADA", observacion: observacion || null, resueltoPor: g.usuario.id ?? null, resueltoAt: new Date(), deduccionId: ded.id },
    });
    return ded;
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "APPROVE",
    tabla: "SolicitudPrestamo",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { estado: "APROBADA", deduccionId: resultado.id, monto: s.monto, cuotas: s.cuotas, excedeLimite: s.excedeLimite, confirmarExceso: confirmarExceso || undefined },
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true, deduccionId: resultado.id });
}
