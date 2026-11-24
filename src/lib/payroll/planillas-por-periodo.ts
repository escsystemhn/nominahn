/**
 * La lista de Planillas por período de pago (pedido de Edbin, 2026-11-24, con la maqueta
 * aprobada): cada período (frecuencia + fechas) reúne las planillas de sus sucursales,
 * que en PAGSA son una por sucursal. El mes más reciente va abierto; los meses
 * anteriores del mismo año, uno por fila con su resumen; los años anteriores, uno por
 * fila. PURO: recibe las planillas ya leídas.
 *
 * Una planilla anulada se muestra en su período pero no suma ni cuenta como pendiente:
 * no se pagó.
 */

import { CERO, money, type Money, type MoneyInput } from "./money";
import { etiquetaPeriodo, type TipoPlanillaPeriodo } from "./periodos-planilla";

export type EstadoLista = "BORRADOR" | "CALCULADA" | "APROBADA" | "PAGADA" | "ANULADA";

export interface PlanillaResumen {
  id: string;
  tipo: TipoPlanillaPeriodo;
  /** AAAA-MM-DD */
  desde: string;
  hasta: string;
  estado: EstadoLista;
  bruto: MoneyInput;
  deducciones: MoneyInput;
  neto: MoneyInput;
  empleados: number;
  /** «Grupo PAGSA / Pagsa SPS»: dónde aplica. */
  alcance: string;
}

export interface Resumen {
  /** Cuántas planillas, anuladas incluidas. */
  cantidad: number;
  /** Sin contar las anuladas. */
  vigentes: number;
  pagadas: number;
  /** Ni pagadas ni anuladas: alguien tiene que hacer algo. */
  pendientes: number;
  porEstado: Partial<Record<EstadoLista, number>>;
  bruto: Money;
  deducciones: Money;
  neto: Money;
  empleados: number;
}

export interface Periodo extends Resumen {
  clave: string;
  tipo: TipoPlanillaPeriodo;
  desde: string;
  hasta: string;
  /** «2.ª quincena de noviembre de 2026», «Noviembre de 2026». */
  nombre: string;
  anio: number;
  /** 0 = enero. */
  mes: number;
  planillas: PlanillaResumen[];
}

export interface MesDePeriodos extends Resumen {
  clave: string;
  anio: number;
  mes: number;
  /** «Octubre de 2026». */
  nombre: string;
  periodos: Periodo[];
}

export interface AnioDePeriodos extends Resumen {
  anio: number;
  meses: MesDePeriodos[];
}

export interface PlanillasPorPeriodo {
  /** El mes del período más reciente, abierto. */
  reciente: MesDePeriodos | null;
  /** Los demás meses de ese año, del más reciente al más antiguo. */
  anteriores: MesDePeriodos[];
  /** Los años anteriores, del más reciente al más antiguo. */
  anios: AnioDePeriodos[];
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (anio: number, mes: number) => `${MESES[mes][0].toUpperCase()}${MESES[mes].slice(1)} de ${anio}`;
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «2.ª quincena de noviembre de 2026», con mayúscula: el título de un período. */
export const nombreDePeriodo = (p: { tipo: TipoPlanillaPeriodo; desde: string; hasta: string }) => mayuscula(etiquetaPeriodo(p));

function resumir(ps: readonly PlanillaResumen[]): Resumen {
  const r: Resumen = { cantidad: ps.length, vigentes: 0, pagadas: 0, pendientes: 0, porEstado: {}, bruto: CERO, deducciones: CERO, neto: CERO, empleados: 0 };
  for (const p of ps) {
    r.porEstado[p.estado] = (r.porEstado[p.estado] ?? 0) + 1;
    if (p.estado === "ANULADA") continue;
    r.vigentes++;
    if (p.estado === "PAGADA") r.pagadas++;
    else r.pendientes++;
    r.bruto = r.bruto.plus(money(p.bruto));
    r.deducciones = r.deducciones.plus(money(p.deducciones));
    r.neto = r.neto.plus(money(p.neto));
    r.empleados += p.empleados;
  }
  return r;
}

/** Un período es la misma frecuencia con las mismas fechas. */
export const claveDePeriodo = (p: { tipo: string; desde: string; hasta: string }) => `${p.tipo}|${p.desde}|${p.hasta}`;

export function agruparPorPeriodo(planillas: readonly PlanillaResumen[]): PlanillasPorPeriodo {
  const porClave = new Map<string, PlanillaResumen[]>();
  for (const p of planillas) {
    const clave = claveDePeriodo(p);
    porClave.set(clave, [...(porClave.get(clave) ?? []), p]);
  }
  const periodos: Periodo[] = [...porClave.entries()].map(([clave, ps]) => {
    const { tipo, desde, hasta } = ps[0];
    const ordenadas = [...ps].sort((a, b) => a.alcance.localeCompare(b.alcance, "es", { numeric: true }) || a.id.localeCompare(b.id));
    return {
      clave, tipo, desde, hasta,
      nombre: nombreDePeriodo({ tipo, desde, hasta }),
      anio: Number(desde.slice(0, 4)),
      mes: Number(desde.slice(5, 7)) - 1,
      planillas: ordenadas,
      ...resumir(ordenadas),
    };
  }).sort((a, b) => b.desde.localeCompare(a.desde) || b.hasta.localeCompare(a.hasta));

  if (!periodos.length) return { reciente: null, anteriores: [], anios: [] };

  // Meses, del más reciente al más antiguo.
  const meses: MesDePeriodos[] = [];
  for (const p of periodos) {
    const clave = `${p.anio}-${String(p.mes + 1).padStart(2, "0")}`;
    let m = meses.find((x) => x.clave === clave);
    if (!m) {
      m = { clave, anio: p.anio, mes: p.mes, nombre: nombreMes(p.anio, p.mes), periodos: [], ...resumir([]) };
      meses.push(m);
    }
    m.periodos.push(p);
  }
  for (const m of meses) Object.assign(m, resumir(m.periodos.flatMap((p) => p.planillas)));

  const [reciente, ...resto] = meses;
  const anteriores = resto.filter((m) => m.anio === reciente.anio);
  const anios: AnioDePeriodos[] = [];
  for (const m of resto.filter((x) => x.anio < reciente.anio)) {
    let a = anios.find((x) => x.anio === m.anio);
    if (!a) {
      a = { anio: m.anio, meses: [], ...resumir([]) };
      anios.push(a);
    }
    a.meses.push(m);
  }
  for (const a of anios) Object.assign(a, resumir(a.meses.flatMap((m) => m.periodos.flatMap((p) => p.planillas))));
  return { reciente, anteriores, anios };
}

/** «Del 16 al 30 de noviembre»; si cruza de mes o de año, con los dos. */
export function rangoLegible(desde: string, hasta: string): string {
  const [ad, md, dd] = desde.split("-").map(Number);
  const [ah, mh, dh] = hasta.split("-").map(Number);
  if (ad === ah && md === mh) return `Del ${dd} al ${dh} de ${MESES[mh - 1]}`;
  if (ad === ah) return `Del ${dd} de ${MESES[md - 1]} al ${dh} de ${MESES[mh - 1]}`;
  return `Del ${dd} de ${MESES[md - 1]} de ${ad} al ${dh} de ${MESES[mh - 1]} de ${ah}`;
}

/** ¿El período cubre hoy? Para rotular el que está en curso. */
export function enCurso(p: Pick<Periodo, "desde" | "hasta">, hoy: string): boolean {
  return p.desde <= hoy && hoy <= p.hasta;
}
