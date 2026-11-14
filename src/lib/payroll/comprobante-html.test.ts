import { describe, it, expect } from "vitest";
import { adjuntoDelLogo, CID_LOGO, comprobanteHtml } from "./comprobante-html";
import { filasDelTrabajador, type DatosBoleta } from "./comprobante";

const datos: DatosBoleta = {
  empresa: "NominaHN S. de R.L.",
  empresaRtn: "08019995123456",
  nombreEmpleado: "Juan Pérez",
  codigoEmpleado: "EMP-0042",
  identidad: "0801-1990-01234",
  periodo: "01/08/2026 al 31/08/2026",
  tipoPlanilla: "Planilla mensual",
  diasTrabajados: "30",
  horasExtra: "6.5",
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
  netoEnLetras: "VEINTIÚN MIL QUINIENTOS LEMPIRAS CON 00/100",
};

describe("comprobanteHtml: lo que dice", () => {
  it("muestra los totales formateados en lempiras", () => {
    const html = comprobanteHtml(datos);
    expect(html).toContain("25,812.50");
    expect(html).toContain("3,500.00");
    expect(html).toContain("21,500.00");
  });

  it("incluye empleado, período y empresa", () => {
    const html = comprobanteHtml(datos);
    expect(html).toContain("Juan Pérez");
    expect(html).toContain("01/08/2026 al 31/08/2026");
    expect(html).toContain("NominaHN S. de R.L.");
  });

  it("REGRESIÓN: desglosa CADA deducción, no sólo el total", () => {
    // La versión anterior imprimía tres cifras (bruto, deducciones, neto), de
    // modo que el trabajador no podía verificar qué se le retenía.
    const html = comprobanteHtml(datos);
    for (const [concepto, monto] of datos.deducciones) {
      expect(html).toContain(concepto);
      expect(html).toContain(monto);
    }
  });

  it("identifica al patrono y al trabajador", () => {
    const html = comprobanteHtml(datos);
    expect(html).toContain("08019995123456"); // RTN del patrono
    expect(html).toContain("EMP-0042");       // código del trabajador
    expect(html).toContain("0801-1990-01234"); // identidad
  });

  it("incluye días trabajados, horas extra y espacio de firma", () => {
    const html = comprobanteHtml(datos);
    expect(html).toContain("30");
    expect(html).toContain("6.5");
    expect(html).toMatch(/firma del trabajador/i);
  });

  it("escribe el neto en letras", () => {
    expect(comprobanteHtml(datos)).toContain("VEINTIÚN MIL QUINIENTOS LEMPIRAS CON 00/100");
  });

  it("omite las horas extra cuando no hubo", () => {
    expect(comprobanteHtml({ ...datos, horasExtra: "0" })).not.toContain("Horas extra<");
  });

  it("no imprime líneas que el llamador omitió", () => {
    const html = comprobanteHtml({ ...datos, deducciones: [["ISR retenido", "L 100.00"]] });
    expect(html).not.toContain("Cooperativa");
    expect(html).toContain("ISR retenido");
  });

  it("dice que no hubo deducciones, en vez de dejar la columna muda", () => {
    expect(comprobanteHtml({ ...datos, deducciones: [] })).toContain("Sin deducciones en este período");
  });

  it("muestra la sucursal y su dirección sólo si las hay", () => {
    const sin = comprobanteHtml(datos);
    expect(sin).not.toContain("Sucursal ");
    expect(sin).not.toContain("División");
    const con = comprobanteHtml({ ...datos, sucursal: "Norte", direccion: "Barrio Guamilito", telefono: "2550-0000" });
    expect(con).toContain("Sucursal Norte");
    expect(con).toContain("RTN 08019995123456 · Barrio Guamilito · Tel. 2550-0000");
  });

  it("el membrete dice primero el grupo y luego la sucursal; el puesto va con el trabajador (2026-11-14)", () => {
    const html = comprobanteHtml({ ...datos, ubicacion: ["Grupo PAGSA", "Sucursal San Pedro Sula"], division: "San Pedro Sula", puesto: "Cajera" });
    const i = (t: string) => html.indexOf(t);
    expect(i("NominaHN S. de R.L.")).toBeLessThan(i("Grupo PAGSA"));
    expect(i("Grupo PAGSA")).toBeLessThan(i("Sucursal San Pedro Sula"));
    expect(i("Sucursal San Pedro Sula")).toBeLessThan(i("RTN 08019995123456"));
    expect(html).toContain(">Puesto<");
    expect(html).toContain(">Cajera<");
    expect(html).not.toContain(">División<");
  });

  it("«Imprimir» abre el PDF de media carta, sin script", () => {
    const html = comprobanteHtml(datos, { modo: "pantalla", urlPdf: "/api/mis-boletas/x", nonce: "n" });
    expect(html).toContain('href="/api/mis-boletas/x?modo=imprimir"');
    expect(html).not.toContain("window.print");
  });
});

describe("comprobanteHtml: maquetación", () => {
  it("REGRESIÓN: ningún elemento repite `style`, porque el navegador ignora el segundo", () => {
    // Se perdían el filete bajo el membrete y el espacio para firmar.
    for (const o of [{ modo: "pantalla", nonce: "n", urlPdf: "/x" }, { modo: "correo" }] as const) {
      const html = comprobanteHtml({ ...datos, estado: "PAGADA" }, { ...o, logo: { src: "cid:x", ancho: 10, alto: 10 } });
      for (const etiqueta of html.match(/<[a-z][^>]*>/g) ?? []) {
        expect(etiqueta.match(/\sstyle="/g)?.length ?? 0, etiqueta).toBeLessThanOrEqual(1);
      }
    }
  });

  it("las filas de relleno no llevan filete, para que no parezcan renglones por llenar", () => {
    const relleno = comprobanteHtml(datos).match(/<tr class="relleno">.*?<\/tr>/g) ?? [];
    expect(relleno.length).toBeGreaterThan(0);
    for (const r of relleno) expect(r).toContain("border-top:1px solid #FFFFFF");
  });

  it("REGRESIÓN: ninguna fila lleva filete abajo, porque le ganaría al del total", () => {
    const html = comprobanteHtml(datos);
    const cuerpos = html.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? [];
    expect(cuerpos).toHaveLength(2);
    for (const c of cuerpos) expect(c).not.toContain("border-bottom");
  });

  it("tiene región principal y la barra se identifica, para quien usa lector de pantalla", () => {
    const html = comprobanteHtml(datos, { modo: "pantalla", urlPdf: "/x" });
    expect(html).toContain("<main>");
    expect(html).toContain('<nav class="no-imprimir"');
  });
});

describe("filasDelTrabajador", () => {
  const filas = (over: Partial<DatosBoleta>) => filasDelTrabajador({ ...datos, ...over }).map((f) => f.map(([e]) => e));

  it("días y horas extra van juntos, y el departamento no los separa", () => {
    expect(filas({ departamento: "Ventas" })).toEqual([["Código", "Identidad"], ["Departamento"], ["Días trabajados", "Horas extra"]]);
  });

  it("el puesto va junto al departamento; la división ya no (va en el membrete)", () => {
    expect(filas({ departamento: "Ventas", division: "Mayoreo", puesto: "Cajera" })).toEqual([["Código", "Identidad"], ["Puesto", "Departamento"], ["Días trabajados", "Horas extra"]]);
  });

  it("dos filas de un dato se juntan en una", () => {
    expect(filas({ departamento: "Ventas", horasExtra: "0" })).toEqual([["Código", "Identidad"], ["Departamento", "Días trabajados"]]);
  });

  it("sin departamento quedan sólo las que aplican", () => {
    expect(filas({ departamento: null, horasExtra: "0" })).toEqual([["Código", "Identidad"], ["Días trabajados"]]);
  });
});

describe("comprobanteHtml: seguridad", () => {
  it("escapa el HTML de los campos que editan los usuarios", () => {
    const html = comprobanteHtml({
      ...datos,
      nombreEmpleado: '<script>alert("x")</script>',
      empresa: "<img src=x onerror=alert(1)>",
      sucursal: "<b>Norte</b>",
      deducciones: [["<i>Rara</i>", "L 1.00"]],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Norte");
    expect(html).not.toContain("<i>Rara");
  });

  it("escapa también lo que entra en atributos del logo", () => {
    const html = comprobanteHtml(datos, { logo: { src: "cid:x", ancho: 100, alto: 50, alt: 'Logo "><script>x</script>' } });
    expect(html).not.toContain("<script>x");
  });

  it("sin autorización no hay script: el correo y la vista sin nonce no llevan ninguno", () => {
    expect(comprobanteHtml(datos, { modo: "correo", nonce: "abc" })).not.toContain("<script");
    expect(comprobanteHtml(datos, { modo: "pantalla" })).not.toContain("<script");
  });

  it("la vista ya no lleva ningún script: «Imprimir» es un enlace al PDF (2026-11-14)", () => {
    const html = comprobanteHtml(datos, { modo: "pantalla", nonce: "abc", urlPdf: "/x" });
    expect(html).not.toContain("<script");
  });
});

describe("comprobanteHtml: el logo", () => {
  it("sin logo no hay imagen", () => {
    expect(comprobanteHtml(datos)).not.toContain("<img");
  });

  it("lo ajusta al membrete con medidas explícitas, porque Outlook ignora las de CSS", () => {
    const html = comprobanteHtml(datos, { logo: { src: "data:image/png;base64,AAAA", ancho: 720, alto: 240 } });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('width="192"');
    expect(html).toContain('height="64"');
  });

  it("no agranda un logo pequeño", () => {
    const html = comprobanteHtml(datos, { logo: { src: "cid:x", ancho: 80, alto: 30 } });
    expect(html).toContain('width="80"');
    expect(html).toContain('height="30"');
  });

  it("en un correo apunta al adjunto en línea", () => {
    const html = comprobanteHtml(datos, { modo: "correo", logo: { src: `cid:${CID_LOGO}`, ancho: 200, alto: 50 } });
    const adjunto = adjuntoDelLogo(Buffer.from("png"));
    expect(html).toContain(`src="cid:${adjunto.cid}"`);
    expect(adjunto.contentDisposition).toBe("inline");
  });
});

describe("comprobanteHtml: pantalla y correo", () => {
  it("la pantalla ofrece imprimir y descargar; el correo no", () => {
    const pantalla = comprobanteHtml(datos, { modo: "pantalla", nonce: "abc", urlPdf: "/api/mis-boletas/1" });
    expect(pantalla).toContain("Imprimir");
    expect(pantalla).toContain('href="/api/mis-boletas/1"');
    const correo = comprobanteHtml(datos, { modo: "correo", nonce: "abc", urlPdf: "/api/mis-boletas/1" });
    expect(correo).not.toContain("Imprimir");
    expect(correo).not.toContain("/api/mis-boletas/1");
  });

  it("un correo no se firma", () => {
    expect(comprobanteHtml(datos, { modo: "correo" })).not.toMatch(/firma del trabajador/i);
  });
});

describe("comprobanteHtml: estado de la planilla", () => {
  it.each(["APROBADA", "PAGADA"])("%s es un comprobante: sin aviso y con firma", (estado) => {
    const html = comprobanteHtml({ ...datos, estado });
    expect(html).not.toContain("No es un comprobante");
    expect(html).not.toContain("no tiene validez");
    expect(html).toMatch(/firma del trabajador/i);
  });

  it.each([
    ["BORRADOR", "No es un comprobante de pago"],
    ["CALCULADA", "No es un comprobante de pago"],
    ["ANULADA", "no tiene validez"],
  ])("%s lo advierte y no ofrece dónde firmar", (estado, texto) => {
    const html = comprobanteHtml({ ...datos, estado });
    expect(html).toContain(texto);
    expect(html).not.toMatch(/firma del trabajador/i);
  });
});
