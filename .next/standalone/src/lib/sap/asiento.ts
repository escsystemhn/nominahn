/**
 * De la partida contable de una planilla al asiento de SAP (JournalEntries).
 *
 * PURO: recibe la partida ya generada (`partida-contable.ts`), el mapeo a
 * cuentas de SAP y la configuración, y devuelve el JSON exacto que se envía o
 * la lista de lo que falta. No construye el asiento: el motor ya lo hizo y ya
 * cuadra al centavo; aquí sólo cambia de destino.
 */

import { aNumero, esCero, type Money } from "@/lib/payroll/money";
import {
  CLAVES_GASTO,
  type ClaveCuenta,
  type PartidaContable,
  type PartidaPorCentroCosto,
  type LineaPartida,
} from "@/lib/payroll/partida-contable";

export interface LineaSap {
  AccountCode: string;
  Debit: number;
  Credit: number;
  LineMemo: string;
  CostingCode?: string;
  CostingCode2?: string;
  CostingCode3?: string;
  CostingCode4?: string;
  CostingCode5?: string;
  ProjectCode?: string;
  /** Sucursal de SAP (BusinessPlaces.BPLID) cuando la empresa usa varias. */
  BPLID?: number;
}

export interface PayloadJournalEntry {
  ReferenceDate: string;
  DueDate: string;
  TaxDate: string;
  Memo: string;
  Reference: string;
  Reference2: string;
  TransactionCode?: string;
  Series?: number;
  JournalEntryLines: LineaSap[];
}

/** Cuenta de SAP asignada a cada concepto del motor, vía su cuenta del catálogo local. */
export interface MapeoSap {
  porClave: Partial<Record<ClaveCuenta, { acctCode: string | null; nombre: string; codigoLocal: string }>>;
  /** Centros de costo locales (por id) con su código en SAP. */
  centros: Record<string, { codigo: string; nombre: string; costingCode: string | null; projectCode: string | null }>;
}

export interface OpcionesAsiento {
  planillaId: string;
  tipoPlanilla: string;
  empresa: string;
  /** Fechas de CALENDARIO (medianoche UTC). */
  fechaInicio: Date;
  fechaFin: Date;
  fechaPago: Date | null;
  fechaContable: "PAGO" | "FIN_PERIODO";
  porCentroCosto: boolean;
  /** Dimensión de B1 (1 a 5) en la que viven los centros de costo. */
  dimensionCentro: number;
  codigoTransaccion?: string | null;
  serie?: number | null;
  memoPlantilla: string;
  longitudes: { memo: number; lineMemo: number; referencia: number };
  /** Asiento de reverso: líneas invertidas y referencia propia. */
  reverso?: boolean;
  /**
   * SAP con varias sucursales: todas las líneas llevan el BPLID de la sucursal
   * de la planilla (o el de omisión si la planilla es de toda la empresa).
   */
  sucursal?: { usa: boolean; bplId: number | null; nombre: string | null };
}

export interface ResultadoAsiento {
  payload: PayloadJournalEntry | null;
  errores: string[];
  avisos: string[];
  totalDebe: number;
  totalHaber: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (d: Date) => {
  const [a, m, dd] = ymd(d).split("-");
  return `${dd}/${m}/${a}`;
};

export function truncar(texto: string, max: number): string {
  const s = String(texto ?? "");
  return s.length <= max ? s : s.slice(0, Math.max(0, max));
}

const CAMPO_DIMENSION: Record<number, keyof LineaSap> = {
  1: "CostingCode",
  2: "CostingCode2",
  3: "CostingCode3",
  4: "CostingCode4",
  5: "CostingCode5",
};

/** Memo a partir de la plantilla: {tipo} {desde} {hasta} {empresa}. */
export function memoDesdePlantilla(plantilla: string, o: OpcionesAsiento): string {
  const tipo = o.tipoPlanilla.charAt(0) + o.tipoPlanilla.slice(1).toLowerCase();
  return plantilla
    .replace(/\{tipo\}/g, tipo)
    .replace(/\{desde\}/g, dmy(o.fechaInicio))
    .replace(/\{hasta\}/g, dmy(o.fechaFin))
    .replace(/\{empresa\}/g, o.empresa)
    .trim();
}

/** Referencia legible y llave de reconciliación (Reference2 = id de la planilla). */
export function referenciasDe(o: OpcionesAsiento): { Reference: string; Reference2: string } {
  const base = `NOM-${o.tipoPlanilla}-${ymd(o.fechaFin)}`;
  return {
    Reference: truncar(o.reverso ? `${base}-R` : base, o.longitudes.referencia),
    Reference2: truncar(o.reverso ? `${o.planillaId}-R` : o.planillaId, o.longitudes.referencia),
  };
}

type LineaConCentro = LineaPartida & { centroCostoId?: string | null; centroCodigo?: string };

export function construirAsiento(
  partida: PartidaContable | PartidaPorCentroCosto,
  mapeo: MapeoSap,
  o: OpcionesAsiento
): ResultadoAsiento {
  const errores: string[] = [];
  const avisos: string[] = [];

  // Fuente de líneas: consolidado, o gasto por centro más pasivos de empresa.
  let lineas: LineaConCentro[];
  if ("gastoPorCentro" in partida) {
    if (!partida.conciliado) errores.push(`El desglose por centro de costo no concilia con el consolidado (diferencia ${partida.diferenciaConciliacion.toFixed(2)}).`);
    lineas = [...partida.gastoPorCentro, ...partida.pasivos];
  } else {
    if (!partida.cuadra) errores.push(`La partida no cuadra (diferencia ${partida.diferencia.toFixed(2)}).`);
    lineas = partida.lineas;
  }
  for (const a of partida.anomalias) avisos.push(a);

  // Sucursal de SAP: obligatoria en todas las líneas cuando la empresa usa varias.
  let bplId: number | null = null;
  if (o.sucursal?.usa) {
    if (o.sucursal.bplId) {
      bplId = o.sucursal.bplId;
    } else if (o.sucursal.nombre) {
      errores.push(`La sucursal ${o.sucursal.nombre} no tiene sucursal de SAP asignada. Asígnela en Configuración, SAP - Conexión, Mapeo contable.`);
    } else {
      errores.push("Las planillas de toda la empresa necesitan una sucursal de SAP por omisión. Elíjala en Configuración, SAP - Conexión, Comportamiento.");
    }
  }

  const campoDimension = CAMPO_DIMENSION[o.dimensionCentro] ?? "CostingCode";
  const sinCuenta = new Set<string>();
  const sinCentro = new Set<string>();
  const salida: LineaSap[] = [];
  let totalDebe = 0;
  let totalHaber = 0;

  for (const l of lineas) {
    if (esCero(l.debe) && esCero(l.haber)) continue;
    const cuenta = mapeo.porClave[l.clave];
    if (!cuenta?.acctCode) {
      sinCuenta.add(`${l.nombre} (${cuenta?.codigoLocal ?? l.cuenta})`);
      continue;
    }

    const debe = o.reverso ? l.haber : l.debe;
    const haber = o.reverso ? l.debe : l.haber;
    const linea: LineaSap = {
      AccountCode: cuenta.acctCode,
      Debit: aNumero(debe),
      Credit: aNumero(haber),
      LineMemo: truncar(o.reverso ? `Reverso: ${l.nombre}` : l.nombre, o.longitudes.lineMemo),
    };

    if (o.porCentroCosto && CLAVES_GASTO.has(l.clave)) {
      const centro = l.centroCostoId ? mapeo.centros[l.centroCostoId] : null;
      if (!l.centroCostoId) {
        sinCentro.add("empleados sin centro de costo asignado");
      } else if (!centro?.costingCode) {
        sinCentro.add(`${centro?.codigo ?? l.centroCodigo ?? l.centroCostoId} sin código en SAP`);
      } else {
        (linea as unknown as Record<string, string>)[campoDimension] = centro.costingCode;
        if (centro.projectCode) linea.ProjectCode = centro.projectCode;
      }
    }

    if (bplId !== null) linea.BPLID = bplId;

    salida.push(linea);
    totalDebe += linea.Debit;
    totalHaber += linea.Credit;
  }

  if (sinCuenta.size > 0) errores.push(`Conceptos sin cuenta en SAP: ${[...sinCuenta].join("; ")}. Asígnelas en Configuración, SAP - Conexión.`);
  if (sinCentro.size > 0) errores.push(`Reparto por centro de costo incompleto: ${[...sinCentro].join("; ")}.`);
  if (salida.length === 0) errores.push("La planilla no genera ninguna línea de asiento.");

  // Cuadre en centavos: el motor ya lo garantiza; se comprueba de nuevo porque
  // una línea descartada por falta de cuenta rompería el balance.
  totalDebe = Math.round(totalDebe * 100) / 100;
  totalHaber = Math.round(totalHaber * 100) / 100;
  if (errores.length === 0 && Math.abs(totalDebe - totalHaber) >= 0.005) {
    errores.push(`El asiento no cuadra: Debe ${totalDebe.toFixed(2)} contra Haber ${totalHaber.toFixed(2)}.`);
  }

  const fechaContable = o.fechaContable === "PAGO" && o.fechaPago ? o.fechaPago : o.fechaFin;
  if (o.fechaContable === "PAGO" && !o.fechaPago) avisos.push("La planilla no tiene fecha de pago: se usa el fin del período como fecha contable.");

  const memo = truncar(o.reverso ? `Reverso ${memoDesdePlantilla(o.memoPlantilla, o)}` : memoDesdePlantilla(o.memoPlantilla, o), o.longitudes.memo);
  const refs = referenciasDe(o);

  const payload: PayloadJournalEntry = {
    ReferenceDate: ymd(fechaContable),
    DueDate: ymd(fechaContable),
    TaxDate: ymd(o.fechaFin),
    Memo: memo,
    ...refs,
    ...(o.codigoTransaccion ? { TransactionCode: truncar(o.codigoTransaccion, 4) } : {}),
    ...(o.serie ? { Series: o.serie } : {}),
    JournalEntryLines: salida,
  };

  return { payload: errores.length === 0 ? payload : null, errores, avisos, totalDebe, totalHaber };
}

/** Suma exacta de un lado del asiento, para presentarla. */
export function totalLado(lineas: LineaSap[], lado: "Debit" | "Credit"): number {
  return Math.round(lineas.reduce((s, l) => s + l[lado], 0) * 100) / 100;
}

export type { Money };
