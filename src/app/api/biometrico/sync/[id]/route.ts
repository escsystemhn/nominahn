import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { sincronizarDispositivo } from "@/lib/biometrico/sincronizar";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requerirPermiso("asistencia.biometrico");
  if (!g.ok) return g.response;

  const { id } = await params;

  const dispositivo = await prisma.dispositivoBiometrico.findUnique({ where: { id } });
  if (!dispositivo) return NextResponse.json({ error: "Dispositivo no encontrado" }, { status: 404 });
  if (!dispositivo.activo) return NextResponse.json({ error: "Dispositivo inactivo" }, { status: 400 });

  try {
    return NextResponse.json(await sincronizarDispositivo(dispositivo));
  } catch (e) {
    // El driver de la marca puede no estar implementado todavía, o el equipo
    // puede no responder. Ambos son fallos esperables y el operador necesita
    // leer cuál de los dos fue.
    const detalle = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo sincronizar ${dispositivo.nombre}: ${detalle}` },
      { status: 502 }
    );
  }
}
