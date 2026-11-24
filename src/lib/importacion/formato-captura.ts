/**
 * Formato de captura de deducciones por sucursal: el Excel para llenar a mano, con la
 * forma de la planilla que la empresa ya lleva. Los empleados van agrupados por
 * departamento («Depto. 01 ADMINISTRACION»), ordenados por código, con subtotales por
 * departamento y total de la sucursal; los encabezados, en dos líneas («Coop.» /
 * «AUDI»).
 *
 * EL CÓDIGO DEL EMPLEADO ES LA REFERENCIA. Al importar no se lee nada más para saber
 * de quién es la fila; por eso la hoja va protegida (sin contraseña): sólo se pueden
 * escribir los montos. Debajo de cada encabezado va el código del tipo entre
 * paréntesis, en letra chica: así la columna se reconoce aunque alguien cambie el
 * nombre del tipo.
 *
 * Con la opción de horas extra (2026-11-23), lleva antes de las deducciones cuatro
 * columnas con las horas extra del período al 25, 50, 75 y 100 %, en horas
 * (`lib/payroll/horas-extra-periodo.ts`), con «(HE-25)» debajo del encabezado.
 *
 * Se importa por el mismo camino que cualquier archivo de montos del período
 * (`validarMontos`): el título se salta, los encabezados en dos filas se unen, las
 * filas de departamento no traen montos y las de total se ignoran.
 */

import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CODIGO_ISR_FIJO } from "@/lib/payroll/deducciones";
import { frasePeriodo, rangoPeriodo, ETIQUETA_TIPO_PLANILLA, nombreArchivoPeriodo, type PeriodoPlanilla } from "@/lib/payroll/periodos-planilla";
import type { Money } from "@/lib/payroll/money";
import type { TipoColumna } from "./montos-periodo";
import { HORAS_MAXIMAS_PERIODO, RECARGOS, type ClaveRecargo } from "@/lib/payroll/horas-extra-periodo";

type Db = PrismaClient | Prisma.TransactionClient;

// ─── COLUMNAS ────────────────────────────────────────────────────────────────

/** Abreviaturas de la primera palabra del encabezado, como las escribe la planilla de la empresa. */
const ABREVIAR: Record<string, string> = {
  cooperativa: "Coop.", prestamo: "Ptamo.", "préstamo": "Ptamo.", retencion: "Ret.", "retención": "Ret.",
  cuenta: "Cta.", aportacion: "Aport.", "aportación": "Aport.", descuento: "Desc.", seguro: "Seguro",
};

/**
 * El encabezado de un tipo en dos líneas: la primera palabra (abreviada) arriba y el
 * resto abajo. «Cooperativa AUDI» → «Coop.» / «AUDI»; «Vales» → «Vales» / «».
 */
export function encabezadoDosLineas(t: Pick<TipoColumna, "codigo" | "nombre">): [string, string] {
  if (t.codigo === CODIGO_ISR_FIJO) return ["Retención", "en la Fuente"];
  const [primera, ...resto] = t.nombre.trim().split(/\s+/);
  const arriba = ABREVIAR[primera.toLowerCase()] ?? primera;
  return resto.length ? [arriba, resto.join(" ")] : [arriba, ""];
}

/** Las columnas del formato que la empresa eligió y su orden. Se guarda en ConfiguracionSistema. */
export interface FormatoGuardado {
  /** Códigos de tipo, en el orden en que van. */
  columnas: string[];
  /** Códigos que se decidió no llevar. Un tipo que no está en ninguna lista es nuevo: va al final. */
  ocultas: string[];
  /** Lleva las horas extra del período (25, 50, 75 y 100 %) antes de las deducciones. */
  horasExtra?: boolean;
}

export const CLAVE_FORMATO = "DEDUCCIONES_FORMATO_CAPTURA";

/** Orden por omisión: el ISR (si va), cooperativas, préstamos, descuentos autorizados, adelantos, AFP y el resto. */
const ORDEN_CATEGORIA = ["IMPUESTO", "COOPERATIVA", "PRESTAMO", "VOLUNTARIA", "ADELANTO", "AFP", "OTRO", "PENSION_ALIMENTICIA", "EMBARGO"];

function ordenPorOmision(a: TipoColumna, b: TipoColumna): number {
  const ca = a.codigo === CODIGO_ISR_FIJO ? -1 : ORDEN_CATEGORIA.indexOf(a.categoria ?? "OTRO");
  const cb = b.codigo === CODIGO_ISR_FIJO ? -1 : ORDEN_CATEGORIA.indexOf(b.categoria ?? "OTRO");
  return ca - cb || a.nombre.localeCompare(b.nombre, "es");
}

/**
 * Todos los tipos que pueden ir en el formato, en orden, con si van o no. Pura. Lo
 * guardado manda; los tipos nuevos (en ninguna lista) van al final, incluidos.
 */
export function columnasDelFormato(tipos: readonly TipoColumna[], guardado: FormatoGuardado | null): Array<{ tipo: TipoColumna; incluida: boolean }> {
  const porCodigo = new Map(tipos.map((t) => [t.codigo, t]));
  const ocultas = new Set(guardado?.ocultas ?? []);
  const vistas = new Set<string>();
  const salida: Array<{ tipo: TipoColumna; incluida: boolean }> = [];
  for (const codigo of guardado?.columnas ?? []) {
    const t = porCodigo.get(codigo);
    if (t && !vistas.has(codigo)) { salida.push({ tipo: t, incluida: true }); vistas.add(codigo); }
  }
  const restantes = tipos.filter((t) => !vistas.has(t.codigo)).sort(ordenPorOmision);
  for (const t of restantes) salida.push({ tipo: t, incluida: !ocultas.has(t.codigo) });
  return salida;
}

export async function leerFormatoGuardado(db: Db): Promise<FormatoGuardado | null> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_FORMATO }, select: { valor: true } });
  if (!fila) return null;
  try {
    const v = JSON.parse(fila.valor) as Partial<FormatoGuardado>;
    const lista = (x: unknown) => (Array.isArray(x) ? x.filter((c): c is string => typeof c === "string") : []);
    return { columnas: lista(v.columnas), ocultas: lista(v.ocultas), horasExtra: v.horasExtra === true };
  } catch {
    return null;
  }
}

export async function guardarFormato(db: Db, f: FormatoGuardado): Promise<void> {
  const valor = JSON.stringify(f);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_FORMATO },
    update: { valor },
    create: { clave: CLAVE_FORMATO, valor, descripcion: "Columnas y orden del formato de captura de deducciones por sucursal" },
  });
}

// ─── EL LIBRO ────────────────────────────────────────────────────────────────

export interface EmpleadoFormato {
  id: string;
  codigo: string;
  /** Como en la planilla de la empresa: nombres y apellidos, en mayúsculas. */
  nombre: string;
}

export interface DepartamentoFormato {
  nombre: string;
  empleados: EmpleadoFormato[];
}

export interface DatosFormato {
  /** El grupo (o la empresa) y la sucursal, para el título. */
  grupo: string;
  sucursal: string;
  /** «Sucursal» o «División», según la estructura. */
  etiquetaSucursal: string;
  periodo: PeriodoPlanilla;
  departamentos: DepartamentoFormato[];
  columnas: TipoColumna[];
  /** El monto de hoy de una celda, o null para dejarla vacía. */
  monto: (empleadoId: string, tipoId: string) => Money | null;
  /**
   * Con las horas extra del período: las horas de hoy de cada recargo (null, vacía). Sin
   * esto, el formato no lleva esas columnas.
   */
  horas?: ((empleadoId: string, recargo: ClaveRecargo) => number | null) | null;
}

/** «Pagsa SPS» → «Pagsa-SPS»: el nombre del archivo lleva la sucursal sin tildes ni espacios. */
export function nombreArchivoFormato(periodo: PeriodoPlanilla, sucursal: string): string {
  const limpia = sucursal.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${nombreArchivoPeriodo(periodo)}_${limpia || "sucursal"}.xlsx`;
}

/** Nombre como en la planilla de la empresa. */
export const nombreParaFormato = (n: string) => n.replace(/\s+/g, " ").trim().toLocaleUpperCase("es-HN");

const MONTO = '#,##0.00;-#,##0.00;"-"';
const BORDE: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFB8C4CC" } };
const BORDES: Partial<ExcelJS.Borders> = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
const GRIS = "FFF1F4F6";
const CABECERA = "FFDCEAF0";
/** Las horas extra, en otro tono: no son Lempiras. */
const CABECERA_HORAS = "FFF6E7C8";
const CELDA_HORAS = "FFFFFAF0";
const HORAS = '#,##0.00;-#,##0.00;"-"';
const TINTA = "FF1F2937";
/** Columnas fijas antes de los montos: código y nombre. */
const FIJAS = 2;
/** Filas de título antes de los encabezados. */
const TITULO = 5;
/** Tope por celda, el mismo que aplica el importador. */
const MONTO_MAXIMO = 5_000_000;

const letra = (col: number) => {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export async function construirFormato(d: DatosFormato): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Gestión360 Nómina";
  // Que Excel calcule los subtotales al abrir: ExcelJS escribe la fórmula sin resultado.
  libro.calcProperties = { fullCalcOnLoad: true };
  const recargos = d.horas ? RECARGOS : [];
  /** Primera columna de deducción: después del código, el nombre y, si van, las horas extra. */
  const DED = FIJAS + recargos.length + 1;
  const ultima = FIJAS + recargos.length + d.columnas.length;
  const hoja = libro.addWorksheet("Deducciones", {
    views: [{ state: "frozen", xSplit: FIJAS, ySplit: TITULO + 2, showGridLines: false }],
    pageSetup: {
      orientation: "landscape", paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${TITULO + 1}:${TITULO + 2}`,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: "&LGestión360 Nómina&RPágina &P de &N" },
  });
  hoja.getColumn(1).width = 11;
  hoja.getColumn(2).width = 40;
  recargos.forEach((_, k) => { hoja.getColumn(FIJAS + 1 + k).width = 11; });
  // Cada columna del ancho de su nombre (entre 13 y 22): así el código cabe debajo, en la tercera línea.
  d.columnas.forEach((t, i) => {
    const largo = Math.max(...encabezadoDosLineas(t).map((l) => l.length), t.codigo.length * 0.75);
    hoja.getColumn(DED + i).width = Math.min(22, Math.max(13, Math.ceil(largo * 0.9) + 2));
  });

  // ── Título ──
  const titulo = (r: number, texto: string, fuente: Partial<ExcelJS.Font>) => {
    const celda = hoja.getCell(r, 1);
    celda.value = texto;
    celda.font = { color: { argb: TINTA }, ...fuente };
  };
  titulo(1, d.grupo.toLocaleUpperCase("es-HN"), { bold: true, size: 14 });
  titulo(2, `${d.etiquetaSucursal}: ${d.sucursal}`, { bold: true, size: 12 });
  titulo(3, `${d.horas ? "Horas extra y deducciones" : "Deducciones"} ${frasePeriodo(d.periodo, "de")}, ${rangoPeriodo(d.periodo.desde, d.periodo.hasta)} (planilla ${ETIQUETA_TIPO_PLANILLA[d.periodo.tipo].toLowerCase()})`, { size: 11 });
  titulo(4, d.horas
    ? "Escriba sólo cantidades: las horas extra en horas y las deducciones en Lempiras. El código del empleado es la referencia. Celda vacía: no cambia nada; 0: nada en este período."
    : "Escriba sólo los montos. El código del empleado es la referencia. Celda vacía: no cambia nada; 0: no se cobra en este período.", { italic: true, size: 9, color: { argb: "FF55656E" } });

  // ── Encabezados en dos filas; el código del tipo, chico, debajo ──
  const arriba = hoja.getRow(TITULO + 1);
  const abajo = hoja.getRow(TITULO + 2);
  arriba.height = 16;
  // Tres líneas: el resto del nombre puede ocupar dos y el código va debajo.
  abajo.height = 44;
  const encabezado = (col: number, sup: string, inf: ExcelJS.CellValue, fondo = CABECERA) => {
    for (const [fila, valor] of [[arriba, sup], [abajo, inf]] as const) {
      const celda = fila.getCell(col);
      celda.value = valor;
      celda.font = { bold: true, size: 10, color: { argb: TINTA } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } };
      celda.alignment = { horizontal: "center", vertical: fila === arriba ? "bottom" : "top", wrapText: true };
      celda.border = fila === arriba ? { top: BORDE, left: BORDE, right: BORDE } : { bottom: BORDE, left: BORDE, right: BORDE };
    }
  };
  encabezado(1, "Código", "Empl.");
  encabezado(2, "Nombre del", "Empleado");
  // Las horas extra primero: «Horas extra» arriba, el recargo abajo y su código, chico.
  recargos.forEach((rc, k) => {
    encabezado(FIJAS + 1 + k, "Horas extra", {
      richText: [
        { text: `${rc.porcentaje} %\n`, font: { bold: true, size: 10, color: { argb: TINTA } } },
        { text: `(${rc.codigo})`, font: { size: 7, color: { argb: "FF7B8A93" } } },
      ],
    }, CABECERA_HORAS);
  });
  d.columnas.forEach((t, i) => {
    const [sup, inf] = encabezadoDosLineas(t);
    encabezado(DED + i, sup, {
      richText: [
        ...(inf ? [{ text: `${inf}\n`, font: { bold: true, size: 10, color: { argb: TINTA } } }] : []),
        { text: `(${t.codigo})`, font: { size: 7, color: { argb: "FF7B8A93" } } },
      ],
    });
  });

  // ── Departamentos ──
  const subtotales: number[] = [];
  let r = TITULO + 3;
  let numero = 0;
  for (const depto of d.departamentos) {
    if (!depto.empleados.length) continue;
    numero++;
    const etiqueta = `Depto. ${String(numero).padStart(2, "0")}`;
    const filaDepto = hoja.getRow(r);
    filaDepto.getCell(1).value = etiqueta;
    filaDepto.getCell(2).value = nombreParaFormato(depto.nombre);
    for (let c = 1; c <= ultima; c++) {
      const celda = filaDepto.getCell(c);
      celda.font = { bold: true, color: { argb: TINTA } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
    }
    r++;
    const primera = r;
    for (const e of depto.empleados) {
      const fila = hoja.getRow(r);
      fila.getCell(1).value = e.codigo;
      fila.getCell(2).value = nombreParaFormato(e.nombre);
      for (const c of [1, 2]) {
        const celda = fila.getCell(c);
        celda.border = BORDES;
        celda.numFmt = "@";
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
      }
      fila.getCell(1).alignment = { horizontal: "center" };
      recargos.forEach((rc, k) => {
        const celda = fila.getCell(FIJAS + 1 + k);
        const h = d.horas?.(e.id, rc.clave) ?? null;
        celda.value = h ? h : null;
        celda.numFmt = HORAS;
        celda.border = BORDES;
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CELDA_HORAS } };
        celda.protection = { locked: false };
        celda.dataValidation = {
          type: "decimal", operator: "between", allowBlank: true, formulae: [0, HORAS_MAXIMAS_PERIODO],
          showErrorMessage: true, errorStyle: "stop", errorTitle: "Horas no válidas",
          error: `Escriba las horas extra al ${rc.porcentaje} % del período, en horas (no en Lempiras). Vacía, no cambia nada; 0, no se pagan en este período.`,
        };
      });
      d.columnas.forEach((t, i) => {
        const celda = fila.getCell(DED + i);
        const m = d.monto(e.id, t.id);
        celda.value = m && !m.isZero() ? Number(m.toFixed(2)) : null;
        celda.numFmt = MONTO;
        celda.border = BORDES;
        // Sólo los montos se pueden escribir con la hoja protegida.
        celda.protection = { locked: false };
        celda.dataValidation = {
          type: "decimal", operator: "between", allowBlank: true, formulae: [0, MONTO_MAXIMO],
          showErrorMessage: true, errorStyle: "stop", errorTitle: "Monto no válido",
          error: "Escriba un monto en Lempiras, de 0 en adelante. Vacía, no cambia nada; 0, no se cobra en este período.",
        };
      });
      r++;
    }
    // Subtotal: SUBTOTAL(9) para que el total de la sucursal no lo cuente dos veces.
    const total = hoja.getRow(r);
    total.getCell(2).value = `Total ${etiqueta}`;
    for (let c = 1; c <= ultima; c++) {
      const celda = total.getCell(c);
      celda.font = { bold: true, color: { argb: TINTA } };
      celda.border = { top: { style: "thin", color: { argb: TINTA } }, bottom: { style: "double", color: { argb: TINTA } } };
      if (c > FIJAS) {
        celda.value = { formula: `SUBTOTAL(9,${letra(c)}${primera}:${letra(c)}${r - 1})` };
        celda.numFmt = MONTO;
      }
    }
    subtotales.push(r);
    r += 2;
  }

  // ── Total de la sucursal ──
  if (subtotales.length) {
    const total = hoja.getRow(r);
    total.getCell(2).value = `Total ${d.sucursal}`;
    for (let c = 1; c <= ultima; c++) {
      const celda = total.getCell(c);
      celda.font = { bold: true, color: { argb: TINTA } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CABECERA } };
      if (c > FIJAS) {
        celda.value = { formula: `SUBTOTAL(9,${letra(c)}${TITULO + 3}:${letra(c)}${r - 1})` };
        celda.numFmt = MONTO;
      }
    }
  }

  // Protegida SIN contraseña: evita cambiar un código por descuido; Revisar → Desproteger hoja la quita.
  await hoja.protect("", {
    selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, formatCells: false,
    insertRows: false, insertColumns: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: false,
  });

  // ── Instrucciones ──
  const ayuda = libro.addWorksheet("Instrucciones");
  ayuda.getColumn(1).width = 110;
  ayuda.getColumn(1).alignment = { wrapText: true, vertical: "top" };
  for (const nota of notasFormato(d)) ayuda.addRow([nota]);

  return new Uint8Array(await libro.xlsx.writeBuffer());
}

export function notasFormato(d: Pick<DatosFormato, "periodo" | "sucursal" | "columnas" | "horas">): string[] {
  const conIsr = d.columnas.some((t) => t.codigo === CODIGO_ISR_FIJO);
  const deHoras = d.horas
    ? [
        "Las cuatro columnas «Horas extra» van antes de las deducciones y se escriben en HORAS, no en Lempiras: al 25 % (diurnas), 50 % (de noche en una jornada diurna o mixta), 75 % (prolongación de la jornada nocturna) y 100 % (en feriado o día de descanso). La planilla las paga con el salario por hora de cada quien.",
        "Vienen con las horas que ya hay en el período. Lo que escriba reemplaza, recargo por recargo y sólo en este período, a las horas que suman los marcajes del reloj o la carga manual. Vacía: no cambia nada; 0: no se pagan horas de ese recargo en este período.",
      ]
    : [];
  return [
    `Deducciones de ${d.sucursal} ${frasePeriodo(d.periodo, "de")}, ${rangoPeriodo(d.periodo.desde, d.periodo.hasta)}.`,
    "Escriba los montos en la hoja Deducciones y súbala en Deducciones → Importar → Montos del período, eligiendo el mismo período. Antes de aplicar verá qué cambia.",
    "El código del empleado es la referencia: es lo único que se lee para saber de quién es la fila. Por eso la hoja está protegida y sólo se pueden escribir los montos. Si necesita quitar la protección: Revisar → Desproteger hoja (no tiene contraseña).",
    "Celda vacía: no cambia nada. 0 (se ve como «-»): no se cobra ese descuento en este período, aunque sea de cada planilla. Otro monto: reemplaza sólo en este período lo de cada planilla.",
    "Las cuotas de préstamos y los descuentos a plazo ya vienen sumados en la celda y siguen su curso: el monto no puede ser menor que ellos.",
    ...deHoras,
    "Las filas «Depto.» y «Total» no se importan. Los totales se calculan solos.",
    "Un empleado que no aparece se registra primero en el sistema; luego vuelva a descargar el formato.",
    "Debajo de cada encabezado va el código del tipo de deducción, entre paréntesis: con él se reconoce la columna aunque el tipo cambie de nombre. No lo borre.",
    "Las deducciones de ley (IHSS, RAP, INFOP, impuesto vecinal) no van aquí: las calcula la planilla.",
    ...(conIsr ? ["«Retención en la Fuente»: el ISR está en manual (Parámetros de ley), así que la planilla retiene lo que diga esta columna en vez de calcularlo."] : []),
  ];
}
