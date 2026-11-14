/**
 * Plantillas de documentos.
 *   GET  → plantillas (siembra las del sistema que falten), firmante y catálogo de variables
 *   POST → crear una plantilla propia
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { asegurarPlantillas } from "@/lib/documentos/emision";
import { leerFirmante } from "@/lib/documentos/firmante";
import { VARIABLES, variablesDesconocidas } from "@/lib/documentos/plantillas";
import { schemaPlantilla } from "@/lib/documentos/esquemas";


export async function GET() {
  const g = await requerirPermiso(["documentos.emitir", "documentos.plantillas"]);
  if (!g.ok) return g.response;
  await asegurarPlantillas(prisma);
  const [plantillas, firmante] = await Promise.all([
    prisma.plantillaDocumento.findMany({ orderBy: [{ esSistema: "desc" }, { nombre: "asc" }] }),
    leerFirmante(prisma),
  ]);
  return NextResponse.json({ plantillas, firmante, variables: VARIABLES });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("documentos.plantillas");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaPlantilla);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const desconocidas = variablesDesconocidas(d.contenido);
  if (desconocidas.length) {
    return NextResponse.json({ error: `Variables que no existen: ${desconocidas.join(", ")}` }, { status: 422 });
  }

  const codigo = `PROPIA_${Date.now().toString(36).toUpperCase()}`;
  const p = await prisma.plantillaDocumento.create({
    data: { ...d, codigo, autoservicio: d.autoservicio ?? false, activo: d.activo ?? true, esSistema: false, actualizadoPor: g.usuario.email ?? null },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "CREATE", tabla: "PlantillaDocumento", registroId: p.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: { nombre: d.nombre, tipo: d.tipo }, ip, userAgent });
  return NextResponse.json(p, { status: 201 });
}
