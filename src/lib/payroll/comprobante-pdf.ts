/**
 * El comprobante en PDF: lo que se descarga y se imprime. Un archivo .html no se
 * abre bien en un teléfono, ni se puede entregar a un banco como constancia de ingresos.
 *
 * MEDIA CARTA, DOS COPIAS (pedido del 2026-11-14): una hoja carta con el mismo
 * comprobante dos veces, separado por una línea de corte: arriba la copia del
 * empleado y abajo la de la empresa, cada una con su firma; la empresa archiva la
 * firmada. Cada copia vive en su mitad (396 pt) con posición absoluta, así una no
 * empuja a la otra; los tamaños están medidos para que quepa el caso más largo que
 * produce `construirBoleta` (4 ingresos frente a 13 deducciones, con aviso de estado).
 * Si alguna vez no cabe, cada copia va en su propia hoja, en la mitad de arriba.
 *
 * Mismo pdfmake y misma tipografía estándar que los demás documentos. El texto sale
 * de las mismas funciones que `comprobante-html.ts`.
 */

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { pdfmakeListo } from "@/lib/reportes/salida";
import { PRODUCTO } from "@/lib/marca";
import type { LogoDocumento } from "@/lib/organizacion/logo-bd";
import { avisoDeEstado, cuadriculaDelTrabajador, lineasDeMembrete, PIE_COMPROBANTE, seFirma, type DatosBoleta } from "./comprobante";

const TINTA = "#0D2B38";
const TEXTO = "#1B2A31";
const TENUE = "#55656E";
const FILETE_SUAVE = "#E8EDF0";
const ALERTA = "#B91C1C";

/** Carta: 612 × 792 pt. Cada copia ocupa media hoja. */
const ANCHO_HOJA = 612;
const MEDIA_HOJA = 396;
const MARGEN_X = 36;
const MARGEN_Y = 20;
const ANCHO_UTIL = ANCHO_HOJA - 2 * MARGEN_X; // 540
/** Lo que puede medir una copia sin invadir la línea de corte. */
const ALTO_COPIA = MEDIA_HOJA - 2 * MARGEN_Y + 6;
const ANCHO_DERECHA = 160;
const SEPARACION = 20;
const ANCHO_LISTA = (ANCHO_UTIL - SEPARACION) / 2;
/** Las cuatro columnas de datos: código y días, identidad y sueldo, y lo que queda para puesto y departamento. */
const ANCHO_DATOS = ANCHO_UTIL - ANCHO_DERECHA - SEPARACION; // 360
const ANCHOS_DATOS: readonly number[] = Object.freeze([60, 80, (ANCHO_DATOS - 140) / 2, (ANCHO_DATOS - 140) / 2]);
const MARGEN_DATO = 6;
/** Renglones que ocupa un valor de 8 pt en su columna (Helvetica: ~4.4 pt por carácter, por arriba). */
const renglones = (texto: string, ancho: number) => Math.max(1, Math.ceil((texto.length * 4.4) / (ancho - MARGEN_DATO)));
const ANCHO_FECHA = 130;
const LOGO_MAX: [number, number] = [110, 38];
const GROSOR_FILETE_SUAVE = 0.4;

/** Medidas de una fila de importes según cuántas haya: con muchas, más juntas. */
const densidad = (filas: number) => (filas > 9 ? { relleno: 1.3, fuente: 7.5 } : { relleno: 2.2, fuente: 8 });

const cuadro = (c: unknown) => c as Content;

/** Línea horizontal del ancho dado. */
const filete = (ancho: number, grosor: number, color: string, margen: [number, number, number, number] = [0, 0, 0, 0], guiones?: { length: number; space: number }) => cuadro({
  canvas: [{ type: "line", x1: 0, y1: 0, x2: ancho, y2: 0, lineWidth: grosor, lineColor: color, ...(guiones ? { dash: guiones } : {}) }],
  margin: margen,
});

function membrete(d: DatosBoleta, logo: LogoDocumento | null | undefined, copia: string): Content {
  const lineas = lineasDeMembrete(d).map((l) => ({ text: l, fontSize: 7.5, color: TENUE, margin: [0, 1.5, 0, 0] }));
  const textoEmpresa = { width: "*", stack: [{ text: d.empresa, fontSize: 10.5, bold: true, color: TINTA }, ...lineas] };
  return cuadro({
    columns: [
      // El logo a la izquierda y no encima: en media hoja no sobra altura.
      ...(logo ? [{ width: "auto", image: `data:image/png;base64,${logo.png.toString("base64")}`, fit: LOGO_MAX, margin: [0, 0, 10, 0] }] : []),
      textoEmpresa,
      {
        width: ANCHO_DERECHA,
        alignment: "right",
        stack: [
          { text: copia.toUpperCase(), fontSize: 6.5, bold: true, color: TENUE, characterSpacing: 0.6, margin: [0, 0, 0, 2] },
          { text: "Comprobante de pago", fontSize: 10.5, bold: true, color: TINTA },
          { text: d.tipoPlanilla, fontSize: 7.5, color: TENUE, margin: [0, 1.5, 0, 0] },
          { text: d.periodo, fontSize: 7.5, color: TENUE, margin: [0, 1.5, 0, 0] },
          d.fechaPago ? { text: `Fecha de pago ${d.fechaPago}`, fontSize: 7.5, color: TENUE, margin: [0, 1.5, 0, 0] } : { text: "" },
        ],
      },
    ],
    columnGap: SEPARACION,
  });
}

function trabajadorYNeto(d: DatosBoleta): Content {
  const celda = ([etiqueta, valor]: [string, string]) => ({
    stack: [{ text: etiqueta, fontSize: 6.5, color: TENUE }, { text: valor, fontSize: 8, color: TEXTO, margin: [0, 1, 0, 0] }],
    margin: [0, 3, MARGEN_DATO, 0],
  });
  // En cuatro columnas, cada dato en su lugar fijo (ver `cuadriculaDelTrabajador`).
  const filas: Content[][] = cuadriculaDelTrabajador(d).map((fila) => fila.map((x) => (x ? celda(x) : { text: "" })) as Content[]);

  return cuadro({
    columns: [
      {
        width: "*",
        stack: [
          { text: d.nombreEmpleado, fontSize: 10.5, bold: true, color: TINTA },
          // Una copia: pdfmake reescribe en su lugar el arreglo de anchos que recibe.
          filas.length ? { table: { widths: [...ANCHOS_DATOS], body: filas }, layout: "noBorders" } : { text: "" },
        ],
      },
      {
        width: ANCHO_DERECHA,
        stack: [
          { text: "Neto a recibir", fontSize: 7.5, color: TENUE, alignment: "right", margin: [0, 0, 0, 1] },
          {
            // Tabla de ancho automático para que el doble filete mida lo mismo que la cifra.
            columns: [
              { width: "*", text: "" },
              {
                width: "auto",
                table: { widths: ["auto"], body: [[{ text: d.salarioNeto, fontSize: 16, bold: true, color: TINTA, noWrap: true }], [{ text: "", fontSize: 1 }]] },
                layout: {
                  hLineWidth: (i: number) => (i === 1 || i === 2 ? 0.8 : 0),
                  hLineColor: () => TINTA,
                  vLineWidth: () => 0,
                  paddingLeft: () => 0,
                  paddingRight: () => 0,
                  paddingTop: () => 0,
                  paddingBottom: (i: number) => (i === 0 ? 2 : 0),
                },
              },
            ],
          },
        ],
      },
    ],
    columnGap: SEPARACION,
    margin: [0, 6, 0, 7],
  });
}

/** `filas` iguala las dos columnas para que los totales queden a la misma altura. */
function lista(titulo: string, pares: Array<[string, string]>, etiquetaTotal: string, total: string, filas: number): Content {
  const { relleno: r, fuente: f } = densidad(filas);
  const lineas = pares.length
    ? pares.map(([k, v]) => [{ text: k, fontSize: f, margin: [0, r, 6, r] }, { text: v, fontSize: f, alignment: "right", noWrap: true, margin: [0, r, 0, r] }])
    : [[{ text: `Sin ${titulo.toLowerCase()} en este período`, fontSize: f, color: TENUE, colSpan: 2, margin: [0, r, 0, r] }, {}]];
  // El relleno no lleva filete, y ese grosor lo compensa abajo: si no, los dos totales no coinciden.
  const vacias = Array.from({ length: Math.max(0, filas - Math.max(pares.length, 1)) }, () => [
    { text: " ", fontSize: f, margin: [0, r, 6, r + GROSOR_FILETE_SUAVE] }, { text: " ", fontSize: f, margin: [0, r, 0, r + GROSOR_FILETE_SUAVE] },
  ]);
  const cuerpo = [
    [{ text: titulo, bold: true, fontSize: 8, color: TINTA, colSpan: 2, margin: [0, 0, 0, 2.5] }, {}],
    ...lineas,
    ...vacias,
    [{ text: etiquetaTotal, bold: true, fontSize: 8, color: TINTA, margin: [0, 3, 6, 0] }, { text: total, bold: true, fontSize: 8, color: TINTA, alignment: "right", noWrap: true, margin: [0, 3, 0, 0] }],
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

/**
 * Lo que mide una copia, por arriba: sirve para decidir si las dos caben en una
 * hoja. Cuenta las líneas de texto con su interlineado (Helvetica ≈ 1.16 × tamaño).
 */
export function altoEstimadoCopia(d: DatosBoleta, conLogo: boolean): number {
  const lh = (pt: number) => pt * 1.16;
  const filas = Math.max(d.ingresos.length, d.deducciones.length, 1);
  const { relleno, fuente } = densidad(filas);
  // Una línea de contacto larga se parte en dos.
  const lineasMembrete = lineasDeMembrete(d).reduce((n, l) => n + (l.length > 95 ? 2 : 1), 0);
  const izquierda = lh(10.5) + lineasMembrete * (lh(7.5) + 1.5);
  const derecha = lh(6.5) + 2 + lh(10.5) + 3 * (lh(7.5) + 1.5);
  const membrete = Math.max(izquierda, derecha, conLogo ? LOGO_MAX[1] : 0);
  // Cada fila mide lo que su valor más largo: un puesto largo se parte en dos renglones.
  const datos = cuadriculaDelTrabajador(d).reduce((suma, fila) => {
    const alto = Math.max(...fila.map((x, i) => (x ? renglones(x[1], ANCHOS_DATOS[i]) : 1)));
    return suma + 3 + lh(6.5) + 1 + alto * lh(8);
  }, 0);
  const trabajador = Math.max(lh(10.5) + datos, lh(7.5) + 1 + lh(16) + 3) + 13;
  const listas = lh(8) + 2.5 + filas * (lh(fuente) + 2 * relleno + GROSOR_FILETE_SUAVE) + 3 + lh(8) + 2;
  const aviso = avisoDeEstado(d.estado) ? lh(8) + 6 + 8 : 0;
  const letras = d.netoEnLetras ? lh(7.5) * (d.netoEnLetras.length > 120 ? 2 : 1) + 6 : 0;
  const firma = seFirma(d) ? 22 + 1 + lh(7) + 3 : 0;
  const pie = lh(6.5) + 6;
  return aviso + membrete + 7 + trabajador + listas + letras + firma + pie;
}

function copia(d: DatosBoleta, logo: LogoDocumento | null | undefined, rotulo: string): Content[] {
  const aviso = avisoDeEstado(d.estado);
  const filas = Math.max(d.ingresos.length, d.deducciones.length, 1);
  const contenido: Content[] = [
    aviso
      ? cuadro({ table: { widths: ["*"], body: [[{ text: aviso.texto, bold: true, fontSize: 8, color: ALERTA, margin: [5, 2, 5, 2] }]] }, layout: { hLineColor: () => ALERTA, vLineColor: () => ALERTA, hLineWidth: () => 1, vLineWidth: () => 1 }, margin: [0, 0, 0, 8] })
      : { text: "" },
    membrete(d, logo, rotulo),
    filete(ANCHO_UTIL, 1.2, TINTA, [0, 7, 0, 0]),
    trabajadorYNeto(d),
    cuadro({
      columns: [
        { width: ANCHO_LISTA, stack: [lista("Ingresos", d.ingresos, "Total devengado", d.totalBruto, filas)] },
        { width: ANCHO_LISTA, stack: [lista("Deducciones", d.deducciones, "Total deducciones", d.totalDeducciones, filas)] },
      ],
      columnGap: SEPARACION,
    }),
    d.netoEnLetras
      ? { text: [{ text: "Son: ", color: TENUE }, { text: d.netoEnLetras }], fontSize: 7.5, margin: [0, 6, 0, 0] }
      : { text: "" },
  ];

  if (seFirma(d)) {
    contenido.push(cuadro({
      columns: [
        { width: ANCHO_UTIL - ANCHO_FECHA - SEPARACION, stack: [filete(ANCHO_UTIL - ANCHO_FECHA - SEPARACION, 0.6, TINTA), { text: "Recibí conforme (firma del trabajador)", fontSize: 7, color: TENUE, margin: [0, 3, 0, 0] }] },
        { width: ANCHO_FECHA, stack: [filete(ANCHO_FECHA, 0.6, TINTA), { text: "Fecha", fontSize: 7, color: TENUE, margin: [0, 3, 0, 0] }] },
      ],
      columnGap: SEPARACION,
      margin: [0, 22, 0, 0],
    }));
  }

  contenido.push({
    text: `${d.emitido ? `Emitido el ${d.emitido} con ${PRODUCTO}.` : `Emitido con ${PRODUCTO}.`} ${PIE_COMPROBANTE}`,
    fontSize: 6.5,
    color: TENUE,
    margin: [0, 6, 0, 0],
  });
  return contenido;
}

export const COPIAS_COMPROBANTE = ["Copia del empleado", "Copia de la empresa"] as const;

/**
 * Las hojas de un comprobante: una carta con las dos copias o, si no caben, una hoja por
 * copia. `nuevaHoja` lo empieza en una hoja aparte (todos menos el primero de un lote).
 */
function hojasDeComprobante(d: DatosBoleta, logo: LogoDocumento | null | undefined, nuevaHoja: boolean): Content[] {
  const caben = altoEstimadoCopia(d, !!logo) <= ALTO_COPIA;
  if (!caben) {
    return [
      cuadro({ stack: copia(d, logo, COPIAS_COMPROBANTE[0]), ...(nuevaHoja ? { pageBreak: "before" } : {}) }),
      cuadro({ stack: copia(d, logo, COPIAS_COMPROBANTE[1]), pageBreak: "before" }),
    ];
  }
  const corte = cuadro({
    stack: [
      filete(ANCHO_HOJA - 2 * 18, 0.5, TENUE, [0, 0, 0, 0], { length: 4, space: 3 }),
      { text: "cortar aquí", fontSize: 5.5, color: TENUE, alignment: "center", margin: [0, 2, 0, 0] },
    ],
    absolutePosition: { x: 18, y: MEDIA_HOJA },
  });
  // Cada copia en su mitad, con posición absoluta: si una crece, no mueve a la otra. Lo
  // absoluto se dibuja en la hoja en curso: un salto vacío abre la del siguiente empleado.
  return [
    ...(nuevaHoja ? [cuadro({ text: "", pageBreak: "before" })] : []),
    cuadro({ stack: copia(d, logo, COPIAS_COMPROBANTE[0]), absolutePosition: { x: MARGEN_X, y: MARGEN_Y } }),
    corte,
    cuadro({ stack: copia(d, logo, COPIAS_COMPROBANTE[1]), absolutePosition: { x: MARGEN_X, y: MEDIA_HOJA + MARGEN_Y } }),
  ];
}

const BASE_DOCUMENTO = {
  pageSize: "LETTER" as const,
  pageMargins: [MARGEN_X, MARGEN_Y, MARGEN_X, MARGEN_Y] as [number, number, number, number],
  defaultStyle: { font: "Helvetica", color: TEXTO },
};

export async function pdfComprobante(d: DatosBoleta, logo?: LogoDocumento | null): Promise<Buffer> {
  const pdfmake = pdfmakeListo();
  const aviso = avisoDeEstado(d.estado);
  const definicion: TDocumentDefinitions = {
    ...BASE_DOCUMENTO,
    info: { title: `Comprobante de pago del ${d.periodo}`, producer: PRODUCTO },
    watermark: aviso ? { text: aviso.marca, color: ALERTA, opacity: 0.08, bold: true } : undefined,
    content: hojasDeComprobante(d, logo, false),
  };
  return pdfmake.createPdf(definicion).getBuffer();
}

/**
 * Los comprobantes de varios empleados en un solo PDF, cada uno en su hoja, para imprimir
 * un período de una vez (pedido de Edbin, 2026-11-24). Sin marca de agua: el lote puede
 * mezclar planillas aprobadas y sin aprobar, y la marca es de todo el documento; cada
 * copia sin aprobar ya lleva su aviso en rojo arriba.
 */
export async function pdfComprobantes(lista: ReadonlyArray<{ datos: DatosBoleta; logo?: LogoDocumento | null }>, titulo: string): Promise<Buffer> {
  const pdfmake = pdfmakeListo();
  const definicion: TDocumentDefinitions = {
    ...BASE_DOCUMENTO,
    info: { title: titulo, producer: PRODUCTO },
    content: lista.flatMap((x, i) => hojasDeComprobante(x.datos, x.logo, i > 0)),
  };
  return pdfmake.createPdf(definicion).getBuffer();
}
