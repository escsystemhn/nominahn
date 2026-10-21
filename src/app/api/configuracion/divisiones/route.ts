/**
 * Divisiones (Sucursal → División → Departamento). Sólo existen si el
 * administrador habilitó el nivel en Configuración → Estructura organizacional.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  codigo: z.string().trim().max(50).optional(),
  descripcion: z.string().trim().max(300).optional(),
  sucursalId: zId,
});

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["configuracion.ver", "configuracion.editar"]);
  if (!g.ok) return g.response;
  const sucursalId = req.nextUrl.searchParams.get("sucursalId");
  const divisiones = await prisma.division.findMany({
    where: sucursalId ? { sucursalId } : {},
    include: { _count: { select: { departamentos: true } } },
    orderBy: [{ sucursal: { nombre: "asc" } }, { nombre: "asc" }],
  });
  return NextResponse.json(divisiones);
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  if (!(await divisionesHabilitadas(prisma))) {
    return NextResponse.json({ error: "Las divisiones no están habilitadas. Actívelas en Configuración → Estructura organizacional." }, { status: 409 });
  }
  const sucursal = await prisma.sucursal.findUnique({ where: { id: d.sucursalId }, select: { id: true } });
  if (!sucursal) return NextResponse.json({ error: "La sucursal no existe." }, { status: 400 });

  try {
    const division = await prisma.division.create({
      data: { nombre: d.nombre, codigo: d.codigo || null, descripcion: d.descripcion || null, sucursalId: d.sucursalId },
    });
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "CREATE", tabla: "Division", registroId: division.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorNuevo: { nombre: division.nombre, codigo: division.codigo, sucursalId: division.sucursalId }, ip, userAgent,
    });
    return NextResponse.json(division, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: `Ya existe una división llamada «${d.nombre}» en esa sucursal.` }, { status: 409 });
    }
    throw e;
  }
}
