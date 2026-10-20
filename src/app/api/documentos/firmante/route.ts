/** Quién firma por el patrono y desde qué ciudad se emiten los documentos. */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { guardarFirmante, leerFirmante } from "@/lib/documentos/firmante";

const schema = z.object({
  nombre: z.string().trim().max(150),
  cargo: z.string().trim().max(150),
  identidad: z.string().trim().max(30),
  ciudad: z.string().trim().max(100),
});

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("documentos.plantillas");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const antes = await leerFirmante(prisma);
  await guardarFirmante(prisma, parsed.data);
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: "DOCUMENTOS_FIRMANTE", usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: antes, valorNuevo: parsed.data, ip, userAgent });
  return NextResponse.json(await leerFirmante(prisma));
}
