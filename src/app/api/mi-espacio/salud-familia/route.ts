/**
 * El empleado mantiene su ficha médica y sus familiares. Ve sus beneficiarios
 * pero no los cambia: esa designación la registra Recursos Humanos con el
 * formulario firmado.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { leerSaludFamilia, guardarSaludFamilia, schemaSaludFamilia } from "@/lib/empleados/salud-familia";

export async function GET() {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ error: "Su usuario no está vinculado a un empleado." }, { status: 400 });
  return NextResponse.json({
    ...(await leerSaludFamilia(prisma, empleadoId, { salud: true, familia: true, beneficiarios: true })),
    permisos: { salud: true, verFamilia: true, editarFamilia: true, editarBeneficiarios: false },
  });
}

export async function PUT(req: NextRequest) {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId ?? null;
  if (!empleadoId) return NextResponse.json({ error: "Su usuario no está vinculado a un empleado." }, { status: 400 });
  const parsed = await parsearBody(req, schemaSaludFamilia);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.beneficiarios) return NextResponse.json({ error: "Los beneficiarios los registra Recursos Humanos." }, { status: 403 });
  await guardarSaludFamilia(prisma, empleadoId, parsed.data, g.usuario.email ?? null);
  return NextResponse.json({ ok: true });
}
