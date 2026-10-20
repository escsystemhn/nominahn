/**
 * Restablecimiento de contraseña por un administrador.
 *
 * Genera una clave temporal aleatoria y la devuelve UNA sola vez. No se acepta
 * que el administrador elija la contraseña de otra persona: si la escribe él,
 * la conoce, y el rastro de auditoría deja de poder distinguir lo que hizo el
 * titular de lo que hizo quien se la fijó.
 *
 * `debeCambiarPassword` obliga a sustituirla en el primer acceso, de modo que la
 * ventana en la que dos personas conocen la clave se cierra sola.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { permisosEfectivos, expandir, tienePermiso } from "@/lib/auth/permisos";
import { generarPasswordTemporal, hashear } from "@/lib/auth/password";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("seguridad.usuarios_password");
  if (!g.ok) return g.response;

  const { id } = await params;
  const objetivo = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, activo: true, role: true,
      perfil: { select: { permisos: true, activo: true } },
    },
  });
  if (!objetivo) return NextResponse.json({ error: "El usuario no existe." }, { status: 404 });

  /**
   * No se restablece la contraseña de una cuenta con MÁS permisos que la propia:
   * quien pueda hacerlo se apodera de esa cuenta con sólo pedir una clave nueva,
   * y todo el reparto de permisos deja de significar nada.
   */
  const permisosObjetivo = permisosEfectivos(objetivo);
  const sobrepasa = expandir(permisosObjetivo).filter((p) => !tienePermiso(g.usuario.permisos, p));
  if (sobrepasa.length > 0) {
    return NextResponse.json(
      { error: "No puede restablecer la contraseña de una cuenta con más permisos que la suya." },
      { status: 403 }
    );
  }

  const passwordTemporal = generarPasswordTemporal();
  await prisma.user.update({
    where: { id },
    data: {
      password: await hashear(passwordTemporal),
      debeCambiarPassword: true,
      passwordCambiadaAt: new Date(),
    },
  });

  // La sesión abierta del titular deja de valer: si alguien la había tomado, el
  // restablecimiento no serviría de nada mientras siguiera activa.
  await prisma.session.deleteMany({ where: { userId: id } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "User",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    // Ni la contraseña ni su hash entran en el rastro.
    valorNuevo: { accion: "RESET_PASSWORD", objetivo: objetivo.email },
    ip,
    userAgent,
  });

  return NextResponse.json({
    passwordTemporal,
    aviso: "Entréguesela al usuario por un canal seguro. Deberá cambiarla al entrar.",
  });
}
