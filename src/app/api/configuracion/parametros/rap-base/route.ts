/**
 * RAP y Reserva Laboral: sobre el mes en curso o a mes vencido (lo devengado el mes
 * anterior), desde un mes dado. Sólo quien tiene `configuracion.parametros`: cambia lo
 * que se descuenta a todos. Ver `lib/payroll/rap-mes-vencido.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CLAVE_BASE_RAP, schemaBaseRap } from "@/lib/payroll/rap-mes-vencido";
import { guardarBaseRap, leerBaseRap } from "@/lib/payroll/rap-mes-vencido-bd";

export async function GET() {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  return NextResponse.json(await leerBaseRap(prisma));
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaBaseRap);
  if (!parsed.ok) return parsed.response;

  // A mes vencido se leen las bases de la tabla `BaseRapMes`: en una base sin esa tabla
  // todavía, encender la opción haría fallar el cálculo de toda planilla.
  if (parsed.data.modo === "ANTERIOR") {
    try {
      await prisma.baseRapMes.findFirst({ select: { id: true } });
    } catch {
      return NextResponse.json(
        { error: "Falta actualizar la base de datos para usar el RAP a mes vencido (tabla BaseRapMes). Pida a soporte que la actualice." },
        { status: 409 }
      );
    }
  }

  const antes = await leerBaseRap(prisma);
  await guardarBaseRap(prisma, parsed.data);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_BASE_RAP,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes, valorNuevo: parsed.data, ip, userAgent,
  });
  return NextResponse.json(parsed.data);
}
