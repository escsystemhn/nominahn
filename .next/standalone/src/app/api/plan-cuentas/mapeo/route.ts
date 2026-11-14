/**
 * Configuración contable: qué cuenta del catálogo recibe cada concepto de la
 * nómina. Cada asignación se guarda al instante y queda en auditoría con el
 * antes y el después, porque cambia la partida de TODAS las planillas.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import {
  cargarMapeoCompleto,
  listarCuentasAsignables,
  asignarCuenta,
  restablecerMapeo,
} from "@/lib/payroll/plan-cuentas";

const schema = z.object({
  clave: z.string().trim().min(1),
  /** `null` quita la cuenta; ausente con `restablecer` vuelve a la de ejemplo. */
  cuentaId: z.string().trim().min(1).nullable().optional(),
  restablecer: z.boolean().optional(),
});

export async function GET() {
  const g = await requerirPermiso(["planillas.plan_cuentas", "planillas.contabilidad"]);
  if (!g.ok) return g.response;
  const [conceptos, cuentas] = await Promise.all([cargarMapeoCompleto(prisma), listarCuentasAsignables(prisma)]);
  return NextResponse.json({ conceptos, cuentas });
}

export async function PATCH(req: NextRequest) {
  const g = await requerirPermiso("planillas.plan_cuentas");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { clave, cuentaId, restablecer } = parsed.data;

  const antes = (await cargarMapeoCompleto(prisma)).find((c) => c.clave === clave);

  const r = restablecer ? await restablecerMapeo(prisma, clave) : await asignarCuenta(prisma, clave, cuentaId ?? null);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });

  const despues = (await cargarMapeoCompleto(prisma)).find((c) => c.clave === clave);
  const etiqueta = (c: typeof antes) => (c?.cuenta ? `${c.cuenta.codigo} ${c.cuenta.nombre}` : "(sin asignar)");

  if (etiqueta(antes) !== etiqueta(despues)) {
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE",
      tabla: "MapeoContable",
      registroId: clave,
      usuarioId: g.usuario.id,
      usuarioEmail: g.usuario.email ?? undefined,
      valorAnterior: { cuenta: etiqueta(antes) },
      valorNuevo: { cuenta: etiqueta(despues), restablecer: restablecer ?? false },
      ip,
      userAgent,
    });
  }

  return NextResponse.json({ ok: true, concepto: despues });
}
