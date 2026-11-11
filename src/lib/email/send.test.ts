/**
 * Contrato con nodemailer.
 *
 * Los tipos vienen de `@types/nodemailer` 8.0.1 (la última publicada; nodemailer
 * no trae tipos propios) mientras que el paquete instalado es 9.x. Ese desfase de
 * major no rompe nada hoy porque la superficie que usamos —`createTransport` con
 * SMTP y `sendMail` con from/to/subject/html/attachments— no cambió, pero es un
 * desfase que conviene tener comprobado y no sólo anotado.
 *
 * Estas pruebas ejercitan esa superficie contra el nodemailer REAL usando
 * `jsonTransport`, que serializa el mensaje en vez de abrir una conexión SMTP.
 * Si una versión futura cambia la API o la forma de las opciones, esto falla
 * aquí en vez de fallar al enviar boletas de pago en producción.
 */
import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

describe("nodemailer — superficie de la API que usa NominaHN", () => {
  it("createTransport acepta la misma configuración SMTP que send.ts", () => {
    const t = nodemailer.createTransport({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "usuario", pass: "clave" },
    });
    expect(typeof t.sendMail).toBe("function");
  });

  it("sendMail acepta from/to/subject/html/attachments y compone el mensaje", async () => {
    const t = nodemailer.createTransport({ jsonTransport: true });

    const info = await t.sendMail({
      from: "NominaHN <nomina@example.com>",
      to: "empleado@example.com",
      subject: "Boleta de pago — Agosto 2026",
      html: "<p>Detalle</p>",
      attachments: [{ filename: "boleta.pdf", content: Buffer.from("%PDF-1.4"), contentType: "application/pdf" }],
    });

    const mensaje = JSON.parse((info as unknown as { message: string }).message);
    expect(mensaje.subject).toBe("Boleta de pago — Agosto 2026");
    expect(mensaje.to[0].address).toBe("empleado@example.com");
    expect(mensaje.from.address).toBe("nomina@example.com");
    expect(mensaje.html).toBe("<p>Detalle</p>");
    expect(mensaje.attachments).toHaveLength(1);
    expect(mensaje.attachments[0].filename).toBe("boleta.pdf");
  });

  it("acepta un adjunto en línea, que es como viaja el logo del comprobante", async () => {
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await t.sendMail({
      from: "nomina@example.com",
      to: "empleado@example.com",
      subject: "Comprobante",
      html: '<img src="cid:logo-sucursal">',
      attachments: [{ filename: "logo.png", content: Buffer.from("png"), contentType: "image/png", cid: "logo-sucursal", contentDisposition: "inline" }],
    });
    const crudo = (info as unknown as { message: Buffer }).message.toString();
    expect(crudo).toMatch(/Content-Id: <logo-sucursal>/i);
    expect(crudo).toMatch(/Content-Disposition: inline/i);
    expect(crudo).toMatch(/multipart\/related/i);
  });
});
