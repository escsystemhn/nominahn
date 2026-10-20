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
  // Import diferido: este módulo también exporta la plantilla de la boleta,
  // que es pura y se prueba sin base de datos. Importar Prisma arriba haría que
  // cualquier test de la plantilla exigiera DATABASE_URL.
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
  }>;
}) {
  const cfg = await configSmtpVigente();
  if (!cfg) throw new CorreoNoConfigurado();
  return crearTransporte(cfg).sendMail({ from: cfg.remitente, to, subject, html, attachments });
}

/**
 * Comprobante de pago (boleta).
 *
 * QUÉ CAMBIÓ: la versión anterior mostraba tres cifras —bruto, total de
 * deducciones y neto— sin desglosar ningún concepto. Un recibo de pago debe
 * detallar cada descuento para que el trabajador pueda verificar qué se le
 * retiene y por qué, además de identificar al patrono y al trabajador.
 *
 * Los importes llegan YA FORMATEADOS: quien construye la boleta tiene los
 * `Decimal` y decide cómo presentarlos; aquí no se hace aritmética.
 */
export interface DatosBoleta {
  empresa: string;
  empresaRtn: string;
  nombreEmpleado: string;
  codigoEmpleado: string;
  identidad: string;
  periodo: string;
  tipoPlanilla: string;
  diasTrabajados: string;
  horasExtra: string;
  /** Pares [concepto, importe formateado], en el orden en que se imprimen. */
  ingresos: Array<[string, string]>;
  deducciones: Array<[string, string]>;
  totalBruto: string;
  totalDeducciones: string;
  salarioNeto: string;
}

/**
 * Escapa el texto que entra en la boleta. Los nombres y observaciones los
 * editan los usuarios, y la boleta se abre en un navegador o en un cliente de
 * correo.
 */
function esc(valor: string): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function templateBoletaPago(d: DatosBoleta): string {
  const filas = (pares: Array<[string, string]>) =>
    pares.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Comprobante de pago — ${esc(d.periodo)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111;
         max-width: 720px; margin: 0 auto; padding: 24px; background: #fff; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .sub { color: #555; margin: 0 0 16px; font-size: 11px; }
  .id { border: 1px solid #ccc; padding: 10px; margin-bottom: 14px;
        display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #1e40af; color: #fff; text-align: left; padding: 5px 8px; font-size: 10px; }
  th.n, td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 4px 8px; border-bottom: 1px solid #eee; }
  tr.tot td { font-weight: bold; border-top: 1px solid #333; border-bottom: 0; }
  .neto { background: #1e40af; color: #fff; padding: 10px;
          display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; }
  .firma { margin-top: 40px; border-top: 1px solid #333; width: 240px;
           padding-top: 5px; font-size: 10px; color: #555; }
  .pie { margin-top: 18px; color: #777; font-size: 10px; }
</style>
</head>
<body>
<h1>${esc(d.empresa)}</h1>
<p class="sub">RTN ${esc(d.empresaRtn)} &middot; Comprobante de pago de salario</p>

<div class="id">
  <span><b>Trabajador:</b> ${esc(d.nombreEmpleado)}</span>
  <span><b>Código:</b> ${esc(d.codigoEmpleado)}</span>
  <span><b>Identidad:</b> ${esc(d.identidad)}</span>
  <span><b>Planilla:</b> ${esc(d.tipoPlanilla)}</span>
  <span><b>Período:</b> ${esc(d.periodo)}</span>
  <span><b>Días / Horas extra:</b> ${esc(d.diasTrabajados)} / ${esc(d.horasExtra)}</span>
</div>

<table>
  <thead><tr><th>Ingresos</th><th class="n">Monto</th></tr></thead>
  <tbody>
    ${filas(d.ingresos)}
    <tr class="tot"><td>Total devengado</td><td class="n">${esc(d.totalBruto)}</td></tr>
  </tbody>
</table>

<table>
  <thead><tr><th>Deducciones</th><th class="n">Monto</th></tr></thead>
  <tbody>
    ${filas(d.deducciones)}
    <tr class="tot"><td>Total deducciones</td><td class="n">${esc(d.totalDeducciones)}</td></tr>
  </tbody>
</table>

<div class="neto"><span>NETO A RECIBIR</span><span>${esc(d.salarioNeto)}</span></div>

<div class="firma">Recibí conforme &mdash; firma del trabajador</div>

<p class="pie">
  Documento generado por NominaHN. Ante cualquier discrepancia, diríjase al
  departamento de Recursos Humanos dentro de los siguientes 30 días.
</p>
</body>
</html>`;
}
