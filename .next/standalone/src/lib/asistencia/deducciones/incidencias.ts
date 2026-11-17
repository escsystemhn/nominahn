/**
 * Convierte lo que la base sabe de un período (marcas, turno de cada día, permisos,
 * incapacidades y feriados) en las incidencias del motor de deducciones. PURO: la planilla
 * hace las consultas y le pasa los datos (ver `calculo-planilla-bd.ts`).
 *
 * Reglas:
 *   · Marca de ausencia → INJUSTIFICADA, salvo que ese día lo cubra una incapacidad
 *     (INCAPACIDAD) o un permiso aprobado (SIN_GOCE si es sin goce; CON_GOCE los demás).
 *   · Permiso sin goce aprobado → ausencia SIN_GOCE en cada día laboral que cubre, aunque
 *     el reloj no lo marque; no si la persona trabajó ese día. Cubre sus primeros N días
 *     laborales, N = días aprobados (o solicitados si no se anotaron).
 *   · Con entrada y salida en un día laboral que no es feriado: llegada tarde y salida
 *     anticipada contra el horario del turno. Lo que la marca repuso fuera de horario
 *     (llegó tarde y se quedó después, o entró antes y salió antes) va en
 *     `minutosRepuestos`: ya completó la jornada y no se le pagó como extra.
 *   · La tolerancia del TURNO no se usa aquí (sigue en el reporte de puntualidad): la del
 *     descuento es la de la política, para no regalar dos veces la gracia.
 */

import type { Turno } from "@/lib/asistencia/turnos";
import { esDiaLaboral, minutosDelDia, parseDias, parseHora } from "@/lib/asistencia/turnos-reglas";
import type { MoneyInput } from "@/lib/payroll/money";
import { HORAS_JORNADA_LEGAL, type FrecuenciaPago } from "./politica";
import type { Incidencia, PerfilEmpleado } from "./motor";

export interface MarcaParaAsistencia {
  fecha: string; // AAAA-MM-DD
  esAusencia: boolean;
  horaEntrada: Date | null;
  horaSalida: Date | null;
  /** Horas ordinarias que `repartirJornada` le reconoció a la marca (sin almuerzo). */
  horasNormales: number;
}

export interface PermisoParaAsistencia {
  tipo: string; // TipoPermiso
  desde: string;
  hasta: string;
  dias: number;
}

const MS_DIA = 86_400_000;
const aFecha = (f: string) => new Date(`${f}T00:00:00Z`);
const siguiente = (f: string) => new Date(aFecha(f).getTime() + MS_DIA).toISOString().slice(0, 10);

/** Perfil del motor a partir del turno: jornada legal si coincide, si no personalizada. */
export function perfilDesdeTurno(turno: Turno, salarioMensual: MoneyInput, frecuencia: FrecuenciaPago): PerfilEmpleado {
  const horario: Record<number, number> = {};
  for (const d of parseDias(turno.diasLaborales)) horario[d] = turno.jornadaHoras;
  return {
    salarioMensual,
    frecuencia,
    jornada: turno.jornadaHoras === HORAS_JORNADA_LEGAL[turno.tipoJornada] ? { tipo: turno.tipoJornada } : { tipo: "PERSONALIZADA", horasDiarias: turno.jornadaHoras },
    horario,
  };
}

/**
 * Minutos tarde, de salida anticipada y repuestos de una marca contra su turno. `null` si
 * falta una marca o el turno no tiene horario fijo (el implícito).
 */
export function tiempoFueraDeHorario(m: MarcaParaAsistencia, turno: Turno): { tarde: number; temprano: number; repuestoTarde: number; repuestoTemprano: number } | null {
  if (!m.horaEntrada || !m.horaSalida || !turno.horaEntrada || !turno.horaSalida) return null;
  const pe = parseHora(turno.horaEntrada);
  const ps = parseHora(turno.horaSalida);
  if (pe === null || ps === null) return null;
  const salidaProgramada = turno.cruzaMedianoche || ps <= pe ? ps + 1440 : ps;
  const entrada = minutosDelDia(m.horaEntrada);
  const salida = entrada + (m.horaSalida.getTime() - m.horaEntrada.getTime()) / 60_000;
  const diff = entrada - pe;
  // Más de 12 h «tarde» es la entrada de otro turno o un dato raro (igual que el reporte).
  const tarde = diff > 0 && diff <= 12 * 60 ? Math.round(diff) : 0;
  const temprano = Math.max(0, Math.round(salidaProgramada - salida));
  const faltante = Math.max(0, Math.round(turno.jornadaHoras * 60 - m.horasNormales * 60));
  const repuesto = Math.max(0, tarde + temprano - faltante);
  const repuestoTarde = Math.min(tarde, repuesto);
  return { tarde, temprano, repuestoTarde, repuestoTemprano: Math.min(temprano, repuesto - repuestoTarde) };
}

/** Días que cubre cada permiso: sus primeros `dias` días laborales desde que empieza. */
function diasCubiertos(p: PermisoParaAsistencia, turnoDe: (f: string) => Turno): string[] {
  const salida: string[] = [];
  for (let f = p.desde; f <= p.hasta && salida.length < p.dias; f = siguiente(f)) {
    if (esDiaLaboral(aFecha(f), turnoDe(f).diasLaborales)) salida.push(f);
  }
  return salida;
}

export function incidenciasDelPeriodo(d: {
  desde: string;
  hasta: string;
  marcas: MarcaParaAsistencia[];
  turnoDe: (fecha: string) => Turno;
  /** Sólo permisos APROBADOS. */
  permisos: PermisoParaAsistencia[];
  fechasIncapacidad: Set<string>;
  feriados: Set<string>;
}): Incidencia[] {
  const permisoDe = new Map<string, string>();
  for (const p of d.permisos) for (const f of diasCubiertos(p, d.turnoDe)) permisoDe.set(f, p.tipo);
  const marcaDe = new Map(d.marcas.map((m) => [m.fecha, m]));
  const salida: Incidencia[] = [];

  for (const m of d.marcas) {
    if (m.fecha < d.desde || m.fecha > d.hasta) continue;
    if (m.esAusencia) {
      const permiso = permisoDe.get(m.fecha);
      salida.push({
        tipo: "AUSENCIA", fecha: m.fecha,
        clasificacion: d.fechasIncapacidad.has(m.fecha) ? "INCAPACIDAD" : permiso ? (permiso === "SIN_GOCE" ? "SIN_GOCE" : "CON_GOCE") : "INJUSTIFICADA",
      });
      continue;
    }
    const turno = d.turnoDe(m.fecha);
    if (!esDiaLaboral(aFecha(m.fecha), turno.diasLaborales) || d.feriados.has(m.fecha)) continue;
    const t = tiempoFueraDeHorario(m, turno);
    if (!t) continue;
    if (t.tarde > 0) salida.push({ tipo: "TARDANZA", fecha: m.fecha, minutos: t.tarde, minutosRepuestos: t.repuestoTarde });
    if (t.temprano > 0) salida.push({ tipo: "SALIDA_ANTICIPADA", fecha: m.fecha, minutos: t.temprano, minutosRepuestos: t.repuestoTemprano });
  }

  // Permisos sin goce en días que el reloj no marcó como ausencia.
  for (const [f, tipo] of permisoDe) {
    if (tipo !== "SIN_GOCE" || f < d.desde || f > d.hasta) continue;
    const m = marcaDe.get(f);
    if (m?.esAusencia || m?.horaEntrada || d.fechasIncapacidad.has(f) || d.feriados.has(f)) continue;
    salida.push({ tipo: "AUSENCIA", fecha: f, clasificacion: "SIN_GOCE" });
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
