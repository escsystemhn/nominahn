/**
 * Opción de estructura organizacional: usar o no el nivel División
 * (Sucursal → División → Departamento). La enciende o apaga el administrador.
 * Apagarla no borra divisiones ni asignaciones: sólo deja de mostrarlas y de
 * aceptarlas (ver `src/lib/organizacion/estructura-bd.ts`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CLAVE_DIVISIONES, divisionesHabilitadas, guardarDivisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

const schema = z.object({ divisiones: z.boolean() });

export async function GET() {
  const g = await requerirPermiso(["configuracion.ver", "configuracion.editar"]);
  if (!g.ok) return g.response;
  return NextResponse.json({ divisiones: await divisionesHabilitadas(prisma) });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const antes = await divisionesHabilitadas(prisma);
  await guardarDivisionesHabilitadas(prisma, parsed.data.divisiones);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "ConfiguracionSistema",
    registroId: CLAVE_DIVISIONES,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { divisiones: antes },
    valorNuevo: { divisiones: parsed.data.divisiones },
    ip,
    userAgent,
  });

  return NextResponse.json({ divisiones: parsed.data.divisiones });
}
