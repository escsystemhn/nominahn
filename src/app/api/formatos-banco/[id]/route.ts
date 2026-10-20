/** Editar o borrar un formato de archivo bancario. El genérico no se borra. */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { validarFormato } from "@/lib/payroll/archivo-banco";
import { schemaFormatoBanco, aFormato } from "@/lib/payroll/archivo-banco-bd";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaFormatoBanco);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const actual = await prisma.formatoBanco.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const errores = validarFormato(aFormato({ ...d, columnas: d.columnas as unknown as never, filtroBanco: d.filtroBanco ?? null }));
  if (errores.length) return NextResponse.json({ error: errores.join(" ") }, { status: 422 });
  const f = await prisma.formatoBanco.update({
    where: { id },
    data: { ...d, filtroBanco: d.filtroBanco || null, columnas: d.columnas as unknown as object, activo: d.activo ?? actual.activo, actualizadoPor: g.usuario.email ?? null },
  });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "UPDATE", tabla: "FormatoBanco", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { nombre: actual.nombre, columnas: actual.columnas }, valorNuevo: d, ip, userAgent });
  return NextResponse.json(f);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;
  const { id } = await params;
  const actual = await prisma.formatoBanco.findUnique({ where: { id } });
  if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (actual.esSistema) return NextResponse.json({ error: "El formato genérico no se borra; puede desactivarlo." }, { status: 409 });
  await prisma.formatoBanco.delete({ where: { id } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "DELETE", tabla: "FormatoBanco", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { nombre: actual.nombre }, ip, userAgent });
  return NextResponse.json({ ok: true });
}
