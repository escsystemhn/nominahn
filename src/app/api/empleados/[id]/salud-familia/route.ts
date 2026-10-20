/**
 * Ficha médica, familiares y beneficiarios de un empleado (expediente).
 *
 * Cada parte con su permiso:
 *   · ficha médica: `empleados.salud` (dato de salud, aparte del resto)
 *   · familiares y beneficiarios: ver con `empleados.pii`, editar con `empleados.editar`
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso, puede } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { leerSaludFamilia, guardarSaludFamilia, schemaSaludFamilia, ErrorSaludFamilia } from "@/lib/empleados/salud-familia";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso(["empleados.pii", "empleados.salud"]);
  if (!g.ok) return g.response;
  const { id } = await params;
  const salud = puede(g.usuario, "empleados.salud");
  const pii = puede(g.usuario, "empleados.pii");
  return NextResponse.json({
    ...(await leerSaludFamilia(prisma, id, { salud, familia: pii, beneficiarios: pii })),
    permisos: { salud, verFamilia: pii, editarFamilia: puede(g.usuario, "empleados.editar") },
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso(["empleados.editar", "empleados.salud"]);
  if (!g.ok) return g.response;
  const { id } = await params;
  const parsed = await parsearBody(req, schemaSaludFamilia);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  if (c.fichaMedica && !puede(g.usuario, "empleados.salud")) return NextResponse.json({ error: "No tiene permiso para la ficha médica" }, { status: 403 });
  if ((c.familiares || c.beneficiarios) && !puede(g.usuario, "empleados.editar")) return NextResponse.json({ error: "No tiene permiso para editar familiares" }, { status: 403 });
  if (!(await prisma.empleado.count({ where: { id } }))) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  try {
    await guardarSaludFamilia(prisma, id, c, g.usuario.email ?? null);
  } catch (e) {
    if (e instanceof ErrorSaludFamilia) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Empleado",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    // Del dato de salud sólo queda que cambió, no su contenido.
    valorNuevo: {
      seccion: "salud-familia",
      fichaMedica: c.fichaMedica ? "actualizada" : undefined,
      familiares: c.familiares?.length,
      beneficiarios: c.beneficiarios?.map((b) => ({ nombre: b.nombre, porcentaje: b.porcentaje })),
    },
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true });
}
