/**
 * Documentos en PDF: constancias, contratos, cartas y el finiquito.
 *
 * Mismo pdfmake que los reportes (fuentes estándar, sin acceso a URL ni disco):
 * nada de lo que escriba un usuario en una plantilla puede hacer que el servidor
 * lea un archivo o descargue algo.
 *
 * Marcado mínimo en el texto de las plantillas: `**negrita**`. Nada más: el
 * documento lo firma una persona y tiene que leerse igual en cualquier lado.
 */

import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import { pdfmakeListo } from "@/lib/reportes/salida";

const TINTA = "#0D2B38";
const LINEA = "#C9D3D8";
const TENUE = "#5B6B74";

export interface EmpresaDoc {
  nombre: string;
  rtn?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
}

export interface FirmaDoc {
  nombre: string;
  cargo?: string | null;
  identidad?: string | null;
}

/**
 * «Texto con **negrita**» → fragmentos de pdfmake.
 *
 * La puntuación que sigue a una negrita se queda dentro de ella: al justificar,
 * pdfmake reparte espacio en cada frontera entre fragmentos aunque no haya un
 * espacio en el texto, y «S. de R.L., con» salía como «S. de R.L. , con».
 */
export function fragmentos(texto: string): ContentText["text"] {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  if (partes.length === 1 && !partes[0].startsWith("**")) return texto;
  const salida: { text: string; bold?: boolean }[] = [];
  for (const p of partes) {
    const negrita = p.startsWith("**") && p.endsWith("**") && p.length > 4;
    if (negrita) {
      salida.push({ text: p.slice(2, -2), bold: true });
      continue;
    }
    const previa = salida[salida.length - 1];
    const pegada = previa?.bold ? /^[,.;:)\]»”!?]+/.exec(p) : null;
    if (pegada) {
      previa.text += pegada[0];
      const resto = p.slice(pegada[0].length);
      if (resto) salida.push({ text: resto });
    } else {
      salida.push({ text: p });
    }
  }
  return salida;
}

/** Párrafos separados por una o más líneas en blanco; los saltos simples se respetan. */
export function parrafos(texto: string): string[] {
  return texto
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function membrete(e: EmpresaDoc): Content {
  const linea2 = [e.rtn ? `RTN ${e.rtn}` : null, e.telefono ? `Tel. ${e.telefono}` : null, e.email].filter(Boolean).join("   ");
  return {
    stack: [
      { text: e.nombre, fontSize: 13, bold: true, color: TINTA },
      e.direccion ? { text: e.direccion, fontSize: 8.5, color: TENUE, margin: [0, 2, 0, 0] } : { text: "" },
      linea2 ? { text: linea2, fontSize: 8.5, color: TENUE, margin: [0, 1, 0, 0] } : { text: "" },
      { canvas: [{ type: "line", x1: 0, y1: 6, x2: 540, y2: 6, lineWidth: 0.8, lineColor: TINTA }] },
    ],
    margin: [0, 0, 0, 18],
  } as unknown as Content;
}

function bloqueFirmas(firmas: FirmaDoc[]): Content {
  const celdas = firmas.map((f) => ({
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6, lineColor: TINTA }] },
      { text: f.nombre || " ", fontSize: 9.5, bold: true, margin: [0, 4, 0, 0] },
      f.cargo ? { text: f.cargo, fontSize: 8.5, color: TENUE } : { text: "" },
      f.identidad ? { text: `Identidad ${f.identidad}`, fontSize: 8.5, color: TENUE } : { text: "" },
    ],
    alignment: "center" as const,
  }));
  return { columns: celdas, columnGap: 40, margin: [0, 54, 0, 0], unbreakable: true } as unknown as Content;
}

function pie(folio?: string | null): TDocumentDefinitions["footer"] {
  return (pagina: number, total: number) => ({
    columns: [
      { text: folio ? `Folio ${folio}` : "", fontSize: 7.5, color: TENUE, margin: [48, 14, 0, 0] },
      { text: total > 1 ? `Página ${pagina} de ${total}` : "", fontSize: 7.5, color: TENUE, alignment: "right", margin: [0, 14, 48, 0] },
    ],
  });
}

export interface DatosCarta {
  empresa: EmpresaDoc;
  titulo: string;
  /** Texto ya resuelto (sin variables). Párrafos separados por línea en blanco. */
  contenido: string;
  /** «San Pedro Sula, 15 de octubre de 2026». */
  lugarFecha?: string | null;
  folio?: string | null;
  firmas: FirmaDoc[];
  /** Marca de agua, p. ej. «ANULADO». */
  marcaAgua?: string | null;
}

/** Constancia, contrato o carta: membrete, título, párrafos justificados y firmas. */
export async function pdfCarta(d: DatosCarta): Promise<Buffer> {
  const pdfmake = pdfmakeListo();
  const cuerpo: Content[] = parrafos(d.contenido).map((p) => ({
    text: fragmentos(p),
    fontSize: 10.5,
    lineHeight: 1.35,
    alignment: "justify" as const,
    margin: [0, 0, 0, 10],
  }));

  const definicion: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageMargins: [48, 44, 48, 52],
    defaultStyle: { font: "Helvetica", color: "#1B2A31" },
    info: { title: d.titulo, producer: "NominaHN" },
    watermark: d.marcaAgua ? { text: d.marcaAgua, color: "#B91C1C", opacity: 0.12, bold: true } : undefined,
    content: [
      membrete(d.empresa),
      d.lugarFecha ? { text: d.lugarFecha, fontSize: 10, alignment: "right", margin: [0, 0, 0, 18] } : { text: "" },
      { text: d.titulo.toUpperCase(), fontSize: 12.5, bold: true, alignment: "center", color: TINTA, margin: [0, 0, 0, 18] },
      ...cuerpo,
      d.firmas.length ? bloqueFirmas(d.firmas) : { text: "" },
    ],
    footer: pie(d.folio),
  };
  return pdfmake.createPdf(definicion).getBuffer();
}

// ─── Finiquito ────────────────────────────────────────────────────────────────

export interface ConceptoFiniquito {
  concepto: string;
  base: string;
  dias: number | null;
  monto: number;
}

export interface DatosFiniquito {
  empresa: EmpresaDoc;
  folio: string;
  estado: string;
  trabajador: { nombre: string; identidad?: string | null; codigo: string; puesto?: string | null; departamento?: string | null };
  causa: string;
  fechaIngreso: string;
  fechaSalida: string;
  tiempoServicio: string;
  salarioPromedio: number;
  salarioDiario: number;
  conceptos: ConceptoFiniquito[];
  totalPrestaciones: number;
  deducciones: number;
  totalAPagar: number;
  totalEnLetras: string;
  observaciones: string[];
  beneficiarios?: { nombre: string; parentesco: string; porcentaje: number }[];
  lugarFecha: string;
  firmante: FirmaDoc;
  /** Formateador de moneda de la aplicación. */
  moneda: (n: number) => string;
}

export async function pdfFiniquito(d: DatosFiniquito): Promise<Buffer> {
  const pdfmake = pdfmakeListo();
  const fila = (etiqueta: string, valor: string) => [
    { text: etiqueta, fontSize: 9, color: TENUE, margin: [0, 2, 8, 2] },
    { text: valor, fontSize: 9.5, margin: [0, 2, 0, 2] },
  ];

  const tablaConceptos = {
    table: {
      headerRows: 1,
      widths: ["*", "auto", 34, 78],
      body: [
        [
          { text: "Concepto", bold: true, fontSize: 9, color: "#FFFFFF", fillColor: TINTA, margin: [4, 4, 4, 4] },
          { text: "Fundamento", bold: true, fontSize: 9, color: "#FFFFFF", fillColor: TINTA, margin: [4, 4, 4, 4] },
          { text: "Días", bold: true, fontSize: 9, color: "#FFFFFF", fillColor: TINTA, alignment: "right", margin: [4, 4, 4, 4] },
          { text: "Monto", bold: true, fontSize: 9, color: "#FFFFFF", fillColor: TINTA, alignment: "right", margin: [4, 4, 4, 4] },
        ],
        ...d.conceptos.map((c) => [
          { text: c.concepto, fontSize: 9, margin: [4, 3, 4, 3] },
          { text: c.base, fontSize: 8, color: TENUE, margin: [4, 3, 4, 3] },
          { text: c.dias === null ? "" : String(c.dias), fontSize: 9, alignment: "right", margin: [4, 3, 4, 3] },
          { text: d.moneda(c.monto), fontSize: 9, alignment: "right", margin: [4, 3, 4, 3] },
        ]),
        [
          { text: "Total de prestaciones", colSpan: 3, bold: true, fontSize: 9.5, margin: [4, 4, 4, 2] }, {}, {},
          { text: d.moneda(d.totalPrestaciones), bold: true, fontSize: 9.5, alignment: "right", margin: [4, 4, 4, 2] },
        ],
        [
          { text: "Deducciones (anticipos y préstamos)", colSpan: 3, fontSize: 9, margin: [4, 2, 4, 2] }, {}, {},
          { text: d.deducciones ? `− ${d.moneda(d.deducciones)}` : d.moneda(0), fontSize: 9, alignment: "right", margin: [4, 2, 4, 2] },
        ],
        [
          { text: "Total a pagar", colSpan: 3, bold: true, fontSize: 10.5, fillColor: "#EBF0F2", margin: [4, 5, 4, 5] }, {}, {},
          { text: d.moneda(d.totalAPagar), bold: true, fontSize: 10.5, fillColor: "#EBF0F2", alignment: "right", margin: [4, 5, 4, 5] },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.4,
      vLineWidth: () => 0,
      hLineColor: () => LINEA,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  } as unknown as Content;

  const contenido: Content[] = [
    membrete(d.empresa),
    { text: "LIQUIDACIÓN DE PRESTACIONES LABORALES", fontSize: 12.5, bold: true, alignment: "center", color: TINTA },
    { text: d.lugarFecha, fontSize: 9, alignment: "center", color: TENUE, margin: [0, 2, 0, 14] },
    {
      table: {
        widths: [110, "*", 110, "*"],
        body: [
          [...fila("Trabajador", d.trabajador.nombre), ...fila("Código", d.trabajador.codigo)],
          [...fila("Identidad", d.trabajador.identidad || "—"), ...fila("Puesto", d.trabajador.puesto || d.trabajador.departamento || "—")],
          [...fila("Fecha de ingreso", d.fechaIngreso), ...fila("Fecha de salida", d.fechaSalida)],
          [...fila("Causa", d.causa), ...fila("Tiempo de servicio", d.tiempoServicio)],
          [...fila("Salario promedio mensual", d.moneda(d.salarioPromedio)), ...fila("Salario diario", d.moneda(d.salarioDiario))],
        ],
      },
      layout: "noBorders",
      margin: [0, 0, 0, 14],
    } as unknown as Content,
    tablaConceptos,
    { text: `Son: ${d.totalEnLetras}`, fontSize: 9, italics: true, margin: [0, 6, 0, 10] },
  ];

  if (d.observaciones.length) {
    contenido.push({ text: "Observaciones", fontSize: 9.5, bold: true, color: TINTA, margin: [0, 4, 0, 3] });
    contenido.push({ ul: d.observaciones.map((o) => ({ text: o, fontSize: 8.5, color: TENUE })), margin: [0, 0, 0, 8] });
  }

  if (d.beneficiarios?.length) {
    contenido.push({ text: "Beneficiarios designados", fontSize: 9.5, bold: true, color: TINTA, margin: [0, 6, 0, 3] });
    contenido.push({
      table: {
        widths: ["*", "auto", "auto", 78],
        body: d.beneficiarios.map((b) => [
          { text: b.nombre, fontSize: 9 },
          { text: b.parentesco, fontSize: 9, color: TENUE },
          { text: `${b.porcentaje.toFixed(2)} %`, fontSize: 9, alignment: "right" },
          { text: d.moneda((d.totalAPagar * b.porcentaje) / 100), fontSize: 9, alignment: "right" },
        ]),
      },
      layout: "lightHorizontalLines",
      margin: [0, 0, 0, 8],
    } as unknown as Content);
  }

  contenido.push({
    text:
      "Conforme al artículo 379 del Código del Trabajo, la liquidación o finiquito entre trabajador y patrono es válida cuando se hace ante las autoridades del trabajo correspondientes.",
    fontSize: 8,
    color: TENUE,
    margin: [0, 8, 0, 0],
  });
  contenido.push(
    bloqueFirmas([
      { nombre: d.trabajador.nombre, cargo: "Trabajador", identidad: d.trabajador.identidad },
      { nombre: d.firmante.nombre || "Por el patrono", cargo: d.firmante.cargo || "Por el patrono", identidad: null },
    ])
  );

  const vigente = d.estado === "APROBADA" || d.estado === "PAGADA";
  const definicion: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageMargins: [48, 44, 48, 52],
    defaultStyle: { font: "Helvetica", color: "#1B2A31" },
    info: { title: `Liquidación ${d.trabajador.nombre}`, producer: "NominaHN" },
    watermark: vigente ? undefined : { text: d.estado === "ANULADA" ? "ANULADA" : "BORRADOR", color: "#B91C1C", opacity: 0.12, bold: true },
    content: contenido,
    footer: pie(d.folio),
  };
  return pdfmake.createPdf(definicion).getBuffer();
}
