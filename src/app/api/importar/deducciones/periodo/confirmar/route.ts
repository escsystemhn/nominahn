/**
 * Montos del período, fase 2: APLICAR.
 *
 * La auditoría guarda cada celda que cambió con su valor anterior y el nuevo: es el
 * registro de qué se pidió descontar en cada período, aunque luego se corrija.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { marcarAplicado, tomarLote } from "@/lib/importacion/lote";
import { CLASE_MONTO_PERIODO, ErrorMontos, aplicarMontos, type OperacionMonto } from "@/lib/importacion/montos-periodo";
import { frasePeriodo, type PeriodoPlanilla } from "@/lib/payroll/periodos-planilla";
import type { ResultadoImportacion } from "@/lib/importacion/tipos";

const schema = z.object({ loteId: zId });

type FilaLote = OperacionMonto & PeriodoPlanilla;

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.importar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const tomado = await tomarLote(prisma, parsed.data.loteId, "DEDUCCIONES", g.usuario.id);
  if (!tomado.ok) return NextResponse.json({ error: tomado.motivo }, { status: tomado.codigo });

  const filas = tomado.lote.filas as unknown as FilaLote[];
  if (!Array.isArray(filas) || filas.length === 0 || !filas.every((f) => f?.clase === CLASE_MONTO_PERIODO)) {
    return NextResponse.json({ error: "Este archivo no es de montos del período." }, { status: 409 });
  }
  const periodo: PeriodoPlanilla = { tipo: filas[0].tipo, desde: filas[0].desde, hasta: filas[0].hasta };
  if (!filas.every((f) => f.desde === periodo.desde && f.hasta === periodo.hasta)) {
    return NextResponse.json({ error: "El lote mezcla períodos. Vuelva a subir el archivo." }, { status: 409 });
  }

  let resultado;
  try {
    resultado = await prisma.$transaction((tx) => aplicarMontos(tx, filas, periodo), { timeout: 120_000, maxWait: 10_000 });
  } catch (e) {
    if (e instanceof ErrorMontos) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("[importar/deducciones/periodo] falló la transacción", e);
    return NextResponse.json({ error: "No se pudo aplicar la importación. No se guardó ningún cambio." }, { status: 500 });
  }

  const resumen = { creados: resultado.creados, actualizados: resultado.actualizados, quitados: resultado.quitados };
  await marcarAplicado(prisma, tomado.lote.id, resumen);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "IMPORT",
    tabla: "DeduccionEmpleado",
    registroId: tomado.lote.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: {
      archivo: tomado.lote.nombreArchivo,
      montosDelPeriodo: periodo,
      ...resumen,
      cambios: filas.map((f) => ({ referencia: f.referencia, antes: f.antes, despues: f.despues })),
      deducciones: resultado.ids,
    },
    ip,
    userAgent,
  });

  // Con las palabras de la vista previa: lo que la persona vio, no la operación en la base.
  const nuevos = filas.filter((f) => Number(f.antes) === 0).length;
  const quitados = filas.filter((f) => Number(f.antes) !== 0 && Number(f.despues) === 0).length;
  const partes = [
    nuevos && `${nuevos} nuevo(s)`,
    filas.length - nuevos - quitados && `${filas.length - nuevos - quitados} cambiado(s)`,
    quitados && `${quitados} quitado(s)`,
  ].filter(Boolean);
  const respuesta: ResultadoImportacion = {
    loteId: tomado.lote.id,
    creados: resultado.creados,
    actualizados: resultado.actualizados + resultado.quitados,
    omitidos: 0,
    mensaje: `Montos ${frasePeriodo(periodo, "de")}: ${partes.join(", ") || "ningún cambio"}. Si la planilla del período ya existe, vuelva a calcularla.`,
  };
  return NextResponse.json(respuesta);
}
