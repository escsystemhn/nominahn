/**
 * Fase 2 de la importación de un plan de horarios: APLICAR. Escribe los días y crea los
 * traslados temporales en una transacción, y deja el plan con su validación al día.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { aplicar, type FilaHorario } from "@/lib/importacion/horarios";
import { tomarLote, marcarAplicado } from "@/lib/importacion/lote";
import { actualizarResumen, planConValidacion } from "@/lib/horarios/bd";
import type { ResultadoImportacion } from "@/lib/importacion/tipos";

const schema = z.object({ loteId: zId });

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const tomado = await tomarLote(prisma, parsed.data.loteId, "HORARIOS", g.usuario.id);
  if (!tomado.ok) return NextResponse.json({ error: tomado.motivo }, { status: tomado.codigo });
  const filas = tomado.lote.filas as unknown as FilaHorario[];
  if (!Array.isArray(filas) || filas.length === 0) return NextResponse.json({ error: "El lote no tiene filas que aplicar." }, { status: 409 });

  // Entre revisar y aplicar alguien pudo publicarlo.
  const planId = filas[0].planId;
  const plan = await prisma.planHorario.findUnique({ where: { id: planId }, select: { estado: true } });
  if (!plan || plan.estado !== "BORRADOR") return NextResponse.json({ error: "El plan ya no está en borrador: no se aplicó nada." }, { status: 409 });

  let resultado;
  try {
    resultado = await prisma.$transaction((tx) => aplicar(tx, filas, g.usuario.id ?? null), { timeout: 120_000, maxWait: 10_000 });
  } catch (e) {
    console.error("[importar/horarios] falló la transacción", e);
    return NextResponse.json({ error: "No se pudo aplicar la importación. No se guardó ningún cambio." }, { status: 500 });
  }
  await marcarAplicado(prisma, tomado.lote.id, { creados: resultado.creados, actualizados: resultado.actualizados });

  // Las reglas legales se revisan con el plan ya cambiado, como en cualquier edición.
  const r = await planConValidacion(prisma, planId);
  const errores = r ? r.validacion.alertas.filter((a) => a.nivel === "ERROR").length : 0;
  if (r) await actualizarResumen(prisma, planId, r.validacion, r.notas);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "IMPORT",
    tabla: "PlanHorario",
    registroId: planId,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { archivo: tomado.lote.nombreArchivo, lote: tomado.lote.id, ...resultado, erroresLegales: errores },
    ip,
    userAgent,
  });

  const respuesta: ResultadoImportacion = {
    loteId: tomado.lote.id,
    creados: resultado.creados,
    actualizados: resultado.actualizados,
    omitidos: 0,
    mensaje:
      `Se cargaron ${resultado.creados + resultado.actualizados} días` +
      (resultado.traslados ? ` y ${resultado.traslados} ${resultado.traslados === 1 ? "traslado temporal" : "traslados temporales"}` : "") +
      (errores ? `. El plan tiene ${errores} ${errores === 1 ? "error legal" : "errores legales"}: revíselos en Alertas antes de publicar.` : ". Revise las alertas del plan antes de publicarlo."),
  };
  return NextResponse.json(respuesta);
}
