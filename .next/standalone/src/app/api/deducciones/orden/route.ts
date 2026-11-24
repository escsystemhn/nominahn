/**
 * Orden de las columnas de deducción de la planilla, en pantalla y al imprimir (ver
 * `lib/deducciones/orden-columnas.ts`). Uno solo para toda la empresa.
 *   GET    → { tipos: [{ codigo, nombre }] en el orden que rige, origen }
 *   PUT    { codigos: string[] } → lo guarda
 *   DELETE → quita el guardado: vuelve al del formato por sucursal o, si no hay, por nombre
 * Lo cambia quien configura deducciones: afecta lo que ven e imprimen todos.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CLAVE_ORDEN_DEDUCCIONES, FUERA_DEL_ORDEN, guardarOrden, ordenDeDeducciones, ordenarTipos, quitarOrden } from "@/lib/deducciones/orden-columnas";

export async function GET() {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;
  const [tipos, orden] = await Promise.all([
    prisma.tipoDeduccionConfig.findMany({
      where: { activo: true, esLegal: false, codigo: { notIn: [...FUERA_DEL_ORDEN] } },
      select: { codigo: true, nombre: true },
    }),
    ordenDeDeducciones(prisma),
  ]);
  return NextResponse.json({ tipos: ordenarTipos(tipos, orden.codigos), origen: orden.origen });
}

const schema = z.object({ codigos: z.array(z.string().trim().min(1).max(30)).min(1, "No hay deducciones que ordenar.").max(300) });

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const codigos = [...new Set(parsed.data.codigos)].filter((c) => !FUERA_DEL_ORDEN.has(c));
  const existentes = new Set((await prisma.tipoDeduccionConfig.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true } })).map((t) => t.codigo));
  const desconocido = codigos.find((c) => !existentes.has(c));
  if (desconocido) return NextResponse.json({ error: `«${desconocido}» no es un tipo de deducción.` }, { status: 400 });

  const antes = await ordenDeDeducciones(prisma);
  await guardarOrden(prisma, codigos);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_ORDEN_DEDUCCIONES,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { codigos: antes.codigos, origen: antes.origen }, valorNuevo: { codigos }, ip, userAgent,
  });
  return NextResponse.json({ codigos });
}

export async function DELETE(req: NextRequest) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;
  const antes = await ordenDeDeducciones(prisma);
  const quitado = await quitarOrden(prisma);
  if (quitado) {
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "DELETE", tabla: "ConfiguracionSistema", registroId: CLAVE_ORDEN_DEDUCCIONES,
      usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined, valorAnterior: { codigos: antes.codigos }, ip, userAgent,
    });
  }
  return NextResponse.json({ quitado, origen: (await ordenDeDeducciones(prisma)).origen });
}
