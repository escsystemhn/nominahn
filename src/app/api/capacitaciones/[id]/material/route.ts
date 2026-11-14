/**
 * Material de una capacitación.
 *
 *   GET  → la lista (quien administra capacitaciones, o quien está inscrito)
 *   POST → subir un archivo: el CUERPO es el archivo tal cual (no multipart), con
 *          `x-titulo` (codificado con encodeURIComponent) y, si se quiere, `x-tipo`.
 *          Se escribe a disco a medida que llega: un video de 500 MB no pasa por memoria.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, rename, unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { puede, requerirPermiso, requerirSesion } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { filtroCapacitaciones } from "@/lib/capacitaciones/alcance";
import { directorioMaterial, formatoPorFirma, maxBytesMaterial, tipoSugerido, type FormatoMaterial, type TipoMaterial } from "@/lib/capacitaciones/material";

type Params = { params: Promise<{ id: string }> };
const TIPOS: TipoMaterial[] = ["MANUAL", "VIDEO", "DOCUMENTO"];

export async function GET(_req: NextRequest, { params }: Params) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const { id } = await params;

  const gestiona =
    puede(g.usuario, "talento.capacitaciones") &&
    (await prisma.capacitacion.count({ where: { AND: [{ id }, filtroCapacitaciones(g.usuario)] } })) > 0;
  const inscrito =
    !!g.usuario.empleadoId &&
    (await prisma.participanteCapacitacion.count({ where: { capacitacionId: id, empleadoId: g.usuario.empleadoId, capacitacion: { estado: { not: "CANCELADA" } } } })) > 0;
  if (!gestiona && !inscrito) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const [materiales, inscritos] = await Promise.all([
    prisma.materialCapacitacion.findMany({
      where: { capacitacionId: id },
      select: {
        id: true, titulo: true, descripcion: true, tipo: true, mime: true, tamano: true, orden: true, createdAt: true,
        // Quien administra ve cuántos lo abrieron; el participante, si él ya lo abrió.
        _count: { select: { vistas: true } },
        vistas: { where: { empleadoId: g.usuario.empleadoId ?? "-" }, select: { ultimaVez: true } },
      },
      orderBy: [{ orden: "asc" }, { createdAt: "asc" }],
    }),
    gestiona ? prisma.participanteCapacitacion.count({ where: { capacitacionId: id } }) : Promise.resolve(0),
  ]);
  return NextResponse.json(
    materiales.map(({ _count, vistas, ...m }) => ({
      ...m,
      vistoPorMi: vistas[0]?.ultimaVez ?? null,
      ...(gestiona ? { vistos: _count.vistas, inscritos } : {}),
    }))
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("talento.capacitaciones_gestionar");
  if (!g.ok) return g.response;
  const { id } = await params;
  if (!(await prisma.capacitacion.count({ where: { AND: [{ id }, filtroCapacitaciones(g.usuario)] } }))) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const titulo = decodeURIComponent(req.headers.get("x-titulo") ?? "").trim().slice(0, 200);
  if (!titulo) return NextResponse.json({ error: "Ponga un título al material." }, { status: 400 });
  const tipoPedido = (req.headers.get("x-tipo") ?? "").toUpperCase() as TipoMaterial;
  const max = maxBytesMaterial();
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > max) return NextResponse.json({ error: `El archivo pasa del máximo de ${Math.round(max / 1024 / 1024)} MB.` }, { status: 413 });
  if (!req.body) return NextResponse.json({ error: "No llegó ningún archivo." }, { status: 400 });

  const dir = directorioMaterial();
  await mkdir(dir, { recursive: true });
  const base = randomUUID();
  const temporal = path.join(dir, `${base}.subiendo`);
  const salida = createWriteStream(temporal);
  const escribir = (trozo: Uint8Array) =>
    new Promise<void>((ok, mal) => salida.write(trozo, (e) => (e ? mal(e) : ok())));

  let formato: FormatoMaterial | null = null;
  let cabeza = new Uint8Array(0);
  let total = 0;
  const fallar = async (status: number, error: string) => {
    // En Windows el archivo no se puede borrar mientras siga abierto: primero se cierra.
    if (!salida.closed) await new Promise<void>((listo) => salida.once("close", () => listo()).destroy());
    await unlink(temporal).catch(() => {});
    return NextResponse.json({ error }, { status });
  };

  try {
    const lector = req.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await lector.cancel();
        return fallar(413, `El archivo pasa del máximo de ${Math.round(max / 1024 / 1024)} MB.`);
      }
      // El formato se decide con los primeros bytes, antes de seguir escribiendo.
      if (!formato) {
        cabeza = new Uint8Array([...cabeza, ...value.subarray(0, Math.max(0, 16 - cabeza.length))]);
        if (cabeza.length >= 16 || done) {
          formato = formatoPorFirma(cabeza);
          if (!formato) {
            await lector.cancel();
            return fallar(415, "Sólo se aceptan PDF, videos MP4 o WebM e imágenes PNG o JPG. Un documento de Word o PowerPoint, guárdelo como PDF.");
          }
        }
      }
      await escribir(value);
    }
    await new Promise<void>((ok) => salida.end(ok));
  } catch {
    return fallar(500, "No se pudo guardar el archivo.");
  }
  if (!formato) formato = formatoPorFirma(cabeza);
  if (!formato || total === 0) return fallar(415, "El archivo está vacío o no es de un formato aceptado.");

  const archivo = `${base}${formato.ext}`;
  await rename(temporal, path.join(dir, archivo));
  const ultimo = await prisma.materialCapacitacion.aggregate({ where: { capacitacionId: id }, _max: { orden: true } });
  const material = await prisma.materialCapacitacion.create({
    data: {
      capacitacionId: id,
      titulo,
      tipo: TIPOS.includes(tipoPedido) ? tipoPedido : tipoSugerido(formato),
      archivo,
      mime: formato.mime,
      tamano: total,
      orden: (ultimo._max.orden ?? -1) + 1,
      subidoPor: g.usuario.id ?? null,
    },
    select: { id: true, titulo: true, tipo: true, mime: true, tamano: true, orden: true },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "MaterialCapacitacion",
    registroId: material.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { capacitacionId: id, titulo, mime: formato.mime, tamano: total },
    ip,
    userAgent,
  });
  return NextResponse.json(material, { status: 201 });
}
