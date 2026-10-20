/**
 * Sincronización programada de todos los dispositivos activos.
 *
 * Va por CRON y no por push del equipo porque NominaHN corre en la MISMA LAN del
 * cliente: el servidor alcanza los relojes por IP, así que no hace falta exponer
 * ningún endpoint a internet ni abrir puertos entrantes. El servidor pregunta.
 *
 * Protegido con `x-cron-secret`, igual que /api/cron/evaluaciones.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sincronizarDispositivo } from "@/lib/biometrico/sincronizar";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const dispositivos = await prisma.dispositivoBiometrico.findMany({ where: { activo: true } });

  const resultados = [];
  for (const d of dispositivos) {
    // Un equipo apagado o inalcanzable no debe impedir que se sincronicen los
    // demás: se anota el fallo y se sigue.
    try {
      resultados.push({ ok: true, ...(await sincronizarDispositivo(d)) });
    } catch (e) {
      resultados.push({
        ok: false,
        dispositivo: d.nombre,
        error: e instanceof Error ? e.message : "Error desconocido",
      });
    }
  }

  return NextResponse.json({
    dispositivos: dispositivos.length,
    conError: resultados.filter((r) => !r.ok).length,
    resultados,
  });
}
