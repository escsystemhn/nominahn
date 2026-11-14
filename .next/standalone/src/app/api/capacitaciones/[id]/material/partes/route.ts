/**
 * POST /api/capacitaciones/[id]/material/partes — una parte (hasta 4 MB) de un archivo que se
 * sube por partes. Cabeceras: `x-subida` (UUID v4 que elige el navegador) y `x-desde` (byte
 * donde empieza). Cuando llegan todas, POST /api/capacitaciones/[id]/material con `x-subida`
 * y `x-total` registra el material. Por qué por partes: ver lib/capacitaciones/subida.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir, writeFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filtroCapacitaciones } from "@/lib/capacitaciones/alcance";
import { formatoPorFirma, maxBytesMaterial } from "@/lib/capacitaciones/material";
import { revisarParte, subidaValida } from "@/lib/capacitaciones/subida";
import { guardarEstado, leerEstado, limpiarVencidas, rutasSubida } from "@/lib/capacitaciones/subida-disco";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!(await prisma.capacitacion.count({ where: { AND: [{ id }, filtroCapacitaciones(g.usuario)] } }))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const subida = req.headers.get("x-subida");
  if (!subidaValida(subida)) return NextResponse.json({ error: "Subida sin identificador válido." }, { status: 400 });
  const desde = Number(req.headers.get("x-desde"));

  const datos = new Uint8Array(await req.arrayBuffer());
  const declarado = req.headers.get("content-length");
  if (declarado !== null && Number(declarado) !== datos.length) {
    return NextResponse.json({ error: "La parte llegó incompleta: vuelva a intentarlo." }, { status: 400 });
  }

  const usuarioId = g.usuario.id ?? g.usuario.email ?? "";
  const revision = revisarParte(await leerEstado(subida), { usuarioId, capacitacionId: id, desde, largo: datos.length, max: maxBytesMaterial() });
  if (!revision.ok) return NextResponse.json({ error: revision.error }, { status: revision.status });

  const rutas = rutasSubida(subida);
  await mkdir(rutas.dir, { recursive: true });
  if (desde === 0) {
    // El formato se decide con la primera parte: no se sigue recibiendo un archivo que no sirve.
    if (!formatoPorFirma(datos.subarray(0, 16))) {
      return NextResponse.json(
        { error: "Sólo se aceptan PDF, videos MP4 o WebM e imágenes PNG o JPG. Un documento de Word o PowerPoint, guárdelo como PDF." },
        { status: 415 }
      );
    }
    await limpiarVencidas();
    await writeFile(rutas.parte, datos);
  } else {
    await appendFile(rutas.parte, datos);
  }
  const bytes = desde + datos.length;
  await guardarEstado(subida, { usuarioId, capacitacionId: id, bytes });
  return NextResponse.json({ bytes });
}
