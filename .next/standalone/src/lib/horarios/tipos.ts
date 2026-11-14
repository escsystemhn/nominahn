/** Tipos del planificador de horarios rotativos. PURO. */

import type { ClaseExtra, TipoJornada } from "./ley";

export type EstadoDia = "TURNO" | "DESCANSO" | "AUSENCIA";

/** Un día de una persona en el plan. Horas en minutos desde la medianoche del día (`salida` puede pasar de 1440). */
export interface DiaPlan {
  empleadoId: string;
  /** AAAA-MM-DD */
  fecha: string;
  estado: EstadoDia;
  /** Sucursal donde trabaja ese día (distinta de la base si es traslado). */
  sucursalId: string | null;
  turnoId: string | null;
  entrada: number | null;
  salida: number | null;
  pausa: number;
  esTraslado: boolean;
  /** Lo editó una persona después de generarlo. */
  manual?: boolean;
  /** Ausencia (vacaciones, incapacidad, permiso) o razón de un descanso adicional. */
  motivo?: string | null;
}

export interface Preferencias {
  permiteTraslado: boolean;
  /** Sucursales aceptadas para traslado; vacío = cualquiera. */
  sucursalesTraslado: string[];
  /** Minutos desde la medianoche; `null` = sin restricción. */
  noAntesDe: number | null;
  noDespuesDe: number | null;
  /** Días ISO (1 = lunes … 7 = domingo) en que rige la restricción de horas; vacío = todos. */
  diasRestriccion: number[];
  /** Nada nocturno ni mixto (salud u otra causa). */
  soloDiurna: boolean;
  /** Días ISO que no puede trabajar. */
  diasNoDisponible: number[];
  diaDescansoPreferido: number | null;
  motivo: string | null;
}

export const PREFERENCIAS_VACIAS: Preferencias = {
  permiteTraslado: false,
  sucursalesTraslado: [],
  noAntesDe: null,
  noDespuesDe: null,
  diasRestriccion: [],
  soloDiurna: false,
  diasNoDisponible: [],
  diaDescansoPreferido: null,
  motivo: null,
};

export interface EmpleadoPlan {
  id: string;
  codigo: string;
  nombre: string;
  puestoId: string;
  sucursalId: string;
  /** Años cumplidos al inicio del plan. */
  edad: number;
  /** Cargo de dirección o confianza (Art. 325): fuera de la jornada máxima. */
  exento: boolean;
  preferencias: Preferencias;
}

export interface TurnoCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  entrada: number;
  salida: number;
  pausa: number;
  /** Horas ordinarias pactadas del turno (si es menor que la legal, lo demás es extra). */
  ordinariasPactadasH: number;
}

/** Personal mínimo de un puesto en una franja. `hasta` puede pasar de 1440. */
export interface Requisito {
  sucursalId: string;
  puestoId: string;
  dias: number[];
  desde: number;
  hasta: number;
  minimo: number;
  etiqueta: string | null;
}

export interface HorarioAtencionDia {
  sucursalId: string;
  /** Día ISO. */
  dia: number;
  apertura: number | null;
  cierre: number | null;
  cerrado: boolean;
}

export interface FeriadoPlan {
  fecha: string;
  /** `null` = toda la empresa. */
  sucursalId: string | null;
  nombre: string;
}

export type ModoVispera = "EXIGIR" | "ADVERTIR" | "NO_APLICAR";
export type PoliticaRotacion = "SEMANAL" | "EQUITATIVA" | "FIJA";

export interface ReglasHorario {
  /** Política de la empresa; el mínimo legal es 10 h (Art. 327). */
  descansoEntreJornadasH: number;
  /** Art. 341: salida a más tardar a la 1:00 p. m. la víspera del descanso. */
  vispera: ModoVispera;
  rotacion: PoliticaRotacion;
  /** Si falta personal, prolongar turnos con horas extra (marcadas y clasificadas). */
  permitirExtra: boolean;
  /** Puestos de dirección o confianza (Art. 325). */
  puestosExentos: string[];
}

export const REGLAS_POR_OMISION: ReglasHorario = {
  descansoEntreJornadasH: 12,
  vispera: "EXIGIR",
  rotacion: "SEMANAL",
  permitirExtra: false,
  puestosExentos: [],
};

export interface Alerta {
  nivel: "ERROR" | "AVISO" | "INFO";
  tipo: "LEGAL" | "OPERATIVA";
  codigo: string;
  mensaje: string;
  articulo?: string;
  empleadoId?: string;
  sucursalId?: string;
  puestoId?: string;
  fecha?: string;
}

export interface DiaCalculado extends DiaPlan {
  tipo: TipoJornada | null;
  efectivosMin: number;
  ordinariosMin: number;
  nocturnosMin: number;
  extra: Record<ClaseExtra, number>;
  extraTotalMin: number;
  feriado: string | null;
  categoria: CategoriaTurno | null;
}

export type CategoriaTurno = "APERTURA" | "INTERMEDIO" | "CIERRE" | "MEDIA";

export interface ResumenSemana {
  /** Lunes de la semana, AAAA-MM-DD. */
  inicio: string;
  diasTrabajados: number;
  ordinariasH: number;
  topeH: number;
  extraDiariaH: number;
  extraSemanalH: number;
  diasConExtra: number;
}

export interface ResumenEmpleado {
  empleadoId: string;
  semanas: ResumenSemana[];
  diasTrabajados: number;
  ordinariasH: number;
  extraH: number;
  extraPorClaseH: Record<ClaseExtra, number>;
  maxConsecutivos: number;
  descansos: number;
  descansosFinDeSemana: number;
  domingosLibres: number;
  aperturas: number;
  cierres: number;
  feriadosTrabajados: number;
  traslados: number;
}

export interface Faltante {
  sucursalId: string;
  puestoId: string;
  fecha: string;
  desde: number;
  hasta: number;
  requeridos: number;
  programados: number;
}

export interface ResultadoValidacion {
  dias: DiaCalculado[];
  resumen: ResumenEmpleado[];
  alertas: Alerta[];
  faltantes: Faltante[];
}
