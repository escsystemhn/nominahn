/**
 * PINs que el reloj reportó y que no corresponden a ningún empleado.
 *
 * Es la pantalla de conciliación inicial: como los equipos numeran a sus
 * usuarios con un correlativo propio (1, 2, 3…) que no es `Empleado.codigo`, la
 * PRIMERA sincronización deja aquí a la plantilla entera. Desde aquí se mapea
 * una vez y ya.
 *
 * Después queda como red de seguridad: un alta nueva en el reloj, o un PIN
 * reasignado a otra persona, vuelve a aparecer en esta lista en vez de perderse.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const dispositivoId = new URL(req.url).searchParams.get("dispositivoId") ?? undefined;

  // Un PIN puede acumular cientos de marcas; al operador le sirve el PIN, cuánto
  // lleva acumulado y desde cuándo — no la lista completa.
  const grupos = await prisma.marcajeEvento.groupBy({
    by: ["dispositivoId", "pin"],
    where: { estado: "CUARENTENA", ...(dispositivoId ? { dispositivoId } : {}) },
    _count: { _all: true },
    _min: { ocurridoEn: true },
    _max: { ocurridoEn: true },
  });

  const dispositivos = await prisma.dispositivoBiometrico.findMany({
    where: { id: { in: [...new Set(grupos.map((g) => g.dispositivoId))] } },
    select: { id: true, nombre: true, marca: true },
  });
  const porId = new Map(dispositivos.map((d) => [d.id, d]));

  const filas = grupos
    .map((g) => ({
      dispositivoId: g.dispositivoId,
      dispositivo: porId.get(g.dispositivoId)?.nombre ?? "—",
      marca: porId.get(g.dispositivoId)?.marca ?? null,
      pin: g.pin,
      marcas: g._count._all,
      primera: g._min.ocurridoEn,
      ultima: g._max.ocurridoEn,
    }))
    .sort((a, b) => b.marcas - a.marcas);

  return NextResponse.json({ total: filas.length, pines: filas });
}
