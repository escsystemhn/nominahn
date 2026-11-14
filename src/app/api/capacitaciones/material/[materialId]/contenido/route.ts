/**
 * GET /api/capacitaciones/material/[materialId]/contenido?t=… — el archivo para el visor.
 *
 * Exige la sesión Y el enlace firmado de esa misma cuenta (10 minutos). Se entrega por
 * partes (Range: el video avanza sin bajar todo, pdf.js pide sólo las páginas que
 * muestra), siempre `inline` y sin caché. Abierto suelto en una pestaña, la política
 * `sandbox` impide el visor del navegador con su botón de descarga.
 */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { requerirSesion } from "@/lib/auth/guard";
import { accesoAMaterial } from "@/lib/capacitaciones/material-bd";
import { enlaceValido, leerRange, rutaMaterial } from "@/lib/capacitaciones/material";

type Params = { params: Promise<{ materialId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const { materialId } = await params;
  const token = new URL(req.url).searchParams.get("t");
  if (!g.usuario.id || !enlaceValido(token, materialId, g.usuario.id)) {
    return NextResponse.json({ error: "El enlace venció: vuelva a abrir el material." }, { status: 403 });
  }
  const acceso = await accesoAMaterial(g.usuario, materialId);
  if (!acceso) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const ruta = rutaMaterial(acceso.material.archivo);
  const tamano = (await stat(ruta).catch(() => null))?.size;
  if (tamano === undefined) return NextResponse.json({ error: "El archivo ya no está en el servidor." }, { status: 410 });

  const comunes = {
    "Content-Type": acceso.material.mime,
    "Accept-Ranges": "bytes",
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  };
  const r = leerRange(req.headers.get("range"), tamano);
  if (r === "invalido") {
    return new NextResponse(null, { status: 416, headers: { ...comunes, "Content-Range": `bytes */${tamano}` } });
  }
  const { inicio, fin } = r ?? { inicio: 0, fin: tamano - 1 };
  const cuerpo = Readable.toWeb(createReadStream(ruta, { start: inicio, end: fin })) as ReadableStream<Uint8Array>;
  return new NextResponse(cuerpo, {
    status: r ? 206 : 200,
    headers: {
      ...comunes,
      "Content-Length": String(fin - inicio + 1),
      ...(r ? { "Content-Range": `bytes ${inicio}-${fin}/${tamano}` } : {}),
    },
  });
}
