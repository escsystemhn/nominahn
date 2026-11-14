import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { actualizarCuenta, eliminarCuenta } from "@/lib/payroll/plan-cuentas";
import { schemaCuenta } from "../route";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("planillas.plan_cuentas");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schemaCuenta);
  if (!parsed.ok) return parsed.response;

  const antes = await prisma.cuentaContable.findUnique({ where: { id } });
  if (!antes) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  const r = await actualizarCuenta(prisma, id, parsed.data);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "CuentaContable",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { codigo: antes.codigo, nombre: antes.nombre, tipo: antes.tipo, naturaleza: antes.naturaleza, padreCodigo: antes.padreCodigo, esDetalle: antes.esDetalle, activa: antes.activa },
    valorNuevo: parsed.data,
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("planillas.plan_cuentas");
  if (!g.ok) return g.response;

  const { id } = await params;
  const antes = await prisma.cuentaContable.findUnique({ where: { id }, select: { codigo: true, nombre: true } });
  if (!antes) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  const r = await eliminarCuenta(prisma, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "CuentaContable",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes,
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true });
}
