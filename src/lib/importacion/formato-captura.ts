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
import { etiquetaPeriodo, frasePeriodo, periodoQueContiene, rangoPeriodo, ETIQUETA_TIPO_PLANILLA, nombreArchivoPeriodo, type PeriodoPlanilla } from "@/lib/payroll/periodos-planilla";
import { HOJA_PERIODOS } from "./xlsx";
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

/** «Pagsa SPS / Ñ» → «Pagsa-SPS-N»: para el nombre del archivo, sin tildes ni espacios. */
const paraArchivo = (nombre: string) =>
  nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** «Pagsa SPS» → «Pagsa-SPS»: el nombre del archivo lleva la sucursal sin tildes ni espacios. */
export function nombreArchivoFormato(periodo: PeriodoPlanilla, sucursal: string): string {
  return `${nombreArchivoPeriodo(periodo)}_${paraArchivo(sucursal) || "sucursal"}.xlsx`;
}

/**
 * «deducciones_grupo_Grupo-PAGSA_2026-12_1a-quincena.xlsx». A propósito NO tiene la forma
 * de `nombreArchivoPeriodo`: el libro trae varios períodos y cada hoja dice el suyo.
 */
export function nombreArchivoGrupo(grupo: string, mes: string, quincena: 1 | 2): string {
  return `deducciones_grupo_${paraArchivo(grupo) || "grupo"}_${mes}_${quincena === 1 ? "1a" : "2a"}-quincena.xlsx`;
}

/** El formato lleva lo que se descuenta a cada empleado: hace falta también el permiso de datos personales. */
export const SIN_PII_FORMATO = "El formato lleva los montos que se descuentan a cada empleado: para descargarlo hace falta también el permiso de datos personales y salariales.";
export const MAX_EMPLEADOS_FORMATO = 5_000;

/**
 * El período de cada hoja del formato por grupo: la quincena elegida para la planilla
 * quincenal y el mes completo de esa quincena para la mensual.
 */
export function periodoDeHojaGrupo(tipo: "QUINCENAL" | "MENSUAL", mes: string, quincena: 1 | 2): PeriodoPlanilla {
  return tipo === "MENSUAL"
    ? periodoQueContiene("MENSUAL", `${mes}-01`)
    : periodoQueContiene("QUINCENAL", `${mes}-${quincena === 1 ? "01" : "16"}`);
}

/** Departamentos (o sucursales) por código y, a igual código, por nombre. */
export const porCodigoYNombre = <T extends { codigo: string | null; nombre: string }>(a: T, b: T) =>
  (a.codigo ?? "￿").localeCompare(b.codigo ?? "￿", "es") || a.nombre.localeCompare(b.nombre, "es");

/** Nombre como en la planilla de la empresa. */
export const nombreParaFormato = (n: string) => n.replace(/\s+/g, " ").trim().toLocaleUpperCase("es-HN");

const MONTO = '#,##0.00;-#,##0.00;"-"';
const BORDE: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFB8C4CC" } };
const BORDES: Partial<ExcelJS.Borders> = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
const GRIS = "FFF1F4F6";
const CABECERA = "FFDCEAF0";
/** El total del grupo, al final de cada hoja del formato por grupo: un tono más fuerte. */
const CABECERA_GRUPO = "FFBFD8E4";
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

function nuevoLibro(): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Gestión360 Nómina";
  // Que Excel calcule los subtotales al abrir: ExcelJS escribe la fórmula sin resultado.
  libro.calcProperties = { fullCalcOnLoad: true };
  return libro;
}

const indicacion = (conHoras: boolean) => conHoras
  ? "Escriba sólo cantidades: las horas extra en horas y las deducciones en Lempiras. El código del empleado es la referencia. Celda vacía: no cambia nada; 0: nada en este período."
  : "Escriba sólo los montos. El código del empleado es la referencia. Celda vacía: no cambia nada; 0: no se cobra en este período.";

function agregarInstrucciones(libro: ExcelJS.Workbook, notas: readonly string[]): void {
  const ayuda = libro.addWorksheet("Instrucciones");
  ayuda.getColumn(1).width = 110;
  ayuda.getColumn(1).alignment = { wrapText: true, vertical: "top" };
  for (const nota of notas) ayuda.addRow([nota]);
}

export async function construirFormato(d: DatosFormato): Promise<Uint8Array> {
  const libro = nuevoLibro();
  await escribirHoja(libro, {
    nombre: "Deducciones",
    titulos: [
      d.grupo.toLocaleUpperCase("es-HN"),
      `${d.etiquetaSucursal}: ${d.sucursal}`,
      `${d.horas ? "Horas extra y deducciones" : "Deducciones"} ${frasePeriodo(d.periodo, "de")}, ${rangoPeriodo(d.periodo.desde, d.periodo.hasta)} (planilla ${ETIQUETA_TIPO_PLANILLA[d.periodo.tipo].toLowerCase()})`,
      indicacion(!!d.horas),
    ],
    secciones: [{ nombre: d.sucursal, departamentos: d.departamentos }],
    porGrupo: null,
    columnas: d.columnas,
    monto: d.monto,
    horas: d.horas ?? null,
  });
  agregarInstrucciones(libro, notasFormato(d));
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

// ─── FORMATO POR GRUPO (2026-11-27) ──────────────────────────────────────────
//
// Un solo libro para un grupo: una hoja por frecuencia («Quincenal», «Mensual»), cada
// una de su período, con todas las sucursales del grupo una debajo de otra. Cada
// sucursal lleva una fila con su nombre, sus departamentos con subtotal y su total; al
// final de la hoja, el total del grupo. Se sube entero por Montos del período: la hoja
// oculta `HOJA_PERIODOS` dice a qué período va cada hoja.

/** Una sucursal dentro de la hoja, con sus departamentos. */
export interface SeccionFormato {
  nombre: string;
  departamentos: DepartamentoFormato[];
}

/** Una hoja del libro por grupo: la de una frecuencia, con su período. */
export interface HojaGrupo {
  periodo: PeriodoPlanilla;
  secciones: SeccionFormato[];
  monto: DatosFormato["monto"];
  /** Las horas de hoy de cada recargo; sólo se usa si el libro lleva horas extra. */
  horas?: DatosFormato["horas"];
}

export interface DatosFormatoGrupo {
  grupo: string;
  /** «Sucursal» o «División», según la estructura. */
  etiquetaSucursal: string;
  columnas: TipoColumna[];
  /** Lleva las horas extra 25/50/75/100 % antes de las deducciones, en todas las hojas. */
  conHoras: boolean;
  /** Ya sin las frecuencias sin empleados. */
  hojas: HojaGrupo[];
}

export async function construirFormatoGrupo(d: DatosFormatoGrupo): Promise<Uint8Array> {
  const libro = nuevoLibro();
  for (const h of d.hojas) {
    await escribirHoja(libro, {
      nombre: ETIQUETA_TIPO_PLANILLA[h.periodo.tipo],
      titulos: [
        d.grupo.toLocaleUpperCase("es-HN"),
        `Planilla ${ETIQUETA_TIPO_PLANILLA[h.periodo.tipo].toLowerCase()}: ${etiquetaPeriodo(h.periodo)}, ${rangoPeriodo(h.periodo.desde, h.periodo.hasta)}`,
        `${d.conHoras ? "Horas extra y deducciones" : "Deducciones"} por ${d.etiquetaSucursal.toLowerCase()}, una debajo de otra.`,
        indicacion(d.conHoras),
      ],
      secciones: h.secciones,
      porGrupo: { grupo: d.grupo, etiquetaSucursal: d.etiquetaSucursal },
      columnas: d.columnas,
      monto: h.monto,
      horas: d.conHoras ? (h.horas ?? (() => null)) : null,
    });
  }
  agregarInstrucciones(libro, notasFormatoGrupo(d));
  // Qué período es cada hoja: oculta del todo (Excel no la deja mostrar), la lee el importador.
  const control = libro.addWorksheet(HOJA_PERIODOS, { state: "veryHidden" });
  control.addRow(["hoja", "tipo", "desde", "hasta"]);
  for (const h of d.hojas) control.addRow([ETIQUETA_TIPO_PLANILLA[h.periodo.tipo], h.periodo.tipo, h.periodo.desde, h.periodo.hasta]);
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

// ─── UNA HOJA ────────────────────────────────────────────────────────────────

interface HojaAEscribir {
  nombre: string;
  /** Las cuatro filas de título. */
  titulos: [string, string, string, string];
  secciones: SeccionFormato[];
  /** Formato por grupo: fila con el nombre antes de cada sucursal y total del grupo al final. */
  porGrupo: { grupo: string; etiquetaSucursal: string } | null;
  columnas: TipoColumna[];
  monto: DatosFormato["monto"];
  horas: DatosFormato["horas"] | null;
}

async function escribirHoja(libro: ExcelJS.Workbook, h: HojaAEscribir): Promise<void> {
  const recargos = h.horas ? RECARGOS : [];
  /** Primera columna de deducción: después del código, el nombre y, si van, las horas extra. */
  const DED = FIJAS + recargos.length + 1;
  const ultima = FIJAS + recargos.length + h.columnas.length;
  const hoja = libro.addWorksheet(h.nombre, {
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
  h.columnas.forEach((t, i) => {
    const largo = Math.max(...encabezadoDosLineas(t).map((l) => l.length), t.codigo.length * 0.75);
    hoja.getColumn(DED + i).width = Math.min(22, Math.max(13, Math.ceil(largo * 0.9) + 2));
  });

  // ── Título ──
  const titulo = (r: number, texto: string, fuente: Partial<ExcelJS.Font>) => {
    const celda = hoja.getCell(r, 1);
    celda.value = texto;
    celda.font = { color: { argb: TINTA }, ...fuente };
  };
  titulo(1, h.titulos[0], { bold: true, size: 14 });
  titulo(2, h.titulos[1], { bold: true, size: 12 });
  titulo(3, h.titulos[2], { size: 11 });
  titulo(4, h.titulos[3], { italic: true, size: 9, color: { argb: "FF55656E" } });

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
  h.columnas.forEach((t, i) => {
    const [sup, inf] = encabezadoDosLineas(t);
    encabezado(DED + i, sup, {
      richText: [
        ...(inf ? [{ text: `${inf}\n`, font: { bold: true, size: 10, color: { argb: TINTA } } }] : []),
        { text: `(${t.codigo})`, font: { size: 7, color: { argb: "FF7B8A93" } } },
      ],
    });
  });

  /** Fila de total: SUBTOTAL(9) para que un total mayor no cuente dos veces los subtotales de adentro. */
  const filaTotal = (fila: number, texto: string, desde: number, estilo: Pick<Partial<ExcelJS.Style>, "fill" | "border">) => {
    const total = hoja.getRow(fila);
    total.getCell(2).value = texto;
    for (let c = 1; c <= ultima; c++) {
      const celda = total.getCell(c);
      celda.font = { bold: true, color: { argb: TINTA } };
      if (estilo.fill) celda.fill = estilo.fill;
      if (estilo.border) celda.border = estilo.border;
      if (c > FIJAS) {
        celda.value = { formula: `SUBTOTAL(9,${letra(c)}${desde}:${letra(c)}${fila - 1})` };
        celda.numFmt = MONTO;
      }
    }
  };

  /** Los departamentos de una sucursal desde la fila `r`, cada uno con su subtotal. Devuelve la fila siguiente libre. */
  const escribirDepartamentos = (departamentos: readonly DepartamentoFormato[], desde: number): number => {
    let r = desde;
    let numero = 0;
    for (const depto of departamentos) {
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
          const horas = h.horas?.(e.id, rc.clave) ?? null;
          celda.value = horas ? horas : null;
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
        h.columnas.forEach((t, i) => {
          const celda = fila.getCell(DED + i);
          const m = h.monto(e.id, t.id);
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
      // Subtotal del departamento.
      filaTotal(r, `Total ${etiqueta}`, primera, {
        border: { top: { style: "thin", color: { argb: TINTA } }, bottom: { style: "double", color: { argb: TINTA } } },
      });
      r += 2;
    }
    return r;
  };

  let r = TITULO + 3;
  for (const seccion of h.secciones) {
    if (!seccion.departamentos.some((dp) => dp.empleados.length)) continue;
    // En el formato por grupo, el nombre de la sucursal antes de sus departamentos. Va en la
    // columna del nombre y sin código: el importador la salta como cualquier fila sin montos.
    if (h.porGrupo) {
      const banda = hoja.getRow(r);
      banda.getCell(2).value = `${h.porGrupo.etiquetaSucursal}: ${nombreParaFormato(seccion.nombre)}`;
      banda.height = 20;
      for (let c = 1; c <= ultima; c++) {
        const celda = banda.getCell(c);
        celda.font = { bold: true, size: 12, color: { argb: TINTA } };
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CABECERA } };
        celda.alignment = { vertical: "middle" };
      }
      r++;
    }
    const inicio = r;
    r = escribirDepartamentos(seccion.departamentos, r);
    // ── Total de la sucursal ──
    filaTotal(r, `Total ${h.porGrupo ? nombreParaFormato(seccion.nombre) : seccion.nombre}`, inicio, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: CABECERA } },
    });
    if (h.porGrupo) r += 2;
  }
  // ── Total del grupo, al final de la hoja ──
  if (h.porGrupo && r > TITULO + 3) {
    filaTotal(r, `Total ${nombreParaFormato(h.porGrupo.grupo)}`, TITULO + 3, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: CABECERA_GRUPO } },
      border: { top: { style: "double", color: { argb: TINTA } }, bottom: { style: "double", color: { argb: TINTA } } },
    });
  }

  // Protegida SIN contraseña: evita cambiar un código por descuido; Revisar → Desproteger hoja la quita.
  await hoja.protect("", {
    selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, formatCells: false,
    insertRows: false, insertColumns: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: false,
  });
}

export function notasFormato(d: Pick<DatosFormato, "periodo" | "sucursal" | "columnas" | "horas">): string[] {
  return [
    `Deducciones de ${d.sucursal} ${frasePeriodo(d.periodo, "de")}, ${rangoPeriodo(d.periodo.desde, d.periodo.hasta)}.`,
    "Escriba los montos en la hoja Deducciones y súbala en Deducciones → Importar → Montos del período, eligiendo el mismo período. Antes de aplicar verá qué cambia.",
    ...notasComunes(d.columnas, !!d.horas, false),
  ];
}

export function notasFormatoGrupo(d: Pick<DatosFormatoGrupo, "grupo" | "columnas" | "conHoras" | "hojas">): string[] {
  const hojas = d.hojas.map((h) => `«${ETIQUETA_TIPO_PLANILLA[h.periodo.tipo]}», ${frasePeriodo(h.periodo, "de").replace(/^(del|de la) /, "")} (${rangoPeriodo(h.periodo.desde, h.periodo.hasta)})`);
  return [
    `${d.conHoras ? "Horas extra y deducciones" : "Deducciones"} del grupo ${d.grupo}, una hoja por tipo de planilla: ${hojas.join("; ")}.`,
    "En cada hoja van las sucursales del grupo una debajo de otra, cada una con sus departamentos, su total y, al final, el total del grupo.",
    "Escriba las cantidades y suba el libro COMPLETO en Deducciones → Importar → Montos del período. Cada hoja se aplica a su propio período: el período que elija al subirlo no se usa. Antes de aplicar verá qué cambia en cada hoja.",
    "No cambie el nombre de las hojas ni las borre: con el nombre se sabe a qué período va cada una.",
    ...notasComunes(d.columnas, d.conHoras, true),
  ];
}

function notasComunes(columnas: readonly TipoColumna[], conHoras: boolean, porGrupo: boolean): string[] {
  const conIsr = columnas.some((t) => t.codigo === CODIGO_ISR_FIJO);
  const deHoras = conHoras
    ? [
        "Las cuatro columnas «Horas extra» van antes de las deducciones y se escriben en HORAS, no en Lempiras: al 25 % (diurnas), 50 % (de noche en una jornada diurna o mixta), 75 % (prolongación de la jornada nocturna) y 100 % (en feriado o día de descanso). La planilla las paga con el salario por hora de cada quien.",
        "Vienen con las horas que ya hay en el período. Lo que escriba reemplaza, recargo por recargo y sólo en este período, a las horas que suman los marcajes del reloj o la carga manual. Vacía: no cambia nada; 0: no se pagan horas de ese recargo en este período.",
      ]
    : [];
  return [
    `El código del empleado es la referencia: es lo único que se lee para saber de quién es la fila. Por eso ${porGrupo ? "las hojas están protegidas" : "la hoja está protegida"} y sólo se pueden escribir los montos. Si necesita quitar la protección: Revisar → Desproteger hoja (no tiene contraseña).`,
    "Celda vacía: no cambia nada. 0 (se ve como «-»): no se cobra ese descuento en este período, aunque sea de cada planilla. Otro monto: reemplaza sólo en este período lo de cada planilla.",
    "Las cuotas de préstamos y los descuentos a plazo ya vienen sumados en la celda y siguen su curso: el monto no puede ser menor que ellos.",
    ...deHoras,
    porGrupo
      ? "Las filas con el nombre de la sucursal, las «Depto.» y las «Total» no se importan. Los totales se calculan solos."
      : "Las filas «Depto.» y «Total» no se importan. Los totales se calculan solos.",
    "Un empleado que no aparece se registra primero en el sistema; luego vuelva a descargar el formato.",
    "Debajo de cada encabezado va el código del tipo de deducción, entre paréntesis: con él se reconoce la columna aunque el tipo cambie de nombre. No lo borre.",
    "Las deducciones de ley (IHSS, RAP, INFOP, impuesto vecinal) no van aquí: las calcula la planilla.",
    ...(conIsr ? ["«Retención en la Fuente»: el ISR está en manual (Parámetros de ley), así que la planilla retiene lo que diga esta columna en vez de calcularlo."] : []),
  ];
}
