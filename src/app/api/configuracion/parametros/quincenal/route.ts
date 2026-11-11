/**
 * Planilla quincenal: si IHSS, RAP e impuesto vecinal se deducen divididos en las
 * dos quincenas o completos en la segunda. Sólo quien tiene `configuracion.parametros`:
 * cambia lo que se descuenta a todos.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CLAVE_DISTRIBUCION_QUINCENAL, schemaDistribucion } from "@/lib/payroll/distribucion-quincenal";
import { guardarDistribucionQuincenal, leerDistribucionQuincenal } from "@/lib/payroll/distribucion-quincenal-bd";

export async function GET() {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  return NextResponse.json(await leerDistribucionQuincenal(prisma));
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaDistribucion);
  if (!parsed.ok) return parsed.response;

  const antes = await leerDistribucionQuincenal(prisma);
  await guardarDistribucionQuincenal(prisma, parsed.data);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_DISTRIBUCION_QUINCENAL,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes, valorNuevo: parsed.data, ip, userAgent,
  });
  return NextResponse.json(parsed.data);
}
