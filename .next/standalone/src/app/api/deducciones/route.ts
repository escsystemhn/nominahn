/**
 * Catálogo de tipos de deducción.
 *   GET  → todos
 *   POST → uno nuevo { nombre, codigo, tipo, montoFijo?, descripcion? }
 *
 * Hasta el 2026-11-11 la ventana «Nuevo tipo» mandaba `null` en los campos vacíos y el
 * esquema lo rechazaba: no se podía crear ningún tipo sin porcentaje ni monto. Ahora
 * la validación es la de `lib/deducciones/tipos-bd.ts`, con mensajes en palabras, y no
 * se crean tipos de ley ni de impuesto (los maneja Parámetros de ley).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { conflictosDeTipos, datosParaCrear, leerDatosTipo } from "@/lib/deducciones/tipos-bd";

export async function GET() {
  const g = await requerirPermiso("deducciones.ver");
  if (!g.ok) return g.response;

  const tipos = await prisma.tipoDeduccionConfig.findMany({
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json(tipos);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;

  const cuerpo = await req.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object") return NextResponse.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  const datos = leerDatosTipo(cuerpo as Record<string, unknown>);
  if (!datos.ok) return NextResponse.json({ error: datos.error }, { status: 400 });
  const conflicto = await conflictosDeTipos(prisma, [datos.valor]);
  if (conflicto) return NextResponse.json({ error: conflicto }, { status: 409 });

  const deduccion = await prisma.tipoDeduccionConfig.create({ data: datosParaCrear(datos.valor) });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "TipoDeduccionConfig",
    registroId: deduccion.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { ...datos.valor },
    ip,
    userAgent,
  });

  return NextResponse.json(deduccion, { status: 201 });
}
