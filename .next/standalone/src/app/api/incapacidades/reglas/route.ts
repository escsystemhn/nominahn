/**
 * Reglas de incapacidad por tipo. Las consulta quien registra incapacidades; las
 * cambia sólo quien edita los parámetros de ley, porque mueven el salario de
 * toda la plantilla.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { leerReglas, guardarReglas } from "@/lib/asistencia/incapacidades-bd";
import { validarReglas, REGLAS_POR_OMISION, type ReglasIncapacidad } from "@/lib/asistencia/incapacidades";

const regla = z.object({
  diasPatrono: z.coerce.number().int().min(0).max(30),
  porcentajeSubsidio: z.coerce.number().min(0).max(100),
  porcentajeComplemento: z.coerce.number().min(0).max(100),
});
const schema = z.object({ ENFERMEDAD_COMUN: regla, ACCIDENTE_COMUN: regla, RIESGO_PROFESIONAL: regla, MATERNIDAD: regla });

export async function GET() {
  const g = await requerirPermiso(["asistencia.incapacidades", "configuracion.parametros"]);
  if (!g.ok) return g.response;
  return NextResponse.json({ reglas: await leerReglas(prisma), porOmision: REGLAS_POR_OMISION });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const reglas = parsed.data as ReglasIncapacidad;
  const errores = validarReglas(reglas);
  if (errores.length) return NextResponse.json({ error: errores.join(" ") }, { status: 422 });
  const antes = await leerReglas(prisma);
  await guardarReglas(prisma, reglas);
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: "INCAPACIDAD_REGLAS", usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: antes, valorNuevo: reglas, ip, userAgent });
  return NextResponse.json({ reglas });
}
