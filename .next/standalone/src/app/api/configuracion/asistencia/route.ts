/**
 * Política de deducciones por asistencia (llegadas tarde, salidas anticipadas, ausencias y
 * séptimo día). Ver `lib/asistencia/deducciones`.
 *   GET → { politica, guardada, actualizada, porOmision }
 *   PUT { politica } → la valida y la guarda
 *
 * Cambia lo que se descuenta a TODOS los empleados: sólo con `configuracion.parametros`,
 * igual que los Parámetros de ley. Rige para las planillas que se calculen después;
 * una planilla cerrada no cambia.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { POLITICA_POR_OMISION, zPoliticaAsistencia } from "@/lib/asistencia/deducciones/politica";
import { CLAVE_POLITICA_ASISTENCIA, guardarPoliticaAsistencia, leerPoliticaAsistencia } from "@/lib/asistencia/deducciones/politica-bd";

export async function GET() {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  return NextResponse.json({ ...(await leerPoliticaAsistencia(prisma)), porOmision: POLITICA_POR_OMISION });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  const cuerpo = (await req.json().catch(() => null)) as { politica?: unknown } | null;
  const r = zPoliticaAsistencia.safeParse(cuerpo?.politica);
  if (!r.success) {
    return NextResponse.json({ error: "La política no es válida: revise los campos.", detalle: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }

  const antes = await leerPoliticaAsistencia(prisma);
  await guardarPoliticaAsistencia(prisma, r.data);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_POLITICA_ASISTENCIA,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes.guardada ? antes.politica : { porOmision: true },
    valorNuevo: r.data,
    ip, userAgent,
  });
  return NextResponse.json({ politica: r.data });
}
