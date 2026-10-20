/**
 * Asignación de un PIN del reloj a un empleado.
 *
 * Al asignar se REPROCESA hacia atrás: los eventos que estaban en cuarentena con
 * ese PIN pasan a tener dueño y se convierten en jornadas. Sin eso, mapear a
 * alguien una semana tarde dejaría su primera semana sin registrar y habría que
 * teclearla a mano, que es justo lo que la cuarentena existe para evitar.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody, zId } from "@/lib/http/validar";
import { agregarEventosPendientes } from "@/lib/asistencia/agregar";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const dispositivoId = new URL(req.url).searchParams.get("dispositivoId") ?? undefined;

  const pines = await prisma.empleadoPin.findMany({
    where: dispositivoId ? { dispositivoId } : {},
    include: {
      empleado: { select: { id: true, codigo: true, primerNombre: true, primerApellido: true } },
      dispositivo: { select: { id: true, nombre: true } },
    },
    orderBy: [{ dispositivoId: "asc" }, { pin: "asc" }],
  });

  return NextResponse.json(pines);
}

const schema = z.object({
  dispositivoId: zId,
  pin: z.string().trim().min(1, "requerido").max(32),
  empleadoId: zId,
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { dispositivoId, pin, empleadoId } = parsed.data;

  const [dispositivo, empleado] = await Promise.all([
    prisma.dispositivoBiometrico.findUnique({ where: { id: dispositivoId }, select: { id: true } }),
    prisma.empleado.findUnique({ where: { id: empleadoId }, select: { id: true } }),
  ]);
  if (!dispositivo) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  // El vínculo y la adopción de los eventos huérfanos van juntos: si se guardara
  // el PIN y fallara el reproceso, quedarían marcas en cuarentena con un PIN que
  // ya tiene dueño, invisibles en ambas pantallas.
  const adoptados = await prisma.$transaction(async (tx) => {
    await tx.empleadoPin.upsert({
      where: { dispositivoId_pin: { dispositivoId, pin } },
      create: { dispositivoId, pin, empleadoId },
      update: { empleadoId },
    });

    const r = await tx.marcajeEvento.updateMany({
      where: { dispositivoId, pin, estado: "CUARENTENA" },
      data: { empleadoId, estado: "PENDIENTE" },
    });
    return r.count;
  });

  return NextResponse.json({
    ok: true,
    pin,
    eventosAdoptados: adoptados,
    agregacion: await agregarEventosPendientes({ empleadoId }),
  });
}
