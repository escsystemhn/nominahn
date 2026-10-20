/**
 * Préstamos y anticipos del empleado autenticado.
 *   GET  → lo que se le descuenta hoy, sus solicitudes y su límite de descuento
 *   POST → nueva solicitud { tipo, monto, cuotas, motivo? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zMontoPositivo } from "@/lib/http/validar";
import { evaluarSolicitud } from "@/lib/payroll/prestamos";
import { limiteDeEmpleado, tipoDeduccionPara } from "@/lib/payroll/prestamos-bd";

const schema = z.object({
  tipo: z.enum(["PRESTAMO", "ADELANTO"]),
  monto: zMontoPositivo,
  cuotas: z.coerce.number().int().min(1).max(60),
  motivo: z.string().trim().max(500).optional(),
});

const MAX_PENDIENTES = 3;

export async function GET() {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ vigentes: [], solicitudes: [], limite: null, tipos: { PRESTAMO: false, ADELANTO: false } });

  const [vigentes, solicitudes, lim, tPrestamo, tAdelanto] = await Promise.all([
    prisma.deduccionEmpleado.findMany({
      where: { empleadoId, activo: true, tipoDeduccion: { tipo: { in: ["PRESTAMO", "ADELANTO", "COOPERATIVA"] } } },
      select: {
        id: true, monto: true, saldo: true, cuotasMeses: true, cuotasPagadas: true, fechaInicio: true,
        tipoDeduccion: { select: { nombre: true, tipo: true } },
      },
      orderBy: { fechaInicio: "desc" },
    }),
    prisma.solicitudPrestamo.findMany({
      where: { empleadoId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, tipo: true, monto: true, cuotas: true, cuotaPeriodo: true, estado: true, excedeLimite: true, motivo: true, observacion: true, createdAt: true, resueltoAt: true },
    }),
    limiteDeEmpleado(prisma, empleadoId),
    tipoDeduccionPara(prisma, "PRESTAMO"),
    tipoDeduccionPara(prisma, "ADELANTO"),
  ]);

  return NextResponse.json({
    vigentes,
    solicitudes,
    limite: lim.limite,
    tipoPlanilla: lim.tipoPlanilla,
    tipos: { PRESTAMO: !!tPrestamo, ADELANTO: !!tAdelanto },
  });
}

export async function POST(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ error: "Su usuario no está vinculado a un empleado." }, { status: 400 });

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  if (!(await tipoDeduccionPara(prisma, d.tipo))) {
    return NextResponse.json({ error: `La empresa no tiene configurada una deducción de tipo ${d.tipo === "PRESTAMO" ? "préstamo" : "anticipo"}. Consulte a Recursos Humanos.` }, { status: 409 });
  }
  const pendientes = await prisma.solicitudPrestamo.count({ where: { empleadoId, estado: "PENDIENTE" } });
  if (pendientes >= MAX_PENDIENTES) {
    return NextResponse.json({ error: `Ya tiene ${pendientes} solicitudes pendientes. Espere a que se resuelvan.` }, { status: 409 });
  }

  const { limite } = await limiteDeEmpleado(prisma, empleadoId);
  const ev = evaluarSolicitud({ tipo: d.tipo, monto: d.monto, cuotas: d.cuotas, limite });
  if (ev.errores.length) return NextResponse.json({ error: ev.errores.join(" ") }, { status: 422 });

  const s = await prisma.solicitudPrestamo.create({
    data: {
      empleadoId,
      tipo: d.tipo,
      monto: d.monto,
      cuotas: d.cuotas,
      cuotaPeriodo: ev.cuotaPeriodo,
      motivo: d.motivo || null,
      limiteCuotaPeriodo: limite?.disponiblePeriodo ?? null,
      excedeLimite: ev.excedeLimite,
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "CREATE", tabla: "SolicitudPrestamo", registroId: s.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { tipo: d.tipo, monto: d.monto, cuotas: d.cuotas, excedeLimite: ev.excedeLimite }, ip, userAgent });
  return NextResponse.json({ ...s, aviso: ev.aviso }, { status: 201 });
}
