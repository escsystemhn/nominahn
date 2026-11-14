/**
 * Formatos de archivo para el banco.
 *   GET  → formatos (siembra el genérico si no hay ninguno)
 *   POST → crear un formato
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { validarFormato } from "@/lib/payroll/archivo-banco";
import { schemaFormatoBanco, aFormato, asegurarFormatos } from "@/lib/payroll/archivo-banco-bd";
import { CAMPOS_BANCO } from "@/lib/payroll/archivo-banco";

export async function GET() {
  const g = await requerirPermiso(["configuracion.editar", "planillas.pagar", "prestaciones.pagar"]);
  if (!g.ok) return g.response;
  await asegurarFormatos(prisma);
  const formatos = await prisma.formatoBanco.findMany({ orderBy: [{ esSistema: "desc" }, { nombre: "asc" }] });
  return NextResponse.json({ formatos, campos: CAMPOS_BANCO });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaFormatoBanco);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const errores = validarFormato(aFormato({ ...d, columnas: d.columnas as unknown as never, filtroBanco: d.filtroBanco ?? null }));
  if (errores.length) return NextResponse.json({ error: errores.join(" ") }, { status: 422 });
  const f = await prisma.formatoBanco.create({
    data: { ...d, filtroBanco: d.filtroBanco || null, columnas: d.columnas as unknown as object, activo: d.activo ?? true, actualizadoPor: g.usuario.email ?? null },
  });
  const { ip, userAgent } = getClientInfo(req);
  await audit({ accion: "CREATE", tabla: "FormatoBanco", registroId: f.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorNuevo: d, ip, userAgent });
  return NextResponse.json(f, { status: 201 });
}
