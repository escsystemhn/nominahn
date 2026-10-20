/**
 * Cambio de la propia contraseña.
 *
 * No existía: una vez sembrada la cuenta con `Admin1234!`, no había forma de
 * cambiarla desde la aplicación. Es la pieza que cierra el ciclo de la clave
 * temporal que fija un administrador.
 *
 * Sólo exige sesión —ningún permiso del catálogo—: cambiar la propia contraseña
 * no es una atribución que se conceda, es algo que toda cuenta puede hacer.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { z } from "zod";
import { validarPassword, hashear, comparar, LONGITUD_MAXIMA } from "@/lib/auth/password";

const schema = z.object({
  actual: z.string().min(1, "requerido"),
  nueva: z.string().min(1, "requerido").max(LONGITUD_MAXIMA),
});

export async function POST(req: NextRequest) {
  // Única ruta que atraviesa el bloqueo por contraseña temporal: es su salida.
  // Bloquearla también dejaría la cuenta sin forma de desbloquearse.
  const g = await requerirSesion({ permitirPasswordTemporal: true });
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { actual, nueva } = parsed.data;

  const usuario = await prisma.user.findUnique({
    where: { id: g.usuario.id },
    select: { id: true, email: true, name: true, password: true },
  });
  if (!usuario?.password) {
    return NextResponse.json({ error: "Esta cuenta no usa contraseña." }, { status: 400 });
  }

  /**
   * Se pide la actual aunque haya sesión: sin ella, una sesión olvidada en un
   * equipo compartido bastaría para apropiarse de la cuenta cambiándole la clave.
   */
  if (!(await comparar(actual, usuario.password))) {
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE",
      tabla: "User",
      registroId: usuario.id,
      usuarioId: usuario.id,
      usuarioEmail: usuario.email,
      valorNuevo: { accion: "CAMBIO_PASSWORD", exito: false, motivo: "ACTUAL_INCORRECTA" },
      ip,
      userAgent,
    });
    return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
  }

  if (await comparar(nueva, usuario.password)) {
    return NextResponse.json(
      { error: "La contraseña nueva debe ser distinta de la actual." },
      { status: 400 }
    );
  }

  const politica = validarPassword(nueva, [usuario.email, usuario.name ?? ""]);
  if (!politica.ok) {
    return NextResponse.json(
      { error: "La contraseña no cumple la política.", detalles: politica.errores },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: usuario.id },
    data: {
      password: await hashear(nueva),
      // Se levanta la marca: la clave ya es del titular y sólo él la conoce.
      debeCambiarPassword: false,
      passwordCambiadaAt: new Date(),
    },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "User",
    registroId: usuario.id,
    usuarioId: usuario.id,
    usuarioEmail: usuario.email,
    valorNuevo: { accion: "CAMBIO_PASSWORD", exito: true },
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
