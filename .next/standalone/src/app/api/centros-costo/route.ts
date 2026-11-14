/**
 * Centros de costo: la dimensión con la que la contabilidad reparte el gasto de
 * nómina entre las áreas.
 *
 * No son cuentas contables. La cuenta dice QUÉ es el gasto (5101 Sueldos); el
 * centro dice DÓNDE se imputa. `cuentaGasto` existe para las contabilidades que
 * prefieren abrir subcuenta por área (5101-01) en vez de llevar el centro como
 * dimensión aparte.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { z } from "zod";

const schema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, "requerido")
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "sólo letras, números, guión y guión bajo"),
  nombre: z.string().trim().min(1, "requerido").max(80),
  descripcion: z.string().trim().max(300).optional(),
  /**
   * Sufijo (`-01`) o cuenta completa (`610101`). Vacío = se usa la cuenta del
   * plan general y el centro viaja como dimensión separada.
   */
  cuentaGasto: z.string().trim().max(30).optional(),
});

export async function GET() {
  const g = await requerirPermiso(["organizacion.centros_costo", "organizacion.ver", "planillas.contabilidad"]);
  if (!g.ok) return g.response;

  const centros = await prisma.centroCosto.findMany({
    orderBy: [{ activo: "desc" }, { codigo: "asc" }],
    include: {
      _count: { select: { departamentos: true, empleados: true } },
    },
  });

  return NextResponse.json({ centros });
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("organizacion.centros_costo");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { codigo, nombre, descripcion, cuentaGasto } = parsed.data;

  const codigoNormalizado = codigo.toUpperCase();
  const yaExiste = await prisma.centroCosto.findUnique({
    where: { codigo: codigoNormalizado },
    select: { id: true },
  });
  if (yaExiste) {
    return NextResponse.json({ error: "Ya existe un centro de costo con ese código." }, { status: 409 });
  }

  const centro = await prisma.centroCosto.create({
    data: { codigo: codigoNormalizado, nombre, descripcion, cuentaGasto: cuentaGasto || null },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "CentroCosto",
    registroId: centro.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { codigo: centro.codigo, nombre, cuentaGasto: centro.cuentaGasto },
    ip,
    userAgent,
  });

  return NextResponse.json({ centro }, { status: 201 });
}
