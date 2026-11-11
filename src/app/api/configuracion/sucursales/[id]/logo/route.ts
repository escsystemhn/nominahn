/**
 * Logo de una sucursal. Lo cambia quien edita las sucursales, y lo ve quien
 * consulta la configuración; a los comprobantes llega incrustado, no por esta ruta.
 *
 * El cuerpo es el PNG tal cual, ya preparado por la pantalla: ver `lib/organizacion/logo.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { LOGO_MAX_BYTES, revisarPngDeLogo } from "@/lib/organizacion/logo";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Contexto) {
  const g = await requerirPermiso(["configuracion.ver", "configuracion.editar"]);
  if (!g.ok) return g.response;

  const { id } = await params;
  const logo = await prisma.logoSucursal.findUnique({ where: { sucursalId: id }, select: { png: true } });
  if (!logo) return NextResponse.json({ error: "Esta sucursal no tiene logo." }, { status: 404 });

  return new NextResponse(new Uint8Array(logo.png), { headers: { "Content-Type": "image/png" } });
}

export async function PUT(req: NextRequest, { params }: Contexto) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const sucursal = await prisma.sucursal.findUnique({ where: { id }, select: { id: true, logo: { select: { ancho: true, alto: true } } } });
  if (!sucursal) return NextResponse.json({ error: "La sucursal no existe." }, { status: 404 });

  // Antes de leerlo: lo que ya se anuncia demasiado grande no se carga en memoria.
  if (Number(req.headers.get("content-length") ?? 0) > LOGO_MAX_BYTES) {
    return NextResponse.json({ error: `El logo no puede pesar más de ${Math.round(LOGO_MAX_BYTES / 1024)} KB.` }, { status: 413 });
  }
  const png = new Uint8Array(await req.arrayBuffer());
  const revision = revisarPngDeLogo(png);
  if (!revision.ok) return NextResponse.json({ error: revision.error }, { status: 422 });

  const datos = { png, ancho: revision.ancho, alto: revision.alto };
  const logo = await prisma.logoSucursal.upsert({
    where: { sucursalId: id },
    create: { sucursalId: id, ...datos },
    update: datos,
    select: { ancho: true, alto: true, updatedAt: true },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Sucursal", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { logo: sucursal.logo ? `${sucursal.logo.ancho} × ${sucursal.logo.alto}` : null },
    valorNuevo: { logo: `${logo.ancho} × ${logo.alto}`, bytes: png.length },
    ip, userAgent,
  });
  return NextResponse.json(logo);
}

export async function DELETE(req: NextRequest, { params }: Contexto) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const { count } = await prisma.logoSucursal.deleteMany({ where: { sucursalId: id } });
  if (count === 0) return NextResponse.json({ error: "Esta sucursal no tiene logo." }, { status: 404 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Sucursal", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { logo: true }, valorNuevo: { logo: null },
    ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
