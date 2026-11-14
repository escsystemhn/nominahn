/**
 * Fase 2 de la importación de horas extra: APLICAR.
 *
 * Estas horas se convierten en dinero en la siguiente planilla, así que la auditoría
 * registra el archivo y los marcajes que escribió: quién las cargó y con qué archivo.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { z } from "zod";
import { aplicar, type FilaHorasExtra } from "@/lib/importacion/horas-extra";
import { tomarLote, marcarAplicado } from "@/lib/importacion/lote";
import type { ResultadoImportacion } from "@/lib/importacion/tipos";

const schema = z.object({ loteId: zId });
const TIMEOUT_MS = 120_000;

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const tomado = await tomarLote(prisma, parsed.data.loteId, "HORAS_EXTRA", g.usuario.id);
  if (!tomado.ok) return NextResponse.json({ error: tomado.motivo }, { status: tomado.codigo });

  const filas = tomado.lote.filas as unknown as FilaHorasExtra[];
  if (!Array.isArray(filas) || filas.length === 0) {
    return NextResponse.json({ error: "El lote no tiene filas que aplicar." }, { status: 409 });
  }

  let resultado;
  try {
    resultado = await prisma.$transaction((tx) => aplicar(tx, filas), {
      timeout: TIMEOUT_MS,
      maxWait: 10_000,
    });
  } catch (e) {
    console.error("[importar/horas-extra] falló la transacción", e);
    return NextResponse.json(
      { error: "No se pudo aplicar la importación. No se guardó ningún cambio." },
      { status: 500 }
    );
  }

  await marcarAplicado(prisma, tomado.lote.id, resultado);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "IMPORT",
    tabla: "Marcaje",
    registroId: tomado.lote.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      archivo: tomado.lote.nombreArchivo,
      creados: resultado.creados,
      actualizados: resultado.actualizados,
      marcajes: resultado.ids,
    },
    ip,
    userAgent,
  });

  const respuesta: ResultadoImportacion = {
    loteId: tomado.lote.id,
    creados: resultado.creados,
    actualizados: resultado.actualizados,
    omitidos: 0,
  };
  return NextResponse.json(respuesta);
}
