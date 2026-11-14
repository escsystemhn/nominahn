/** Catálogo de tipos de deducción por plantilla, fase 2: APLICAR. */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { marcarAplicado, tomarLote } from "@/lib/importacion/lote";
import { CLASE_TIPO_DEDUCCION, aplicarTipos, type FilaTipo } from "@/lib/importacion/tipos-deduccion";
import type { ResultadoImportacion } from "@/lib/importacion/tipos";

const schema = z.object({ loteId: zId });

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const tomado = await tomarLote(prisma, parsed.data.loteId, "DEDUCCIONES", g.usuario.id);
  if (!tomado.ok) return NextResponse.json({ error: tomado.motivo }, { status: tomado.codigo });
  const filas = tomado.lote.filas as unknown as FilaTipo[];
  if (!Array.isArray(filas) || filas.length === 0 || !filas.every((f) => f?.clase === CLASE_TIPO_DEDUCCION)) {
    return NextResponse.json({ error: "Este archivo no es del catálogo de tipos de deducción." }, { status: 409 });
  }

  let resultado;
  try {
    resultado = await prisma.$transaction((tx) => aplicarTipos(tx, filas), { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    console.error("[importar/tipos-deduccion] falló la transacción", e);
    return NextResponse.json({ error: "No se pudo aplicar el archivo: el catálogo cambió mientras lo revisaba, o un código ya existe. No se guardó ningún cambio; vuelva a subirlo." }, { status: 409 });
  }
  await marcarAplicado(prisma, tomado.lote.id, resultado);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "IMPORT",
    tabla: "TipoDeduccionConfig",
    registroId: tomado.lote.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { archivo: tomado.lote.nombreArchivo, creados: resultado.creados, actualizados: resultado.actualizados, tipos: filas.map((f) => ({ ...f.datos, cambios: f.cambios })) },
    ip,
    userAgent,
  });

  const respuesta: ResultadoImportacion = {
    loteId: tomado.lote.id,
    creados: resultado.creados,
    actualizados: resultado.actualizados,
    omitidos: 0,
    mensaje: `${resultado.creados} tipo(s) de deducción creado(s) y ${resultado.actualizados} actualizado(s). Ya puede usarlos en Asignar y en el archivo de montos del período.`,
  };
  return NextResponse.json(respuesta);
}
