/** «Respaldar ahora»: hace el respaldo en el acto y responde con el resultado de cada destino. */

import { NextResponse } from "next/server";
import { requerirPermiso } from "@/lib/auth/guard";
import { crearRespaldo, ErrorRespaldo } from "@/lib/respaldos/respaldos-bd";

export async function POST() {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  try {
    const r = await crearRespaldo("MANUAL", { id: g.usuario.id, email: g.usuario.email ?? undefined });
    return NextResponse.json(r, { status: r.estado === "ERROR" ? 500 : 200 });
  } catch (e) {
    if (e instanceof ErrorRespaldo) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
