/**
 * Estado del servicio para la pantalla de inicio de sesión.
 *
 * Es PÚBLICA a propósito: el login la consulta antes de autenticarse para decir
 * «la base de datos no responde» en vez de dejar a la persona esperando. Por eso
 * sólo devuelve lo que puede ver cualquiera que abra la URL: si la base contesta
 * y el nombre de la empresa, que va impreso en cada boleta.
 *
 * `/api/health` no serviría: respondería aunque la base estuviera caída.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ORDEN_EMPRESA_PRINCIPAL } from "@/lib/empresa";

const SIN_CACHE = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    const empresa = await prisma.empresa.findFirst({ select: { nombre: true }, orderBy: ORDEN_EMPRESA_PRINCIPAL });
    return NextResponse.json({ ok: true, empresa: empresa?.nombre ?? null }, { headers: SIN_CACHE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: SIN_CACHE });
  }
}
