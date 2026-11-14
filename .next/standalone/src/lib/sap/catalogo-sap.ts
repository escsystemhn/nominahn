/**
 * Del plan de cuentas de SAP Business One al catálogo local.
 *
 * PURO: recibe las cuentas tal como las devuelve `ChartOfAccounts` y produce
 * las filas de `CuentaContable` más el reparto de los mapeos existentes. Quien
 * escribe en la base es `catalogo.ts`.
 *
 * Reglas de B1 que se aprovechan:
 *   · El nivel 1 son los «cajones» con código fijo de 15 dígitos
 *     (100000000000000 Activo, 200000000000000 Pasivo, …): el primer dígito
 *     del cajón raíz dice el tipo NIIF de toda su rama.
 *   · `ActiveAccount` = tYES es cuenta ACTIVA (recibe asientos); tNO es cuenta
 *     de TÍTULO. No habla de vigencia: eso es `FrozenFor`.
 *   · `FormatCode` es el código visible (con segmentos, si los hay); `Code` es
 *     el interno (`_SYS…` en planes segmentados) y es el que acepta
 *     `JournalEntries`. Aquí: codigo = FormatCode, sapAcctCode = Code.
 */

import { CUENTAS, type ClaveCuenta } from "@/lib/payroll/partida-contable";
import { NATURALEZA_NORMAL, TIPOS_PERMITIDOS, CODIGO_CUENTA, type TipoCuenta, type Naturaleza } from "@/lib/payroll/catalogo-contable";

export interface CuentaSapCompleta {
  Code: string;
  Name: string;
  FormatCode?: string | null;
  ActiveAccount?: string | null;
  FatherAccountKey?: string | null;
  AccountLevel?: number | null;
  AccountType?: string | null;
  FrozenFor?: string | null;
}

export interface FilaCatalogoSap {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  padreCodigo: string | null;
  esDetalle: boolean;
  activa: boolean;
  nivel: number;
  sapAcctCode: string;
  sapNombre: string;
}

export interface ResumenCatalogoSap {
  total: number;
  detalle: number;
  titulos: number;
  inactivas: number;
  porTipo: Record<TipoCuenta, number>;
}

export interface ResultadoCatalogoSap {
  filas: FilaCatalogoSap[];
  avisos: string[];
  resumen: ResumenCatalogoSap;
}

/** Tipo NIIF por cajón de B1 (primer dígito del código raíz). */
const TIPO_POR_CAJON: Record<string, TipoCuenta> = {
  "1": "ACTIVO",
  "2": "PASIVO",
  "3": "PATRIMONIO",
  "4": "INGRESO",
  "5": "COSTO",
  "6": "GASTO",
  "7": "GASTO", // financiamiento
  "8": "INGRESO", // otros ingresos
  "9": "GASTO", // otros gastos
};

const TIPO_POR_ACCOUNT_TYPE: Record<string, TipoCuenta> = {
  at_Revenues: "INGRESO",
  at_Expenses: "GASTO",
};

export function construirCatalogoDesdeSap(cuentas: CuentaSapCompleta[]): ResultadoCatalogoSap {
  const avisos: string[] = [];
  const porCode = new Map<string, CuentaSapCompleta>();
  for (const c of cuentas) {
    if (!c?.Code) continue;
    if (porCode.has(c.Code)) {
      avisos.push(`SAP devolvió dos veces la cuenta ${c.Code}; se tomó la primera.`);
      continue;
    }
    porCode.set(c.Code, c);
  }

  const hijos = new Map<string, number>();
  for (const c of porCode.values()) {
    if (c.FatherAccountKey) hijos.set(c.FatherAccountKey, (hijos.get(c.FatherAccountKey) ?? 0) + 1);
  }

  /** Cajón raíz de una cuenta (nivel 1), subiendo por FatherAccountKey. */
  const raizCache = new Map<string, CuentaSapCompleta | null>();
  const raiz = (c: CuentaSapCompleta): CuentaSapCompleta | null => {
    if (raizCache.has(c.Code)) return raizCache.get(c.Code) ?? null;
    const visitados = new Set<string>();
    let actual: CuentaSapCompleta | undefined = c;
    while (actual && actual.FatherAccountKey && porCode.has(actual.FatherAccountKey)) {
      if (visitados.has(actual.Code)) {
        avisos.push(`Ciclo de cuentas madre alrededor de ${actual.Code}.`);
        actual = undefined;
        break;
      }
      visitados.add(actual.Code);
      actual = porCode.get(actual.FatherAccountKey);
    }
    const r = actual ?? null;
    raizCache.set(c.Code, r);
    return r;
  };

  const nivelCache = new Map<string, number>();
  const nivel = (c: CuentaSapCompleta): number => {
    if (typeof c.AccountLevel === "number" && c.AccountLevel > 0) return c.AccountLevel;
    if (nivelCache.has(c.Code)) return nivelCache.get(c.Code) as number;
    let n = 1;
    let actual: CuentaSapCompleta | undefined = c;
    const visitados = new Set<string>();
    while (actual?.FatherAccountKey && porCode.has(actual.FatherAccountKey) && !visitados.has(actual.Code)) {
      visitados.add(actual.Code);
      actual = porCode.get(actual.FatherAccountKey);
      n++;
      if (n > 20) break;
    }
    nivelCache.set(c.Code, n);
    return n;
  };

  const codigosUsados = new Set<string>();
  const codigoDe = new Map<string, string>();
  const filas: FilaCatalogoSap[] = [];
  const porTipo: Record<TipoCuenta, number> = { ACTIVO: 0, PASIVO: 0, PATRIMONIO: 0, INGRESO: 0, COSTO: 0, GASTO: 0 };
  let detalle = 0, titulos = 0, inactivas = 0;

  // Primero se decide el código visible de cada cuenta, para poder resolver la madre.
  const ordenadas = [...porCode.values()].sort((a, b) => nivel(a) - nivel(b) || a.Code.localeCompare(b.Code));
  for (const c of ordenadas) {
    const visible = (c.FormatCode ?? "").trim() || c.Code;
    let codigo = visible;
    if (codigosUsados.has(codigo)) {
      codigo = `${visible}~${c.Code}`;
      avisos.push(`Dos cuentas de SAP comparten el código visible ${visible}; ${c.Code} queda como ${codigo}.`);
    }
    if (!CODIGO_CUENTA.test(codigo)) avisos.push(`El código ${codigo} tiene caracteres o longitud fuera de lo habitual; se importa igual.`);
    codigosUsados.add(codigo);
    codigoDe.set(c.Code, codigo);
  }

  for (const c of ordenadas) {
    const r = raiz(c);
    const digito = r?.Code?.charAt(0) ?? "";
    let tipo = TIPO_POR_CAJON[digito];
    if (!tipo) {
      tipo = TIPO_POR_ACCOUNT_TYPE[c.AccountType ?? ""] ?? "ACTIVO";
      avisos.push(`No se reconoció el cajón de ${c.Code} (${c.Name}); se clasificó como ${tipo}.`);
    }
    const tieneHijos = (hijos.get(c.Code) ?? 0) > 0;
    const esDetalle = c.ActiveAccount === undefined || c.ActiveAccount === null ? !tieneHijos : c.ActiveAccount !== "tNO" && !tieneHijos;
    const activa = c.FrozenFor !== "tYES";
    const padre = c.FatherAccountKey && porCode.has(c.FatherAccountKey) ? (codigoDe.get(c.FatherAccountKey) ?? null) : null;
    const fila: FilaCatalogoSap = {
      codigo: codigoDe.get(c.Code) as string,
      nombre: (c.Name ?? "").trim() || c.Code,
      tipo,
      naturaleza: NATURALEZA_NORMAL[tipo],
      padreCodigo: padre,
      esDetalle,
      activa,
      nivel: nivel(c),
      sapAcctCode: c.Code,
      sapNombre: (c.Name ?? "").trim(),
    };
    filas.push(fila);
    porTipo[tipo]++;
    if (esDetalle) detalle++;
    else titulos++;
    if (!activa) inactivas++;
  }

  return { filas, avisos, resumen: { total: filas.length, detalle, titulos, inactivas, porTipo } };
}

export interface MapeoAnterior {
  clave: string;
  codigo: string | null;
  sapAcctCode: string | null;
}

export interface ResultadoReasignacion {
  asignaciones: Array<{ clave: ClaveCuenta; codigo: string }>;
  sinCuenta: Array<{ clave: ClaveCuenta; concepto: string; motivo: string }>;
}

/**
 * Qué cuenta nueva recibe cada concepto tras reemplazar el catálogo: primero
 * por el código de SAP ya asignado en el mapeo, después por el código visible.
 * Lo que no encaja (o no es de detalle, o no es del tipo admitido) queda sin
 * cuenta para que el contador lo decida.
 */
export function reasignarMapeos(anteriores: MapeoAnterior[], filas: FilaCatalogoSap[]): ResultadoReasignacion {
  const porSap = new Map(filas.map((f) => [f.sapAcctCode, f]));
  const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
  const asignaciones: ResultadoReasignacion["asignaciones"] = [];
  const sinCuenta: ResultadoReasignacion["sinCuenta"] = [];

  for (const m of anteriores) {
    if (!(m.clave in CUENTAS)) continue;
    const clave = m.clave as ClaveCuenta;
    const concepto = CUENTAS[clave].nombre;
    if (!m.codigo && !m.sapAcctCode) {
      sinCuenta.push({ clave, concepto, motivo: "no tenía cuenta asignada" });
      continue;
    }
    const candidata = (m.sapAcctCode && porSap.get(m.sapAcctCode)) || (m.codigo && (porCodigo.get(m.codigo) || porSap.get(m.codigo))) || null;
    if (!candidata) {
      sinCuenta.push({ clave, concepto, motivo: `la cuenta ${m.codigo ?? m.sapAcctCode} no existe en SAP` });
      continue;
    }
    if (!candidata.esDetalle) {
      sinCuenta.push({ clave, concepto, motivo: `${candidata.codigo} es cuenta de título en SAP` });
      continue;
    }
    if (!candidata.activa) {
      sinCuenta.push({ clave, concepto, motivo: `${candidata.codigo} está inactiva en SAP` });
      continue;
    }
    if (!TIPOS_PERMITIDOS[clave].includes(candidata.tipo)) {
      sinCuenta.push({ clave, concepto, motivo: `${candidata.codigo} es de tipo ${candidata.tipo}, no admitido para este concepto` });
      continue;
    }
    asignaciones.push({ clave, codigo: candidata.codigo });
  }
  return { asignaciones, sinCuenta };
}
