/**
 * Descargar un respaldo que está en un disco local o en una carpeta de red. Los de la
 * nube se bajan desde la consola del proveedor. Queda en la auditoría: es la base entera.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { esArchivoDeRespaldo } from "@/lib/respaldos/config";
import { ubicarEnDisco } from "@/lib/respaldos/destinos";
import { leerConfigRespaldos } from "@/lib/respaldos/respaldos-bd";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.respaldos");
  if (!g.ok) return g.response;
  const { id } = await params;
  const r = await prisma.respaldo.findUnique({ where: { id }, select: { archivo: true } });
  // El nombre sale de la base y se valida igual: nunca una ruta armada con lo que manda el navegador.
  if (!r?.archivo || !esArchivoDeRespaldo(r.archivo)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const config = await leerConfigRespaldos();
  const hallado = await ubicarEnDisco(config.destinos, r.archivo);
  if (!hallado) {
    return NextResponse.json({ error: "Ese respaldo ya no está en ningún disco local ni carpeta de red (puede haberse podado). Si se envió a la nube, descárguelo desde allí." }, { status: 404 });
  }
  const { size } = await stat(hallado.ruta);
  const flujo = createReadStream(hallado.ruta);
  flujo.on("close", () => { void hallado.desconectar(); });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "EXPORT", tabla: "Respaldo", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { archivo: r.archivo, bytes: size }, ip, userAgent });

  return new NextResponse(Readable.toWeb(flujo) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${r.archivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
