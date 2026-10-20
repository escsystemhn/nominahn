import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { parsearBody, zFraccion, zMontoPositivo } from "@/lib/http/validar";
import { TipoDeduccion } from "@prisma/client";

const schema = z.object({
  nombre: z.string().trim().min(1),
  codigo: z.string().trim().min(1),
  tipo: z.enum(TipoDeduccion),
  porcentaje: zFraccion.optional(),          // 0.025 = 2.5%
  montoFijo: zMontoPositivo.optional(),
  aplicaEmpleado: z.boolean().optional(),
  aplicaEmpleador: z.boolean().optional(),
  porcentajeEmpleador: zFraccion.optional(),
  topeMaximo: zMontoPositivo.optional(),
  esLegal: z.boolean().optional(),
  descripcion: z.string().trim().max(500).optional(),
});

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

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { nombre, codigo, tipo, porcentaje, montoFijo, aplicaEmpleado, aplicaEmpleador,
    porcentajeEmpleador, topeMaximo, esLegal, descripcion } = parsed.data;

  const deduccion = await prisma.tipoDeduccionConfig.create({
    data: {
      nombre,
      codigo: codigo.toUpperCase(),
      tipo,
      porcentaje: porcentaje ?? null,
      montoFijo: montoFijo ?? null,
      aplicaEmpleado: aplicaEmpleado ?? true,
      aplicaEmpleador: aplicaEmpleador ?? false,
      porcentajeEmpleador: porcentajeEmpleador ?? null,
      topeMaximo: topeMaximo ?? null,
      esLegal: esLegal ?? false,
      descripcion,
    },
  });

  // Un tipo de deducción legal (IHSS, RAP, INFOP) altera el cálculo de TODA la
  // plantilla: es de los cambios que más importa poder rastrear.
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "TipoDeduccionConfig",
    registroId: deduccion.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      nombre, codigo: deduccion.codigo, tipo, porcentaje, porcentajeEmpleador,
      montoFijo, topeMaximo, esLegal,
    },
    ip,
    userAgent,
  });

  return NextResponse.json(deduccion, { status: 201 });
}
