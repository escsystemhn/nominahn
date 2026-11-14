/**
 * Política de sesión: minutos sin actividad tras los que se cierra la sesión.
 *   GET → { minutosInactividad }
 *   PUT { minutosInactividad } → la guarda
 *
 * Es una política de seguridad de todas las cuentas: la cambia quien administra los
 * usuarios (`seguridad.usuarios_gestionar`). Las sesiones abiertas la toman en su
 * próxima revalidación (a lo sumo 5 minutos) o al cambiar de página.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { leerMinutos } from "@/lib/auth/inactividad";
import { guardarMinutosInactividad, leerMinutosInactividad } from "@/lib/auth/inactividad-bd";

export async function GET() {
  const g = await requerirPermiso("seguridad.usuarios_gestionar");
  if (!g.ok) return g.response;
  return NextResponse.json({ minutosInactividad: await leerMinutosInactividad(prisma) });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("seguridad.usuarios_gestionar");
  if (!g.ok) return g.response;
  const cuerpo = (await req.json().catch(() => null)) as { minutosInactividad?: unknown } | null;
  const r = leerMinutos(cuerpo?.minutosInactividad);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  const antes = await leerMinutosInactividad(prisma);
  await guardarMinutosInactividad(prisma, r.valor);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "ConfiguracionSistema",
    registroId: "SEGURIDAD_INACTIVIDAD_MINUTOS",
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { minutosInactividad: antes },
    valorNuevo: { minutosInactividad: r.valor },
    ip,
    userAgent,
  });
  return NextResponse.json({ minutosInactividad: r.valor });
}
