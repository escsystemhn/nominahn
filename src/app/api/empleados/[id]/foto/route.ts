/**
 * Foto del empleado.
 *   GET    → la imagen (JPEG). La ve el propio empleado (Mi espacio) y quien ve empleados,
 *            el organigrama o las evaluaciones, dentro de su alcance.
 *   PUT    → cuerpo: el JPEG ya preparado por la pantalla (`lib/empleados/foto-navegador.ts`).
 *            Sólo con `empleados.editar` (o `empleados.crear`, para la recién registrada).
 *   DELETE → la quita.
 *
 * Se guarda en la base (tabla FotoEmpleado), revisada y SIN metadatos: ver `lib/empleados/foto.ts`.
 * La bitácora anota quién la cambió, nunca los bytes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { puedeAlguno, requerirPermiso, requerirSesion } from "@/lib/auth/guard";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { audit, getClientInfo } from "@/lib/audit";
import { FOTO_MAX_BYTES, limpiarJpeg, revisarJpegDeFoto } from "@/lib/empleados/foto";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Contexto) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const { id } = await params;
  const esPropia = !!g.usuario.empleadoId && g.usuario.empleadoId === id;
  if (!esPropia) {
    if (!puedeAlguno(g.usuario, ["empleados.ver", "organizacion.ver", "talento.evaluaciones_ver"])) {
      return NextResponse.json({ error: "Permiso insuficiente" }, { status: 403 });
    }
    if (!(await empleadoAlAlcance(g.usuario, id))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const foto = await prisma.fotoEmpleado.findUnique({ where: { empleadoId: id }, select: { jpeg: true, updatedAt: true } });
  if (!foto) return NextResponse.json({ error: "Sin foto" }, { status: 404 });
  return new NextResponse(new Uint8Array(foto.jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      // La URL lleva la versión (?v=): puede quedarse en la caché del navegador, nunca en una compartida.
      "Cache-Control": "private, max-age=86400",
      "Last-Modified": foto.updatedAt.toUTCString(),
    },
  });
}

export async function PUT(req: NextRequest, { params }: Contexto) {
  const g = await requerirPermiso(["empleados.editar", "empleados.crear"]);
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!(await empleadoAlAlcance(g.usuario, id))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Lo que ya se anuncia demasiado grande no se carga en memoria.
  if (Number(req.headers.get("content-length") ?? 0) > FOTO_MAX_BYTES) {
    return NextResponse.json({ error: `La foto no puede pesar más de ${Math.round(FOTO_MAX_BYTES / 1024)} KB.` }, { status: 413 });
  }
  const crudo = new Uint8Array(await req.arrayBuffer());
  const revision = revisarJpegDeFoto(crudo);
  if (!revision.ok) return NextResponse.json({ error: revision.error }, { status: 400 });
  let jpeg: Uint8Array;
  try {
    jpeg = limpiarJpeg(crudo);
  } catch {
    return NextResponse.json({ error: "La foto está dañada." }, { status: 400 });
  }

  const antes = await prisma.fotoEmpleado.findUnique({ where: { empleadoId: id }, select: { lado: true } });
  const datos = { jpeg: Buffer.from(jpeg), lado: revision.lado };
  const foto = await prisma.fotoEmpleado.upsert({ where: { empleadoId: id }, update: datos, create: { empleadoId: id, ...datos }, select: { updatedAt: true } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: antes ? "UPDATE" : "CREATE", tabla: "FotoEmpleado", registroId: id,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes ? { lado: antes.lado } : undefined,
    valorNuevo: { lado: revision.lado, bytes: jpeg.length, metadatosQuitados: crudo.length - jpeg.length },
    ip, userAgent,
  });
  return NextResponse.json({ version: foto.updatedAt.getTime() });
}

export async function DELETE(req: NextRequest, { params }: Contexto) {
  const g = await requerirPermiso("empleados.editar");
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!(await empleadoAlAlcance(g.usuario, id))) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const borradas = await prisma.fotoEmpleado.deleteMany({ where: { empleadoId: id } });
  if (borradas.count) {
    const { ip, userAgent } = getClientInfo(req);
    await audit({ accion: "DELETE", tabla: "FotoEmpleado", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, ip, userAgent });
  }
  return NextResponse.json({ ok: true });
}
