/**
 * Método de cálculo del ISR: ESTANDAR (anualiza el mes) o PERSONALIZADO (proyección
 * anual como la hoja «Retención en la fuente»), y las deducciones del personalizado.
 * Sólo quien tiene `configuracion.parametros`: cambia lo que se retiene a todos.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CLAVE_METODO_ISR, guardarConfigIsr, leerConfigIsr, schemaMetodoIsr } from "@/lib/payroll/isr-personalizado-bd";

export async function GET() {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const [config, porAnio] = await Promise.all([
    leerConfigIsr(prisma),
    prisma.acumuladoIsr.groupBy({ by: ["anio"], _count: { _all: true }, orderBy: { anio: "desc" } }),
  ]);
  const acumulados = await Promise.all(porAnio.map(async (a) => ({
    anio: a.anio,
    meses: a._count._all,
    empleados: (await prisma.acumuladoIsr.groupBy({ by: ["empleadoId"], where: { anio: a.anio } })).length,
  })));
  return NextResponse.json({ ...config, acumulados });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaMetodoIsr);
  if (!parsed.ok) return parsed.response;

  const antes = await leerConfigIsr(prisma);
  await guardarConfigIsr(prisma, parsed.data);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_METODO_ISR,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes, valorNuevo: parsed.data, ip, userAgent,
  });
  return NextResponse.json(parsed.data);
}
