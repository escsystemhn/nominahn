import { NextRequest, NextResponse } from "next/server";
import { requerirPermiso } from "@/lib/auth/guard";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { directorioUploads, extensionPermitida, maxBytes } from "@/lib/uploads";

// POST multipart/form-data con campo "file". Guarda el archivo en el directorio
// PRIVADO (fuera de public/) y devuelve la URL de descarga autenticada.
export async function POST(req: NextRequest) {
  // Sirve a tres flujos: documentos del expediente, CVs de candidatos y
  // certificados de incapacidad.
  const g = await requerirPermiso(["empleados.editar", "talento.reclutamiento", "asistencia.incapacidades"]);
  if (!g.ok) return g.response;

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
  }

  if (file.size === 0) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  if (file.size > maxBytes()) {
    return NextResponse.json({ error: "El archivo supera el límite permitido" }, { status: 400 });
  }

  const ext = path.extname(file.name || "").toLowerCase();
  if (!extensionPermitida(ext)) {
    return NextResponse.json({ error: `Tipo de archivo no permitido (${ext || "sin extensión"})` }, { status: 400 });
  }

  const nombre = `${randomUUID()}${ext}`;
  const dir = directorioUploads();
  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, nombre), buffer);

  // La URL apunta a la ruta autenticada, NO a un archivo estático de public/.
  return NextResponse.json({ url: `/api/uploads/${nombre}`, nombreOriginal: file.name }, { status: 201 });
}
