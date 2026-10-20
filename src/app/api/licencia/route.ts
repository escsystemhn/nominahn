/**
 * Estado de la licencia para quien tiene sesión.
 *
 * Nunca devuelve la llave ni el archivo de activación: sólo lo que la pantalla
 * /licencia muestra (modo, días, cliente, vencimiento y código de equipo).
 */

import { NextResponse } from "next/server";
import { requerirSesion } from "@/lib/auth/guard";
import { estadoLicencia, hayServidorDeLicencias } from "@/lib/licencia/estado";

export async function GET() {
  const guardia = await requerirSesion();
  if (!guardia.ok) return guardia.response;

  const estado = await estadoLicencia();
  return NextResponse.json(
    { ...estado, activacionEnLinea: hayServidorDeLicencias() },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
