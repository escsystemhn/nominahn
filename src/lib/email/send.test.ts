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
import { templateBoletaPago, type DatosBoleta } from "./send";

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
});

describe("templateBoletaPago", () => {
  const datos: DatosBoleta = {
    empresa: "NominaHN S. de R.L.",
    empresaRtn: "08019995123456",
    nombreEmpleado: "Juan Pérez",
    codigoEmpleado: "EMP-0042",
    identidad: "0801-1990-01234",
    periodo: "Agosto 2026",
    tipoPlanilla: "MENSUAL",
    diasTrabajados: "30",
    horasExtra: "6.50",
    ingresos: [
      ["Salario base", "L 25,000.00"],
      ["Horas extraordinarias", "L 812.50"],
    ],
    deducciones: [
      ["IHSS — Enfermedad y Maternidad", "L 297.58"],
      ["IHSS — Invalidez, Vejez y Muerte", "L 297.58"],
      ["RAP", "L 196.45"],
      ["ISR retenido", "L 1,208.39"],
    ],
    totalBruto: "L 25,812.50",
    totalDeducciones: "L 3,500.00",
    salarioNeto: "L 21,500.00",
  };

  it("muestra los totales formateados en lempiras", () => {
    const html = templateBoletaPago(datos);
    expect(html).toContain("25,812.50");
    expect(html).toContain("3,500.00");
    expect(html).toContain("21,500.00");
  });

  it("incluye empleado, período y empresa", () => {
    const html = templateBoletaPago(datos);
    expect(html).toContain("Juan Pérez");
    expect(html).toContain("Agosto 2026");
    expect(html).toContain("NominaHN S. de R.L.");
  });

  it("REGRESIÓN: desglosa CADA deducción, no sólo el total", () => {
    // La versión anterior imprimía tres cifras (bruto, deducciones, neto), de
    // modo que el trabajador no podía verificar qué se le retenía.
    const html = templateBoletaPago(datos);
    for (const [concepto, monto] of datos.deducciones) {
      expect(html).toContain(concepto.replace(/—/g, "—"));
      expect(html).toContain(monto);
    }
  });

  it("identifica al patrono y al trabajador", () => {
    const html = templateBoletaPago(datos);
    expect(html).toContain("08019995123456"); // RTN del patrono
    expect(html).toContain("EMP-0042");       // código del trabajador
    expect(html).toContain("0801-1990-01234"); // identidad
  });

  it("incluye días trabajados, horas extra y espacio de firma", () => {
    const html = templateBoletaPago(datos);
    expect(html).toContain("30");
    expect(html).toContain("6.50");
    expect(html).toMatch(/firma del trabajador/i);
  });

  it("escapa el HTML de los campos que editan los usuarios", () => {
    const html = templateBoletaPago({ ...datos, nombreEmpleado: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("no imprime líneas que el llamador omitió", () => {
    const html = templateBoletaPago({ ...datos, deducciones: [["ISR retenido", "L 100.00"]] });
    expect(html).not.toContain("Cooperativa");
    expect(html).toContain("ISR retenido");
  });
});
