/**
 * Tablero ejecutivo de Talento Humano: cálculos puros. La consulta está en
 * ./indicadores-bd.ts. Las definiciones (decididas el 2026-11-14, ver el plan):
 *
 *   Rotación      = bajas del período ÷ promedio de activos al inicio y al final × 100.
 *   Ausentismo    = días marcados como ausencia ÷ días con registro × 100.
 *   Horas extra   = horas extra ÷ horas ordinarias registradas × 100.
 *   Pasivo laboral = cesantía si se despidiera hoy a cada activo (Art. 120) más lo
 *                   devengado y sin pagar del 13.º y el 14.º.
 *   Décimos       = proyección al corte (13.º en diciembre, 14.º en junio) con el mismo
 *                   cálculo de la planilla (`calcularDecimo`), menos los adelantos ya
 *                   pagados: lo que queda por desembolsar.
 */
import type { TipoDecimo } from "@prisma/client";
import { calcularDecimo } from "@/lib/payroll/decimos";
import { calcularLiquidacion } from "@/lib/payroll/liquidacion";
import { aNumero } from "@/lib/payroll/money";
import { anioDecimoEnCurso } from "@/lib/prestaciones/anticipos";

export const redondear1 = (n: number) => Math.round(n * 10) / 10;
export const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const porcentaje = (parte: number, total: number) => (total > 0 ? redondear1((parte / total) * 100) : null);

export interface PersonaTablero {
  id: string;
  fechaIngreso: Date;
  fechaSalida: Date | null;
  salarioBase: number;
  sucursal: string;
  departamento: string;
}

/** ¿Estaba en planilla ese día? (ingresó y todavía no había salido) */
export const activoEn = (p: Pick<PersonaTablero, "fechaIngreso" | "fechaSalida">, dia: Date) =>
  p.fechaIngreso <= dia && (!p.fechaSalida || p.fechaSalida >= dia);

export function tasaRotacion(bajas: number, activosInicio: number, activosFin: number): number | null {
  const promedio = (activosInicio + activosFin) / 2;
  return promedio > 0 ? redondear1((bajas / promedio) * 100) : null;
}

/** "AAAA-MM" de cada mes que toca el rango. */
export function mesesDelRango(desde: Date, hasta: Date): string[] {
  const meses: string[] = [];
  let a = desde.getUTCFullYear();
  let m = desde.getUTCMonth();
  while (a < hasta.getUTCFullYear() || (a === hasta.getUTCFullYear() && m <= hasta.getUTCMonth())) {
    meses.push(`${a}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m === 12) {
      m = 0;
      a++;
    }
  }
  return meses;
}

const mesDe = (d: Date) => d.toISOString().slice(0, 7);
const dentro = (d: Date | null, desde: Date, hasta: Date) => !!d && d >= desde && d <= hasta;

export interface FuerzaLaboral {
  activos: number;
  altas: number;
  bajas: number;
  rotacion: number | null;
  porSucursal: { nombre: string; activos: number }[];
  porDepartamento: { nombre: string; activos: number }[];
  porMes: { mes: string; altas: number; bajas: number }[];
}

export function fuerzaLaboral(personas: readonly PersonaTablero[], desde: Date, hasta: Date): FuerzaLaboral {
  const alFinal = personas.filter((p) => activoEn(p, hasta));
  const alInicio = personas.filter((p) => activoEn(p, desde)).length;
  const altas = personas.filter((p) => dentro(p.fechaIngreso, desde, hasta));
  const bajas = personas.filter((p) => dentro(p.fechaSalida, desde, hasta));
  const contar = (clave: "sucursal" | "departamento") => {
    const m = new Map<string, number>();
    for (const p of alFinal) m.set(p[clave], (m.get(p[clave]) ?? 0) + 1);
    return [...m].map(([nombre, activos]) => ({ nombre, activos })).sort((a, b) => b.activos - a.activos || a.nombre.localeCompare(b.nombre));
  };
  return {
    activos: alFinal.length,
    altas: altas.length,
    bajas: bajas.length,
    rotacion: tasaRotacion(bajas.length, alInicio, alFinal.length),
    porSucursal: contar("sucursal"),
    porDepartamento: contar("departamento"),
    porMes: mesesDelRango(desde, hasta).map((mes) => ({
      mes,
      altas: altas.filter((p) => mesDe(p.fechaIngreso) === mes).length,
      bajas: bajas.filter((p) => p.fechaSalida && mesDe(p.fechaSalida) === mes).length,
    })),
  };
}

export interface Asistencia {
  diasConRegistro: number;
  ausencias: number;
  ausentismo: number | null;
  horasOrdinarias: number;
  horasExtra: number;
  /** Horas extra por cada 100 horas ordinarias. */
  extraSobreOrdinarias: number | null;
  /** % de días marcados en que llegó a tiempo; null si no hay marcas con turno. */
  puntualidad: number | null;
}

/** Con los totales del período (la base los suma: pueden ser decenas de miles de días). */
export function asistencia(
  t: { diasConRegistro: number; ausencias: number; horasOrdinarias: number; horasExtra: number },
  puntualidad: { diasConMarca: number; llegadasTarde: number } | null
): Asistencia {
  const ausencias = t.ausencias;
  const ordinarias = redondear2(t.horasOrdinarias);
  const extra = redondear2(t.horasExtra);
  return {
    diasConRegistro: t.diasConRegistro,
    ausencias,
    ausentismo: porcentaje(ausencias, t.diasConRegistro),
    horasOrdinarias: ordinarias,
    horasExtra: extra,
    extraSobreOrdinarias: porcentaje(extra, ordinarias),
    puntualidad: puntualidad && puntualidad.diasConMarca > 0 ? redondear1(100 - (puntualidad.llegadasTarde / puntualidad.diasConMarca) * 100) : null,
  };
}

export interface ProyeccionDecimo {
  tipo: TipoDecimo;
  /** Año de PAGO (13.º: diciembre; 14.º: junio). */
  anio: number;
  /** Devengado hasta hoy. */
  acumulado: number;
  /** Lo que se pagará al corte, si siguen todos. */
  proyectado: number;
  adelantos: number;
  /** proyectado − adelantos, sin bajar de cero por persona. */
  neto: number;
  porSucursal: { nombre: string; proyectado: number; adelantos: number; neto: number; empleados: number }[];
}

/**
 * Proyección de un décimo para quienes siguen activos hoy: lo que se lleva devengado y
 * lo que se pagará al corte, con el mismo cálculo que la planilla, menos los adelantos
 * de ese décimo ya pagados aparte.
 */
export function proyectarDecimo(
  tipo: TipoDecimo,
  hoy: Date,
  personas: readonly PersonaTablero[],
  adelantosPorEmpleado: ReadonlyMap<string, number>
): ProyeccionDecimo {
  const anio = anioDecimoEnCurso(tipo, hoy);
  const grupos = new Map<string, { proyectado: number; adelantos: number; neto: number; empleados: number }>();
  let acumulado = 0;
  let proyectado = 0;
  let adelantos = 0;
  let neto = 0;
  for (const p of personas) {
    if (!activoEn(p, hoy)) continue;
    const base = { tipo, anio, fechaIngreso: p.fechaIngreso, fechaSalida: p.fechaSalida, salarioPromedio: p.salarioBase };
    const alCorte = aNumero(calcularDecimo(base).montoDevengado);
    const aHoy = aNumero(calcularDecimo({ ...base, hasta: hoy }).montoDevengado);
    const adelanto = adelantosPorEmpleado.get(p.id) ?? 0;
    const suNeto = Math.max(0, alCorte - adelanto);
    acumulado += aHoy;
    proyectado += alCorte;
    adelantos += adelanto;
    neto += suNeto;
    const g = grupos.get(p.sucursal) ?? { proyectado: 0, adelantos: 0, neto: 0, empleados: 0 };
    g.proyectado += alCorte;
    g.adelantos += adelanto;
    g.neto += suNeto;
    g.empleados++;
    grupos.set(p.sucursal, g);
  }
  return {
    tipo,
    anio,
    acumulado: redondear2(acumulado),
    proyectado: redondear2(proyectado),
    adelantos: redondear2(adelantos),
    neto: redondear2(neto),
    porSucursal: [...grupos]
      .map(([nombre, g]) => ({ nombre, proyectado: redondear2(g.proyectado), adelantos: redondear2(g.adelantos), neto: redondear2(g.neto), empleados: g.empleados }))
      .sort((a, b) => b.proyectado - a.proyectado),
  };
}

/** Cesantía que se le debería hoy por un despido injustificado (Art. 120), con su salario actual. */
export function cesantiaAcumulada(p: Pick<PersonaTablero, "fechaIngreso" | "salarioBase">, hoy: Date, esMicroempresa: boolean): number {
  if (p.fechaIngreso > hoy) return 0;
  const r = calcularLiquidacion({ fechaIngreso: p.fechaIngreso, fechaSalida: hoy, causa: "DESPIDO_INJUSTIFICADO", salarioPromedio: p.salarioBase, esMicroempresa });
  return aNumero(r.conceptos.find((c) => c.concepto.startsWith("Auxilio de cesantía"))?.monto ?? 0);
}

/** Variación porcentual de un período respecto del anterior; null sin anterior. */
export const variacion = (actual: number, anterior: number) => (anterior > 0 ? redondear1(((actual - anterior) / anterior) * 100) : null);
