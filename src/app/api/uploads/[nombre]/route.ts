import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requerirSesion, puede } from "@/lib/auth/guard";
import { directorioUploads, nombreArchivoValido, tipoContenido } from "@/lib/uploads";

/**
 * GET: entrega un archivo subido.
 *
 * AUTORIZACIÓN POR RECURSO: antes bastaba con tener sesión de cualquier rol, de
 * modo que cualquier usuario autenticado podía descargar el currículo, el
 * contrato o la copia de identidad de cualquier otro. La única protección real
 * era que el nombre fuese difícil de adivinar.
 *
 * Ahora el archivo se resuelve contra su dueño mediante el modelo `Documento`
 * (que ya tenía `empleadoId` y `archivoUrl`): sólo lo bajan quien administra
 * expedientes y el propio empleado. El CV de un candidato lo bajan además
 * quienes llevan el reclutamiento. Un archivo sin registro asociado —adjunto de
 * política— queda restringido a los roles de expediente.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ nombre: string }> }) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;

  const { nombre } = await params;
  // Anti path-traversal: sólo se acepta el patrón UUID+extensión.
  if (!nombreArchivoValido(nombre)) {
    return NextResponse.json({ error: "Nombre de archivo inválido" }, { status: 400 });
  }

  // Un certificado de incapacidad es dato de salud: no basta con ver datos
  // personales. Lo bajan quien gestiona incapacidades, quien ve fichas
  // médicas y el propio empleado.
  const certificado = await prisma.incapacidad.findFirst({
    where: { archivoUrl: { contains: nombre } },
    select: { empleadoId: true },
  });
  if (certificado) {
    const permitido =
      puede(g.usuario, "asistencia.incapacidades") ||
      puede(g.usuario, "empleados.salud") ||
      (!!g.usuario.empleadoId && certificado.empleadoId === g.usuario.empleadoId);
    if (!permitido) return NextResponse.json({ error: "Permiso insuficiente" }, { status: 403 });
  }

  // El currículo de un candidato lo baja quien lleva el reclutamiento, aunque
  // no vea datos personales de los empleados.
  const curriculo = certificado
    ? null
    : await prisma.candidato.findFirst({ where: { cvUrl: { contains: nombre } }, select: { id: true } });
  if (curriculo && !puede(g.usuario, "talento.reclutamiento") && !puede(g.usuario, "empleados.pii")) {
    return NextResponse.json({ error: "Permiso insuficiente" }, { status: 403 });
  }

  const esAdmin = !!certificado || !!curriculo || puede(g.usuario, "empleados.pii");
  if (!esAdmin) {
    // El documento debe estar registrado Y pertenecer a quien lo pide.
    const documento = await prisma.documento.findFirst({
      where: { archivoUrl: { contains: nombre } },
      select: { empleadoId: true },
    });

    const esPropio =
      !!documento && !!g.usuario.empleadoId && documento.empleadoId === g.usuario.empleadoId;

    if (!esPropio) {
      return NextResponse.json({ error: "Permiso insuficiente" }, { status: 403 });
    }
  }

  const ruta = path.join(directorioUploads(), path.basename(nombre));
  let contenido: Buffer;
  try {
    contenido = await readFile(ruta);
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(contenido), {
    headers: {
      "Content-Type": tipoContenido(nombre),
      "Content-Disposition": `inline; filename="${nombre}"`,
      // El navegador no debe reinterpretar el tipo ni ejecutar nada del archivo.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Documento privado: nunca cachear en intermediarios compartidos.
      "Cache-Control": "private, no-store",
    },
  });
}
