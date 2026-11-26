/**
 * Respaldo automático: lo llama un cron cada pocos minutos (en la instalación de
 * Windows, la tarea «Tareas del sistema» cada 5) y el respaldo se hace sólo cuando
 * toca según el horario de Configuración → Respaldos. Protegido con `x-cron-secret`.
 */

import { NextRequest, NextResponse } from "next/server";
import { ErrorRespaldo, respaldoProgramado } from "@/lib/respaldos/respaldos-bd";
import { vigilarRespaldos } from "@/lib/respaldos/alertas";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Primero lo que no depende de respaldar ahora: atrasos y la prueba de restauración (avisa una vez por día).
  const avisos = await vigilarRespaldos().catch((e) => { console.error("[respaldos] vigilancia:", e); return [] as string[]; });
  try {
    const r = await respaldoProgramado();
    return NextResponse.json(r.hecho ? { hecho: true, estado: r.resultado?.estado, archivo: r.resultado?.archivo, error: r.resultado?.error, avisos } : { ...r, avisos });
  } catch (e) {
    if (e instanceof ErrorRespaldo) return NextResponse.json({ hecho: false, motivo: e.message, avisos });
    throw e;
  }
}
