/**
 * El navegador avisa que va a cerrar la sesión por inactividad, justo antes de
 * cerrarla: queda en la auditoría quién, cuándo y con qué límite. El cierre en sí lo
 * hace `signOut` (que además registra el LOGOUT).
 *
 * Si la pestaña estaba dormida y la sesión ya venció en el servidor, esto responde 401
 * y no queda rastro: el servidor ya la había dado por terminada.
 */

import { NextRequest, NextResponse } from "next/server";
import { requerirSesion } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { normalizarMinutos } from "@/lib/auth/inactividad";

export async function POST(req: NextRequest) {
  const g = await requerirSesion({ permitirPasswordTemporal: true });
  if (!g.ok) return g.response;
  const cuerpo = (await req.json().catch(() => ({}))) as { minutos?: unknown; pagina?: unknown };
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "LOGOUT",
    tabla: "User",
    registroId: g.usuario.id ?? g.usuario.email ?? "desconocido",
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      motivo: "INACTIVIDAD",
      minutos: normalizarMinutos(cuerpo.minutos),
      pagina: typeof cuerpo.pagina === "string" ? cuerpo.pagina.slice(0, 200) : undefined,
    },
    ip,
    userAgent,
  });
  return new NextResponse(null, { status: 204 });
}
