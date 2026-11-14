/**
 * Editar o borrar una plantilla. Las del sistema se editan (texto, título,
 * autoservicio, activa) pero no se borran ni cambian de tipo.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { variablesDesconocidas } from "@/lib/documentos/plantillas";
import { schemaPlantilla } from "@/lib/documentos/esquemas";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("documentos.plantillas");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaPlantilla);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const actual = await prisma.plantillaDocumento.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const desconocidas = variablesDesconocidas(d.contenido);
  if (desconocidas.length) {
    return NextResponse.json({ error: `Variables que no existen: ${desconocidas.join(", ")}` }, { status: 422 });
  }

  const p = await prisma.plantillaDocumento.update({
    where: { id },
    data: {
      nombre: d.nombre,
      titulo: d.titulo,
      contenido: d.contenido,
      tipo: actual.esSistema ? actual.tipo : d.tipo,
      autoservicio: d.autoservicio ?? actual.autoservicio,
      activo: d.activo ?? actual.activo,
      actualizadoPor: g.usuario.email ?? null,
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "PlantillaDocumento",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { titulo: actual.titulo, contenido: actual.contenido, autoservicio: actual.autoservicio, activo: actual.activo },
    valorNuevo: { titulo: p.titulo, contenido: p.contenido, autoservicio: p.autoservicio, activo: p.activo },
    ip,
    userAgent,
  });
  return NextResponse.json(p);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("documentos.plantillas");
  if (!g.ok) return g.response;
  const { id } = await params;
  const actual = await prisma.plantillaDocumento.findUnique({ where: { id }, include: { _count: { select: { emitidos: true } } } });
  if (!actual) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (actual.esSistema) return NextResponse.json({ error: "Una plantilla del sistema no se borra; puede desactivarla." }, { status: 409 });
  if (actual._count.emitidos > 0) {
    return NextResponse.json({ error: `Ya se emitieron ${actual._count.emitidos} documento(s) con esta plantilla; desactívela en lugar de borrarla.` }, { status: 409 });
  }
  await prisma.plantillaDocumento.delete({ where: { id } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "DELETE", tabla: "PlantillaDocumento", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { nombre: actual.nombre }, ip, userAgent });
  return NextResponse.json({ ok: true });
}
