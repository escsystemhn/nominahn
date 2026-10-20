/**
 * Servidor de correo saliente para los comprobantes de pago.
 *
 * Sólo con `configuracion.correo`, que por omisión tiene únicamente SUPER_ADMIN:
 * quien controla este servidor puede enviar correos a nombre de la empresa.
 *
 * La contraseña entra, se cifra y NO vuelve a salir: el GET sólo dice si hay
 * una guardada. En el formulario, dejarla vacía significa «no la cambies».
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { cifrar, cifradoDisponible } from "@/lib/seguridad/cifrado";
import { configSmtpVigente } from "@/lib/email/send";

const schema = z.object({
  host: z.string().trim().min(1, "requerido").max(255),
  puerto: z.coerce.number().int().min(1).max(65535),
  seguro: z.boolean(),
  usuario: z.string().trim().max(255).optional().nullable(),
  /** Vacía = conservar la guardada. `null` explícito = borrarla. */
  password: z.string().max(500).optional().nullable(),
  remitenteNombre: z.string().trim().min(1, "requerido").max(120),
  remitenteCorreo: z.string().trim().email("correo inválido").max(255),
  activo: z.boolean().optional(),
});

export async function GET() {
  const g = await requerirPermiso("configuracion.correo");
  if (!g.ok) return g.response;

  const c = await prisma.configuracionCorreo.findUnique({ where: { id: "default" } });
  const vigente = await configSmtpVigente().catch(() => null);

  return NextResponse.json({
    configuracion: c
      ? {
          host: c.host,
          puerto: c.puerto,
          seguro: c.seguro,
          usuario: c.usuario,
          tienePassword: !!c.passwordCifrado,
          remitenteNombre: c.remitenteNombre,
          remitenteCorreo: c.remitenteCorreo,
          activo: c.activo,
          actualizadoPor: c.actualizadoPor,
          updatedAt: c.updatedAt,
        }
      : null,
    // Qué se está usando AHORA: la pantalla, las variables de entorno, o nada.
    origenVigente: vigente?.origen ?? null,
    cifradoDisponible: cifradoDisponible(),
  });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("configuracion.correo");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  if (d.password && !cifradoDisponible()) {
    return NextResponse.json(
      {
        error:
          "Falta CIFRADO_KEY en el entorno del servidor. Sin ella no se guardan contraseñas, " +
          "porque no se almacenan en claro.",
      },
      { status: 503 }
    );
  }

  // Contraseña: nueva → se cifra; null → se borra; vacía o ausente → no se toca.
  const password =
    d.password === null ? { passwordCifrado: null }
    : d.password ? { passwordCifrado: cifrar(d.password) }
    : {};

  const comun = {
    host: d.host,
    puerto: d.puerto,
    seguro: d.seguro,
    usuario: d.usuario || null,
    remitenteNombre: d.remitenteNombre,
    remitenteCorreo: d.remitenteCorreo,
    activo: d.activo ?? true,
    actualizadoPor: g.usuario.email ?? null,
  };

  await prisma.configuracionCorreo.upsert({
    where: { id: "default" },
    create: { id: "default", ...comun, ...password },
    update: { ...comun, ...password },
  });

  return NextResponse.json({ ok: true });
}
