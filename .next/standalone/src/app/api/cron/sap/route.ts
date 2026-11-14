/**
 * Procesa la cola de asientos hacia SAP: los PENDIENTE cuyo turno llegó
 * (reintentos tras un fallo de red o un Service Layer caído).
 *
 * Lo invoca un cron externo (cada 5 minutos es suficiente). Protegido con
 * `x-cron-secret`, igual que /api/cron/biometrico. El envío inmediato no
 * depende de este cron: ocurre al aprobar/pagar o al pulsar el botón; aquí
 * sólo se recoge lo que quedó pendiente.
 */

import { NextRequest, NextResponse } from "next/server";
import { procesarPendientes } from "@/lib/sap/envio";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const r = await procesarPendientes(20);
  return NextResponse.json(r);
}
