/**
 * Prueba de conexión contra un dispositivo.
 *
 * Separada de la sincronización a propósito: cuando un reloj no responde, lo
 * primero que hay que saber es si el problema es de red (IP mal escrita, equipo
 * apagado, otra VLAN) o de credenciales. Diagnosticar eso lanzando una
 * sincronización completa mezcla ambas causas con las de la ingesta.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { driverPara } from "@/lib/biometrico/driver";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const { id } = await params;

  const dispositivo = await prisma.dispositivoBiometrico.findUnique({ where: { id } });
  if (!dispositivo) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });

  const inicio = Date.now();
  try {
    const resultado = await driverPara(dispositivo).probar();
    return NextResponse.json({
      ...resultado,
      dispositivo: dispositivo.nombre,
      marca: dispositivo.marca,
      destino: `${dispositivo.ip}:${dispositivo.puerto}`,
      msTranscurridos: Date.now() - inicio,
    });
  } catch (e) {
    // Se responde 200 con `ok:false` y no un 5xx: la prueba SÍ se ejecutó, y su
    // resultado —que el equipo no contesta— es la información que se pidió.
    return NextResponse.json({
      ok: false,
      detalle: e instanceof Error ? e.message : "Error desconocido",
      dispositivo: dispositivo.nombre,
      marca: dispositivo.marca,
      destino: `${dispositivo.ip}:${dispositivo.puerto}`,
      msTranscurridos: Date.now() - inicio,
    });
  }
}
