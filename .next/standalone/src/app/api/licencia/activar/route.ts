/**
 * Activa la licencia: con la llave (en línea, contra SDL) o con el archivo .lic
 * que SDL emite para equipos sin internet.
 *
 * Exige `configuracion.editar`: activar decide qué empresa figura como titular
 * del programa. Que siga abierta con la licencia bloqueada es a propósito (ver
 * SIEMPRE_ABIERTO en proxy.ts): es la salida del bloqueo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { activarConArchivo, activarConLlave } from "@/lib/licencia/estado";

const esquema = z.union([
  z.object({ llave: z.string().trim().min(10).max(64) }),
  // Un archivo de SDL ronda los 800 caracteres; el techo sólo corta abusos.
  z.object({ archivo: z.string().trim().min(10).max(8000) }),
]);

export async function POST(request: Request) {
  const guardia = await requerirPermiso("configuracion.editar");
  if (!guardia.ok) return guardia.response;

  const datos = esquema.safeParse(await request.json().catch(() => null));
  if (!datos.success) {
    return NextResponse.json({ error: "Escriba la llave de licencia o pegue el archivo de activación." }, { status: 400 });
  }

  const porLlave = "llave" in datos.data;
  const r = "llave" in datos.data ? await activarConLlave(datos.data.llave) : await activarConArchivo(datos.data.archivo);

  const { ip, userAgent } = getClientInfo(request);
  await audit({
    accion: "UPDATE",
    tabla: "Licencia",
    registroId: "licencia",
    usuarioId: guardia.usuario.id,
    usuarioEmail: guardia.usuario.email ?? undefined,
    valorNuevo: r.ok
      ? { exito: true, via: porLlave ? "llave" : "archivo", modo: r.estado.modo }
      : { exito: false, via: porLlave ? "llave" : "archivo", motivo: r.mensaje },
    ip,
    userAgent,
  });

  if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 422 });
  return NextResponse.json({ ok: true, estado: r.estado });
}
