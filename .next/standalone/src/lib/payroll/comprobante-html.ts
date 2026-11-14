/**
 * El comprobante en HTML: lo que se ve en pantalla, se imprime y llega por correo.
 *
 * Por eso está armado con tablas y estilos en línea, como un correo y no como una
 * página: Outlook dibuja con el motor de Word y no entiende `flex` ni `grid`, y
 * Gmail recorta lo que no le gusta. Las reglas de `<style>` sólo mejoran: apilan
 * en un teléfono y quitan el marco al imprimir, y sin ellas sigue siendo legible.
 *
 * El diseño es tinta sobre papel a propósito. El color lo pone el logo de cada
 * sucursal, y una banda de color propia chocaría con el de alguna; además, la
 * mayoría se imprime en láser de un solo tono. Lo único que destaca es el neto,
 * que es lo primero que busca quien lo abre, con el doble filete del total contable.
 */

import { PRODUCTO } from "@/lib/marca";
import { ajustarACaja, LOGO_CAJA_ALTO, LOGO_CAJA_ANCHO } from "@/lib/organizacion/logo";
import { avisoDeEstado, filasDelTrabajador, lineasDeMembrete, PIE_COMPROBANTE, seFirma, type DatosBoleta } from "./comprobante";

/** Identificador del logo dentro de un correo: ver `adjuntoDelLogo`. */
export const CID_LOGO = "logo-sucursal";

export interface OpcionesComprobante {
  /**
   * `pantalla`: con barra de imprimir y descargar, y espacio de firma.
   * `correo`: sin barra ni firma, porque un correo no se firma.
   */
  modo?: "pantalla" | "correo";
  /**
   * `src` según la salida: en pantalla, los datos incrustados; en un correo,
   * `cid:`, porque Gmail y Outlook bloquean las imágenes incrustadas en el HTML.
   */
  logo?: { src: string; ancho: number; alto: number; alt?: string } | null;
  /** Autoriza el único script de la página, el botón de imprimir. */
  nonce?: string;
  urlPdf?: string;
}

const TINTA = "#0D2B38";
const TEXTO = "#1B2A31";
const TENUE = "#55656E";
const FILETE = "#D8E0E4";
const FILETE_SUAVE = "#E8EDF0";
const FONDO = "#EEF2F4";
const ALERTA = "#B91C1C";
const FUENTE = "'IBM Plex Sans','Segoe UI',Helvetica,Arial,sans-serif";
const CIFRAS = "font-variant-numeric:tabular-nums;white-space:nowrap";

/**
 * Escapa el texto que entra en la boleta. Los nombres y observaciones los editan
 * los usuarios, y la boleta se abre en un navegador o en un cliente de correo.
 */
function esc(valor: string): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tabla de maquetación, con sus estilos: un segundo atributo `style` el navegador lo ignora. */
const tabla = (estilos = "") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${estilos}">`;

function membrete(d: DatosBoleta, logo: OpcionesComprobante["logo"]): string {
  const medidas = logo ? ajustarACaja(logo.ancho, logo.alto, LOGO_CAJA_ANCHO, LOGO_CAJA_ALTO) : null;
  const imagen = logo && medidas
    ? `<img src="${esc(logo.src)}" width="${medidas.ancho}" height="${medidas.alto}" alt="${esc(logo.alt ?? "")}" style="display:block;border:0;margin:0 0 12px">`
    : "";
  const pequena = (texto: string) => `<div style="font-size:12px;line-height:1.5;color:${TENUE}">${esc(texto)}</div>`;
  const pago = d.fechaPago ? pequena(`Fecha de pago ${d.fechaPago}`) : "";

  return `${tabla()}<tr>
  <td class="apila" valign="top" style="vertical-align:top;padding:0 24px 0 0">
    ${imagen}
    <div style="font-size:15px;line-height:1.35;font-weight:600;color:${TINTA}">${esc(d.empresa)}</div>
    ${lineasDeMembrete(d).map(pequena).join("\n    ")}
  </td>
  <td class="apila datos-doc" valign="top" align="right" width="210" style="vertical-align:top;text-align:right">
    <h1 style="margin:0;font-size:15px;line-height:1.35;font-weight:600;color:${TINTA}">Comprobante de pago</h1>
    ${pequena(d.tipoPlanilla)}
    ${pequena(d.periodo)}
    ${pago}
  </td>
</tr></table>`;
}

function trabajadorYNeto(d: DatosBoleta): string {
  const dato = ([etiqueta, valor]: [string, string]) =>
    `<td valign="top" width="50%" style="vertical-align:top;padding:6px 12px 0 0;font-size:12px;line-height:1.4"><div style="color:${TENUE}">${esc(etiqueta)}</div><div style="color:${TEXTO}">${esc(valor)}</div></td>`;
  const filas = filasDelTrabajador(d).map((f) => `<tr>${f.map(dato).join("")}${f.length < 2 ? '<td width="50%"></td>' : ""}</tr>`);

  return `${tabla(`margin-top:20px;border-top:2px solid ${TINTA}`)}<tr>
  <td class="apila" valign="top" style="vertical-align:top;padding:16px 24px 20px 0">
    <div style="font-size:16px;line-height:1.3;font-weight:600;color:${TINTA}">${esc(d.nombreEmpleado)}</div>
    ${tabla("margin-top:2px")}${filas.join("")}</table>
  </td>
  <td class="apila bloque-neto" valign="top" align="right" width="210" style="vertical-align:top;text-align:right;padding:16px 0 20px">
    <div style="font-size:12px;line-height:1.4;color:${TENUE}">Neto a recibir</div>
    <div style="display:inline-block;font-size:30px;line-height:1.2;font-weight:600;color:${TINTA};border-bottom:3px double ${TINTA};padding-bottom:3px;${CIFRAS}">${esc(d.salarioNeto)}</div>
  </td>
</tr></table>`;
}

/**
 * Una lista de importes con su total. `filas` iguala las dos columnas para que
 * los totales queden a la misma altura; en un teléfono el relleno se oculta.
 */
function lista(titulo: string, pares: Array<[string, string]>, etiquetaTotal: string, total: string, filas: number): string {
  // El filete va arriba de cada fila y no abajo: al colapsar los bordes, uno de la
  // fila anterior le gana al del total, que no se veía.
  const celda = (i: number) => `padding:5px 0;border-top:${i === 0 ? "0" : `1px solid ${FILETE_SUAVE}`};font-size:12.5px;line-height:1.35;color:${TEXTO}`;
  const lineas = pares.length
    ? pares.map(([k, v], i) => `<tr><td style="${celda(i)};padding-right:10px">${esc(k)}</td><td align="right" style="${celda(i)};text-align:right;${CIFRAS}">${esc(v)}</td></tr>`)
    : [`<tr><td colspan="2" style="${celda(0)};color:${TENUE}">Sin ${esc(titulo.toLowerCase())} en este período</td></tr>`];
  // El relleno ocupa lo mismo, pero en blanco: con filete visible parecería renglones
  // de un formulario por llenar. Blanco y no `transparent`, que Outlook pinta de negro.
  const relleno = Array.from({ length: Math.max(0, filas - Math.max(pares.length, 1)) }, () =>
    `<tr class="relleno"><td colspan="2" style="padding:5px 0;border-top:1px solid #FFFFFF;font-size:12.5px;line-height:1.35">&nbsp;</td></tr>`);
  const pieCelda = `padding:7px 0 0;border-top:1px solid ${TINTA};font-size:12.5px;line-height:1.35;font-weight:600;color:${TINTA}`;

  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <thead><tr><th colspan="2" scope="colgroup" align="left" style="padding:0 0 6px;border-bottom:1px solid ${TINTA};text-align:left;font-size:12.5px;font-weight:600;color:${TINTA}">${esc(titulo)}</th></tr></thead>
    <tbody>
      ${[...lineas, ...relleno].join("\n      ")}
      <tr><td style="${pieCelda};padding-right:10px">${esc(etiquetaTotal)}</td><td align="right" style="${pieCelda};text-align:right;${CIFRAS}">${esc(total)}</td></tr>
    </tbody>
  </table>`;
}

function constancia(d: DatosBoleta, conFirma: boolean): string {
  const letras = d.netoEnLetras
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${TEXTO}"><span style="color:${TENUE}">Son:</span> ${esc(d.netoEnLetras)}</p>`
    : "";
  if (!conFirma) return letras;
  const linea = `border-top:1px solid ${TINTA};padding-top:5px;font-size:11.5px;line-height:1.4;color:${TENUE}`;
  return `${letras}
${tabla("margin-top:52px").replace("<table ", '<table class="firma" ')}<tr>
  <td class="apila" style="${linea}">Recibí conforme (firma del trabajador)</td>
  <td class="relleno" width="28">&nbsp;</td>
  <td class="apila fecha-firma" width="150" style="${linea}">Fecha</td>
</tr></table>`;
}

/** Sólo en pantalla, fuera de la hoja: no se imprime ni se envía. */
function barra(o: OpcionesComprobante): string {
  const boton = `display:inline-block;padding:7px 14px;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;font-family:${FUENTE}`;
  const pdf = o.urlPdf ? `<a href="${esc(o.urlPdf)}" style="${boton};color:${TINTA};border:1px solid ${FILETE};background:#fff">Descargar PDF</a>` : "";
  // Se imprime el PDF y no esta página: es el que va en media carta, con la copia
  // del empleado y la de la empresa en la misma hoja (pedido del 2026-11-14).
  const imprimir = o.urlPdf
    ? `<a href="${esc(o.urlPdf)}?modo=imprimir" target="_blank" rel="noopener" title="Hoja carta con dos copias: empleado y empresa" style="${boton};color:#fff;background:${TINTA};border:1px solid ${TINTA};margin-left:8px">Imprimir</a>`
    : "";
  return pdf || imprimir ? `<nav class="no-imprimir" aria-label="Acciones del comprobante" style="max-width:680px;margin:0 auto;padding:16px 12px 0;text-align:right">${pdf}${imprimir}</nav>` : "";
}

export function comprobanteHtml(d: DatosBoleta, o: OpcionesComprobante = {}): string {
  const modo = o.modo ?? "pantalla";
  const aviso = avisoDeEstado(d.estado);
  const filas = Math.max(d.ingresos.length, d.deducciones.length, 1);
  const pie = [d.emitido ? `Emitido el ${d.emitido} con ${PRODUCTO}.` : `Emitido con ${PRODUCTO}.`, PIE_COMPROBANTE].join(" ");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprobante de pago del ${esc(d.periodo)}</title>
<style>
  @page { size: letter; margin: 15mm; }
  @media print {
    body { background: #fff !important; }
    .no-imprimir { display: none !important; }
    .marco, .interior { padding: 0 !important; }
    .hoja { border: 0 !important; max-width: none !important; }
    .firma { page-break-inside: avoid; }
  }
  @media (max-width: 600px) {
    .marco { padding: 8px 0 !important; }
    .hoja { border-left: 0 !important; border-right: 0 !important; }
    .interior { padding: 20px 16px !important; }
    .apila { display: block !important; width: 100% !important; box-sizing: border-box; padding-left: 0 !important; padding-right: 0 !important; }
    .datos-doc, .bloque-neto { text-align: left !important; }
    .datos-doc { padding-top: 14px !important; }
    .bloque-neto { padding-top: 0 !important; }
    .columna-der { padding-top: 24px !important; }
    .fecha-firma { margin-top: 36px; }
    .relleno { display: none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${FONDO};font-family:${FUENTE};color:${TEXTO}">
${modo === "pantalla" ? barra(o) : ""}
<main>
${tabla()}<tr><td class="marco" align="center" style="padding:16px 12px 32px">
  <table class="hoja" role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:separate;background:#fff;border:1px solid ${FILETE};text-align:left">
    <tr><td class="interior" style="padding:32px 36px;font-family:${FUENTE}">
${aviso ? `<p style="margin:0 0 20px;padding:9px 12px;border:1.5px solid ${ALERTA};color:${ALERTA};font-size:13px;font-weight:600">${esc(aviso.texto)}</p>` : ""}
${membrete(d, o.logo)}
${trabajadorYNeto(d)}
${tabla()}<tr>
  <td class="apila" valign="top" width="50%" style="vertical-align:top;padding:4px 16px 0 0">${lista("Ingresos", d.ingresos, "Total devengado", d.totalBruto, filas)}</td>
  <td class="apila columna-der" valign="top" width="50%" style="vertical-align:top;padding:4px 0 0 16px">${lista("Deducciones", d.deducciones, "Total deducciones", d.totalDeducciones, filas)}</td>
</tr></table>
${constancia(d, modo === "pantalla" && seFirma(d))}
<p style="margin:28px 0 0;font-size:11px;line-height:1.5;color:${TENUE}">${esc(pie)}</p>
    </td></tr>
  </table>
</td></tr></table>
</main>
</body>
</html>`;
}

/** El logo como adjunto en línea de un correo, al que apunta `cid:` en el HTML. */
export function adjuntoDelLogo(png: Buffer) {
  return { filename: "logo.png", content: png, contentType: "image/png", cid: CID_LOGO, contentDisposition: "inline" as const };
}
