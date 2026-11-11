import nodemailer from "nodemailer";
import { descifrar } from "@/lib/seguridad/cifrado";

/**
 * Servidor de correo con el que se envía.
 *
 * DE DÓNDE SALE, EN ORDEN:
 *   1. La configuración guardada en Configuración → Correo saliente
 *      (`ConfiguracionCorreo`), si existe y está activa.
 *   2. Las variables SMTP_* del entorno, que era la única vía antes. Se
 *      conservan para no romper las instalaciones que ya las usan.
 *
 * Se resuelve EN CADA ENVÍO, no al cargar el módulo: si el administrador cambia
 * el servidor, el siguiente comprobante sale por el nuevo sin reiniciar nada.
 */
export interface ConfigSmtp {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string | null;
  password: string | null;
  /** Encabezado From completo: `"Nombre" <correo>`. */
  remitente: string;
  origen: "CONFIGURACION" | "ENTORNO";
}

export class CorreoNoConfigurado extends Error {
  constructor() {
    super(
      "No hay servidor de correo saliente configurado. Un administrador debe " +
        "configurarlo en Configuración → Correo saliente."
    );
    this.name = "CorreoNoConfigurado";
  }
}

/** Arma el From sin permitir que un nombre con comillas rompa el encabezado. */
export function remitenteFormateado(nombre: string, correo: string): string {
  const limpio = nombre.replace(/["\r\n]/g, "").trim();
  return limpio ? `"${limpio}" <${correo}>` : correo;
}

export async function configSmtpVigente(): Promise<ConfigSmtp | null> {
  // Import diferido: `remitenteFormateado` es puro y se prueba sin base de datos.
  // Importar Prisma arriba haría que esas pruebas exigieran DATABASE_URL.
  const { prisma } = await import("@/lib/prisma");
  const guardada = await prisma.configuracionCorreo.findUnique({ where: { id: "default" } });
  if (guardada?.activo) {
    return {
      host: guardada.host,
      puerto: guardada.puerto,
      seguro: guardada.seguro,
      usuario: guardada.usuario,
      password: guardada.passwordCifrado ? descifrar(guardada.passwordCifrado) : null,
      remitente: remitenteFormateado(guardada.remitenteNombre, guardada.remitenteCorreo),
      origen: "CONFIGURACION",
    };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_FROM) {
    const puerto = Number(process.env.SMTP_PORT) || 587;
    return {
      host: process.env.SMTP_HOST,
      puerto,
      seguro: puerto === 465,
      usuario: process.env.SMTP_USER || null,
      password: process.env.SMTP_PASS || null,
      remitente: process.env.SMTP_FROM,
      origen: "ENTORNO",
    };
  }

  return null;
}

export function crearTransporte(cfg: ConfigSmtp) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.puerto,
    secure: cfg.seguro,
    ...(cfg.usuario ? { auth: { user: cfg.usuario, pass: cfg.password ?? "" } } : {}),
    // Sin esto, un servidor que no responde deja la petición colgada minutos.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

export async function sendEmail({
  to,
  subject,
  html,
  attachments = [],
}: {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
    /** Con él, el HTML puede mostrarlo con `<img src="cid:...">` sin descargar nada. */
    cid?: string;
    contentDisposition?: "attachment" | "inline";
  }>;
}) {
  const cfg = await configSmtpVigente();
  if (!cfg) throw new CorreoNoConfigurado();
  return crearTransporte(cfg).sendMail({ from: cfg.remitente, to, subject, html, attachments });
}
