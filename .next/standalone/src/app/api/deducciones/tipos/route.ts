/**
 * Crear varios tipos de deducción a la vez: los que faltan al importar el archivo de
 * montos del período (una columna nueva = un tipo nuevo). Todo o nada.
 *   POST { tipos: [{ nombre, codigo, tipo }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { conflictosDeTipos, datosParaCrear, leerDatosTipo, type DatosTipo } from "@/lib/deducciones/tipos-bd";

const MAXIMO = 50;

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;

  const cuerpo = (await req.json().catch(() => null)) as { tipos?: unknown } | null;
  const lista = Array.isArray(cuerpo?.tipos) ? (cuerpo!.tipos as Record<string, unknown>[]) : null;
  if (!lista || lista.length === 0) return NextResponse.json({ error: "No hay tipos que crear." }, { status: 400 });
  if (lista.length > MAXIMO) return NextResponse.json({ error: `Son más de ${MAXIMO} tipos a la vez.` }, { status: 400 });

  const datos: DatosTipo[] = [];
  for (const t of lista) {
    const r = leerDatosTipo(t ?? {});
    if (!r.ok) return NextResponse.json({ error: `«${String(t?.nombre ?? "")}»: ${r.error}` }, { status: 400 });
    datos.push(r.valor);
  }
  const conflicto = await conflictosDeTipos(prisma, datos);
  if (conflicto) return NextResponse.json({ error: conflicto }, { status: 409 });

  const creados = await prisma.$transaction(datos.map((d) => prisma.tipoDeduccionConfig.create({ data: datosParaCrear(d), select: { id: true, codigo: true, nombre: true } })));

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "TipoDeduccionConfig",
    registroId: `varios:${creados.length}`,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { desdeArchivo: true, tipos: datos },
    ip,
    userAgent,
  });

  return NextResponse.json({ creados }, { status: 201 });
}
