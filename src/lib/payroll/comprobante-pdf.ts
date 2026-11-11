/**
 * El comprobante en PDF: lo que se descarga. Un archivo .html no se abre bien en
 * un teléfono, ni se puede entregar a un banco como constancia de ingresos.
 *
 * Mismo pdfmake y misma tipografía estándar que los demás documentos. El diseño
 * es el de `comprobante-html.ts`, y el texto sale de las mismas funciones.
 */

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { pdfmakeListo } from "@/lib/reportes/salida";
import { PRODUCTO } from "@/lib/marca";
import { LOGO_CAJA_ALTO, LOGO_CAJA_ANCHO } from "@/lib/organizacion/logo";
import type { LogoDocumento } from "@/lib/organizacion/logo-bd";
import { avisoDeEstado, filasDelTrabajador, lineasDeMembrete, PIE_COMPROBANTE, seFirma, type DatosBoleta } from "./comprobante";

const TINTA = "#0D2B38";
const TEXTO = "#1B2A31";
const TENUE = "#55656E";
const FILETE_SUAVE = "#E8EDF0";
const ALERTA = "#B91C1C";

/** Carta menos los márgenes laterales de 48 pt. */
const ANCHO_UTIL = 516;
const ANCHO_DERECHA = 170;
const SEPARACION = 24;
const ANCHO_LISTA = (ANCHO_UTIL - SEPARACION) / 2;
const ANCHO_FECHA = 150;
const GROSOR_FILETE_SUAVE = 0.4;

const cuadro = (c: unknown) => c as Content;

/** Línea horizontal del ancho dado. */
const filete = (ancho: number, grosor: number, color: string, margen: [number, number, number, number] = [0, 0, 0, 0]) => cuadro({
  canvas: [{ type: "line", x1: 0, y1: 0, x2: ancho, y2: 0, lineWidth: grosor, lineColor: color }],
  margin: margen,
});

function membrete(d: DatosBoleta, logo: LogoDocumento | null | undefined): Content {
  return cuadro({
    columns: [
      {
        width: "*",
        stack: [
          logo ? { image: `data:image/png;base64,${logo.png.toString("base64")}`, fit: [LOGO_CAJA_ANCHO * 0.75, LOGO_CAJA_ALTO * 0.75], margin: [0, 0, 0, 8] } : { text: "" },
          { text: d.empresa, fontSize: 11.5, bold: true, color: TINTA },
          ...lineasDeMembrete(d).map((l) => ({ text: l, fontSize: 8.5, color: TENUE, margin: [0, 2.5, 0, 0] })),
        ],
      },
      {
        width: ANCHO_DERECHA,
        alignment: "right",
        stack: [
          { text: "Comprobante de pago", fontSize: 11.5, bold: true, color: TINTA },
          { text: d.tipoPlanilla, fontSize: 8.5, color: TENUE, margin: [0, 2.5, 0, 0] },
          { text: d.periodo, fontSize: 8.5, color: TENUE, margin: [0, 2.5, 0, 0] },
          d.fechaPago ? { text: `Fecha de pago ${d.fechaPago}`, fontSize: 8.5, color: TENUE, margin: [0, 2.5, 0, 0] } : { text: "" },
        ],
      },
    ],
    columnGap: SEPARACION,
  });
}

function trabajadorYNeto(d: DatosBoleta): Content {
  const celda = ([etiqueta, valor]: [string, string]) => ({
    stack: [{ text: etiqueta, fontSize: 8.5, color: TENUE }, { text: valor, fontSize: 9, color: TEXTO, margin: [0, 2, 0, 0] }],
    margin: [0, 4, 8, 0],
  });
  const filas = filasDelTrabajador(d).map((f) => [celda(f[0]), f[1] ? celda(f[1]) : { text: "" }]);

  return cuadro({
    columns: [
      {
        width: "*",
        stack: [
          { text: d.nombreEmpleado, fontSize: 12, bold: true, color: TINTA, margin: [0, 0, 0, 3] },
          { table: { widths: ["*", "*"], body: filas }, layout: "noBorders" },
        ],
      },
      {
        width: ANCHO_DERECHA,
        stack: [
          { text: "Neto a recibir", fontSize: 8.5, color: TENUE, alignment: "right", margin: [0, 0, 0, 2] },
          {
            // Tabla de ancho automático para que el doble filete mida lo mismo que la cifra.
            columns: [
              { width: "*", text: "" },
              {
                width: "auto",
                table: { widths: ["auto"], body: [[{ text: d.salarioNeto, fontSize: 22, bold: true, color: TINTA, noWrap: true }], [{ text: "", fontSize: 1 }]] },
                layout: {
                  hLineWidth: (i: number) => (i === 1 || i === 2 ? 0.8 : 0),
                  hLineColor: () => TINTA,
                  vLineWidth: () => 0,
                  paddingLeft: () => 0,
                  paddingRight: () => 0,
                  paddingTop: () => 0,
                  paddingBottom: (i: number) => (i === 0 ? 3 : 0),
                },
              },
            ],
          },
        ],
      },
    ],
    columnGap: SEPARACION,
    margin: [0, 11, 0, 12],
  });
}

/** `filas` iguala las dos columnas para que los totales queden a la misma altura. */
function lista(titulo: string, pares: Array<[string, string]>, etiquetaTotal: string, total: string, filas: number): Content {
  const lineas = pares.length
    ? pares.map(([k, v]) => [{ text: k, fontSize: 9, margin: [0, 3, 6, 3] }, { text: v, fontSize: 9, alignment: "right", noWrap: true, margin: [0, 3, 0, 3] }])
    : [[{ text: `Sin ${titulo.toLowerCase()} en este período`, fontSize: 9, color: TENUE, colSpan: 2, margin: [0, 3, 0, 3] }, {}]];
  // El relleno no lleva filete, y ese grosor lo compensa abajo: si no, los dos totales no coinciden.
  const relleno = Array.from({ length: Math.max(0, filas - Math.max(pares.length, 1)) }, () => [
    { text: " ", fontSize: 9, margin: [0, 3, 6, 3 + GROSOR_FILETE_SUAVE] }, { text: " ", fontSize: 9, margin: [0, 3, 0, 3 + GROSOR_FILETE_SUAVE] },
  ]);
  const cuerpo = [
    [{ text: titulo, bold: true, fontSize: 9, color: TINTA, colSpan: 2, margin: [0, 0, 0, 4] }, {}],
    ...lineas,
    ...relleno,
    [{ text: etiquetaTotal, bold: true, fontSize: 9, color: TINTA, margin: [0, 5, 6, 0] }, { text: total, bold: true, fontSize: 9, color: TINTA, alignment: "right", noWrap: true, margin: [0, 5, 0, 0] }],
  ];
  const ultima = cuerpo.length - 1;
  return cuadro({
    table: { widths: ["*", "auto"], body: cuerpo },
    layout: {
      // Filete fuerte bajo el título y sobre el total; suave entre importes. El
      // relleno va sin filetes: con ellos parecen renglones de un formulario por llenar.
      hLineWidth: (i: number) => (i === 1 || i === ultima ? 0.8 : i > 1 && i <= lineas.length ? GROSOR_FILETE_SUAVE : 0),
      hLineColor: (i: number) => (i === 1 || i === ultima ? TINTA : FILETE_SUAVE),
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  });
}

export async function pdfComprobante(d: DatosBoleta, logo?: LogoDocumento | null): Promise<Buffer> {
  const pdfmake = pdfmakeListo();
  const aviso = avisoDeEstado(d.estado);
  const filas = Math.max(d.ingresos.length, d.deducciones.length, 1);

  const contenido: Content[] = [
    aviso
      ? cuadro({ table: { widths: ["*"], body: [[{ text: aviso.texto, bold: true, fontSize: 9.5, color: ALERTA, margin: [6, 4, 6, 4] }]] }, layout: { hLineColor: () => ALERTA, vLineColor: () => ALERTA, hLineWidth: () => 1, vLineWidth: () => 1 }, margin: [0, 0, 0, 14] })
      : { text: "" },
    membrete(d, logo),
    filete(ANCHO_UTIL, 1.5, TINTA, [0, 14, 0, 0]),
    trabajadorYNeto(d),
    cuadro({
      columns: [
        { width: ANCHO_LISTA, stack: [lista("Ingresos", d.ingresos, "Total devengado", d.totalBruto, filas)] },
        { width: ANCHO_LISTA, stack: [lista("Deducciones", d.deducciones, "Total deducciones", d.totalDeducciones, filas)] },
      ],
      columnGap: SEPARACION,
    }),
    d.netoEnLetras
      ? { text: [{ text: "Son: ", color: TENUE }, { text: d.netoEnLetras }], fontSize: 9, margin: [0, 14, 0, 0] }
      : { text: "" },
  ];

  if (seFirma(d)) {
    contenido.push(cuadro({
      columns: [
        { width: ANCHO_UTIL - ANCHO_FECHA - SEPARACION, stack: [filete(ANCHO_UTIL - ANCHO_FECHA - SEPARACION, 0.6, TINTA), { text: "Recibí conforme (firma del trabajador)", fontSize: 8.5, color: TENUE, margin: [0, 4, 0, 0] }] },
        { width: ANCHO_FECHA, stack: [filete(ANCHO_FECHA, 0.6, TINTA), { text: "Fecha", fontSize: 8.5, color: TENUE, margin: [0, 4, 0, 0] }] },
      ],
      columnGap: SEPARACION,
      margin: [0, 46, 0, 0],
      unbreakable: true,
    }));
  }

  contenido.push({
    text: `${d.emitido ? `Emitido el ${d.emitido} con ${PRODUCTO}.` : `Emitido con ${PRODUCTO}.`} ${PIE_COMPROBANTE}`,
    fontSize: 7.5,
    color: TENUE,
    margin: [0, 22, 0, 0],
  });

  const definicion: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageMargins: [48, 44, 48, 44],
    defaultStyle: { font: "Helvetica", color: TEXTO },
    info: { title: `Comprobante de pago del ${d.periodo}`, producer: PRODUCTO },
    watermark: aviso ? { text: aviso.marca, color: ALERTA, opacity: 0.1, bold: true } : undefined,
    content: contenido,
  };
  return pdfmake.createPdf(definicion).getBuffer();
}
