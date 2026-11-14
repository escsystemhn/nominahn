/**
 * POST /api/marcajes/lote — la carga rápida de Asistencia: guarda la jornada de muchas
 * personas de una vez.
 *
 * Cada fila pasa por el mismo camino que «Registrar marcaje» (registrarJornadaManual) y
 * tiene su propio resultado: una fila con error no impide guardar las demás, y la
 * pantalla la deja marcada con el motivo para corregirla.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { conAlcance } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zEnteroNoNeg, zFecha, zId } from "@/lib/http/validar";
import { registrarJornadaManual } from "@/lib/asistencia/registrar-jornada";

const MAX_FILAS = 500;

const zFila = z.object({
  empleadoId: zId,
  fecha: zFecha,
  horaEntrada: zFecha.nullish(),
  horaSalida: zFecha.nullish(),
  esAusencia: z.boolean().optional(),
  esDiaLibre: z.boolean().optional(),
  observacion: z.string().trim().max(500).nullish(),
  minutosDescanso: zEnteroNoNeg.optional(),
});

const schema = z.object({ filas: z.array(zFila).min(1).max(MAX_FILAS) });

export interface ResultadoFilaLote {
  empleadoId: string;
  ok: boolean;
  error?: string;
  horasNormales?: number;
  horasExtra?: number;
  minutosDescanso?: number;
  observacion?: string | null;
}

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.gestionar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { filas } = parsed.data;

  // Alcance de una vez para todo el lote: lo ajeno responde como inexistente, por fila.
  const ids = [...new Set(filas.map((f) => f.empleadoId))];
  const alcanzados = new Set(
    (await prisma.empleado.findMany({ where: conAlcance({ id: { in: ids } }, g.usuario), select: { id: true } })).map((e) => e.id)
  );

  const resultados: ResultadoFilaLote[] = [];
  for (const f of filas) {
    if (!alcanzados.has(f.empleadoId)) {
      resultados.push({ empleadoId: f.empleadoId, ok: false, error: "Empleado no encontrado" });
      continue;
    }
    if ((f.horaEntrada && !f.horaSalida) || (!f.horaEntrada && f.horaSalida)) {
      resultados.push({ empleadoId: f.empleadoId, ok: false, error: "Ponga la entrada y la salida, o ninguna." });
      continue;
    }
    if (f.esAusencia && f.horaEntrada) {
      resultados.push({ empleadoId: f.empleadoId, ok: false, error: "Una ausencia no lleva entrada ni salida." });
      continue;
    }
    const r = await registrarJornadaManual({
      empleadoId: f.empleadoId,
      fecha: f.fecha,
      horaEntrada: f.horaEntrada ?? null,
      horaSalida: f.horaSalida ?? null,
      esAusencia: f.esAusencia,
      esDiaLibre: f.esDiaLibre,
      observacion: f.observacion ?? null,
      minutosDescanso: f.minutosDescanso,
    });
    resultados.push(
      r.ok
        ? {
            empleadoId: f.empleadoId,
            ok: true,
            horasNormales: Number(r.marcaje.horasNormales),
            horasExtra: Number(r.marcaje.horasExtra) + Number(r.marcaje.horasFeriado),
            minutosDescanso: r.marcaje.minutosDescanso,
            observacion: r.marcaje.observacion,
          }
        : { empleadoId: f.empleadoId, ok: false, error: r.error }
    );
  }

  const guardadas = resultados.filter((r) => r.ok).length;
  if (guardadas > 0) {
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE",
      tabla: "Marcaje",
      registroId: `lote:${guardadas}`,
      usuarioId: g.usuario.id,
      usuarioEmail: g.usuario.email ?? undefined,
      valorNuevo: { origen: "carga rápida", guardadas, conError: resultados.length - guardadas, fechas: [...new Set(filas.map((f) => f.fecha.toISOString().slice(0, 10)))] },
      ip,
      userAgent,
    });
  }

  return NextResponse.json({ guardadas, conError: resultados.length - guardadas, resultados });
}
