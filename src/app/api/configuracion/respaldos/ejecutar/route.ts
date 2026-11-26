/**
 * «Respaldar ahora»: lo empieza y responde enseguida con su número (202). El respaldo
 * sigue en el servidor aunque se cierre la pantalla; ésta consulta su estado en
 * `/api/configuracion/respaldos/[id]` (2026-11-25: antes el navegador esperaba todo).
 */

import { NextResponse } from "next/server";
import { requerirPermiso } from "@/lib/auth/guard";
import { iniciarRespaldo, ErrorRespaldo } from "@/lib/respaldos/respaldos-bd";

export async function POST() {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  try {
    const { id } = await iniciarRespaldo("MANUAL", { id: g.usuario.id, email: g.usuario.email ?? undefined });
    return NextResponse.json({ id, estado: "EN_CURSO" }, { status: 202 });
  } catch (e) {
    if (e instanceof ErrorRespaldo) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
