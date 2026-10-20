/**
 * Envía un correo de prueba con la configuración GUARDADA.
 *
 * Existe para que el administrador descubra un servidor mal configurado ahora,
 * con un mensaje de error legible, y no el día de pago al enviar 200
 * comprobantes que no salen.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { configSmtpVigente, crearTransporte } from "@/lib/email/send";

const schema = z.object({
  destino: z.string().trim().email("correo inválido"),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.correo");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  let cfg;
  try {
    cfg = await configSmtpVigente();
  } catch {
    // Típicamente: la contraseña se cifró con otra CIFRADO_KEY.
    return NextResponse.json(
      { ok: false, error: "No se pudo leer la contraseña guardada. Vuelva a escribirla y guarde." },
      { status: 200 }
    );
  }
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "No hay servidor de correo configurado. Guarde la configuración primero." },
      { status: 200 }
    );
  }

  const inicio = Date.now();
  try {
    const t = crearTransporte(cfg);
    // `verify` separa «no conecta / credenciales malas» de «conecta pero el
    // servidor rechaza el mensaje», que se arreglan en sitios distintos.
    await t.verify();
    await t.sendMail({
      from: cfg.remitente,
      to: parsed.data.destino,
      subject: "Prueba de correo — NominaHN",
      html:
        "<p>Este es un correo de prueba enviado desde <b>NominaHN</b>.</p>" +
        "<p>Si lo está leyendo, el servidor de correo saliente está bien configurado " +
        "y los comprobantes de pago se podrán enviar.</p>",
    });
    return NextResponse.json({
      ok: true,
      detalle: `Correo enviado a ${parsed.data.destino} vía ${cfg.host}:${cfg.puerto}.`,
      origen: cfg.origen,
      ms: Date.now() - inicio,
    });
  } catch (e) {
    // 200 con ok:false: la prueba se ejecutó; su resultado es la información pedida.
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: msg, origen: cfg.origen, ms: Date.now() - inicio });
  }
}
