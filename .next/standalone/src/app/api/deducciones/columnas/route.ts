/**
 * Columnas recordadas del archivo de montos del período: qué encabezado de la planilla
 * de la empresa corresponde a qué tipo de deducción («Ret. Plan Pensiones» → AFP-ATL).
 * Se asignan al importar y valen para las quincenas siguientes.
 *   GET                                   → { columnas: [{ cabecera, codigo }] }
 *   PUT { agregar?: [{ cabecera, codigo }], quitar?: [cabecera] }
 * Ver `leerEquivalencias` en `lib/importacion/montos-periodo.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { CLAVE_EQUIVALENCIAS, combinarEquivalencias, guardarEquivalencias, leerEquivalencias } from "@/lib/importacion/montos-periodo";

const schema = z.object({
  agregar: z.array(z.object({ cabecera: z.string().trim().min(1).max(120), codigo: z.string().trim().min(1).max(30) })).max(50).default([]),
  quitar: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
});

export async function GET() {
  const g = await requerirPermiso("deducciones.importar");
  if (!g.ok) return g.response;
  return NextResponse.json({ columnas: await leerEquivalencias(prisma) });
}

export async function PUT(req: NextRequest) {
  // Igual que crear tipos desde el archivo: cambia cómo se leerán los archivos de todos.
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { agregar, quitar } = parsed.data;
  if (agregar.length === 0 && quitar.length === 0) return NextResponse.json({ error: "No hay columnas que cambiar." }, { status: 400 });

  // Sólo a tipos que pueden llevar monto del período: activos y no de ley.
  const codigos = [...new Set(agregar.map((e) => e.codigo))];
  const tipos = await prisma.tipoDeduccionConfig.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true, activo: true, esLegal: true } });
  for (const codigo of codigos) {
    const t = tipos.find((x) => x.codigo === codigo);
    if (!t) return NextResponse.json({ error: `No existe el tipo de deducción «${codigo}».` }, { status: 400 });
    if (t.esLegal) return NextResponse.json({ error: `«${codigo}» es de ley: lo calcula la planilla.` }, { status: 400 });
    if (!t.activo) return NextResponse.json({ error: `El tipo «${codigo}» está desactivado.` }, { status: 400 });
  }

  const antes = await leerEquivalencias(prisma);
  const despues = combinarEquivalencias(antes, agregar, quitar);
  await guardarEquivalencias(prisma, despues);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: CLAVE_EQUIVALENCIAS,
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: antes, valorNuevo: { agregar, quitar }, ip, userAgent,
  });
  return NextResponse.json({ columnas: despues });
}
