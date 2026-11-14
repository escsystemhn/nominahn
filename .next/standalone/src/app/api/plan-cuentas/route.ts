/**
 * Catálogo contable (plan de cuentas): listar y crear cuentas.
 *
 * La partida de cada planilla sale con las cuentas que aquí se definen y que
 * Configuración contable asigna a cada concepto. Los cambios quedan en
 * auditoría: afectan a todas las planillas, incluidas las ya emitidas, porque
 * la partida se genera al pedirla.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { listarCatalogo, crearCuenta } from "@/lib/payroll/plan-cuentas";
import { CODIGO_CUENTA } from "@/lib/payroll/catalogo-contable";

export const schemaCuenta = z.object({
  codigo: z.string().trim().min(1, "el código es obligatorio").max(20).regex(CODIGO_CUENTA, "sólo letras, números, punto, guión y guión bajo"),
  nombre: z.string().trim().min(1, "el nombre es obligatorio").max(120),
  descripcion: z.string().trim().max(500).optional().nullable(),
  tipo: z.enum(["ACTIVO", "PASIVO", "PATRIMONIO", "INGRESO", "COSTO", "GASTO"]),
  naturaleza: z.enum(["DEUDORA", "ACREEDORA"]),
  padreCodigo: z.string().trim().max(20).optional().nullable(),
  esDetalle: z.boolean(),
  activa: z.boolean().optional(),
});

export async function GET() {
  const g = await requerirPermiso(["planillas.plan_cuentas", "planillas.contabilidad"]);
  if (!g.ok) return g.response;
  return NextResponse.json({ cuentas: await listarCatalogo(prisma) });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("planillas.plan_cuentas");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schemaCuenta);
  if (!parsed.ok) return parsed.response;

  const r = await crearCuenta(prisma, parsed.data);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "CuentaContable",
    registroId: r.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: parsed.data,
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}
