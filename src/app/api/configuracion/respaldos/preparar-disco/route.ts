/**
 * «Preparar disco»: deja en el disco extraíble conectado la marca de ese destino. Sin
 * ella el respaldo no escribe ahí (2026-11-25): así una unidad desconectada, u otro
 * disco con la misma letra, no recibe el respaldo por error.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { esquemaDestino } from "@/lib/respaldos/config";
import { prepararDisco } from "@/lib/respaldos/destinos";

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, z.object({ destino: esquemaDestino }));
  if (!parsed.ok) return parsed.response;
  const d = parsed.data.destino;
  if (d.tipo !== "EXTRAIBLE") return NextResponse.json({ error: "Sólo se prepara un disco extraíble." }, { status: 400 });
  const r = await prepararDisco(d);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: `respaldos:disco:${d.id}`, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { destino: d.nombre, carpeta: d.carpeta, ok: r.ok }, ip, userAgent,
  });
  return NextResponse.json(r);
}
