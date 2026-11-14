/**
 * Qué aspectos se evalúan a cada empleado.
 *
 * Por orden:
 *   1. Los de su PUESTO (Talento → Competencias, «Asignar a un puesto»), con su peso.
 *   2. Si su puesto no tiene, los aspectos GENERALES del catálogo (marcados «general»).
 *   3. Si tampoco hay generales, la lista BASE de siempre (puntualidad y asistencia,
 *      calidad, productividad…), para que ninguna evaluación quede sin aspectos.
 * En los tres casos sólo cuentan los del tipo de evaluación pedido o los de «ambas».
 *
 * Este archivo es puro (sin Prisma) para que la pantalla use la misma lista base.
 */
import type { TipoEvaluacion } from "@prisma/client";

export type OrigenAspecto = "PUESTO" | "GENERAL" | "BASE";

export interface Aspecto {
  /** CompetenciaDefinicion.id, o null en la lista base (se guarda como texto libre). */
  competenciaId: string | null;
  nombre: string;
  descripcion: string | null;
  peso: number;
  /** Nivel requerido por el puesto (INICIAL…EXPERTO); sólo en origen PUESTO. */
  nivelRequerido: string | null;
}

export interface AspectosEvaluacion {
  origen: OrigenAspecto;
  aspectos: Aspecto[];
}

const base = (nombres: string[]): Aspecto[] =>
  nombres.map((nombre) => ({ competenciaId: null, nombre, descripcion: null, peso: 1, nivelRequerido: null }));

/** La lista que tenía la pantalla antes de que los aspectos fueran configurables. */
export const ASPECTOS_BASE: Record<TipoEvaluacion, Aspecto[]> = {
  DESEMPENO_MENSUAL: base(["Puntualidad y asistencia", "Calidad del trabajo", "Productividad", "Trabajo en equipo", "Actitud y compromiso"]),
  COMPETENCIA_TRIMESTRAL: base([
    "Conocimiento técnico",
    "Liderazgo",
    "Comunicación",
    "Resolución de problemas",
    "Orientación al cliente",
    "Innovación",
  ]),
};

interface CompetenciaLeida {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  tipoEvaluacion: TipoEvaluacion | null;
}

export interface FilaPuesto {
  peso: unknown;
  nivelRequerido: string;
  competencia: CompetenciaLeida;
}

export interface FilaGeneral extends CompetenciaLeida {
  peso: unknown;
}

const aplica = (tipo: TipoEvaluacion) => (c: { activa: boolean; tipoEvaluacion: TipoEvaluacion | null }) =>
  c.activa && (c.tipoEvaluacion === null || c.tipoEvaluacion === tipo);

/** Elige los aspectos a partir de lo leído de la base (ver el orden arriba). */
export function elegirAspectos(tipo: TipoEvaluacion, delPuesto: readonly FilaPuesto[], generales: readonly FilaGeneral[]): AspectosEvaluacion {
  const puesto = delPuesto
    .filter((f) => aplica(tipo)(f.competencia))
    .map((f) => ({
      competenciaId: f.competencia.id,
      nombre: f.competencia.nombre,
      descripcion: f.competencia.descripcion,
      peso: Number(f.peso),
      nivelRequerido: f.nivelRequerido,
    }))
    .filter((a) => a.peso > 0);
  if (puesto.length > 0) return { origen: "PUESTO", aspectos: puesto };

  const general = generales
    .filter(aplica(tipo))
    .map((g) => ({ competenciaId: g.id, nombre: g.nombre, descripcion: g.descripcion, peso: Number(g.peso), nivelRequerido: null }))
    .filter((a) => a.peso > 0);
  if (general.length > 0) return { origen: "GENERAL", aspectos: general };

  return { origen: "BASE", aspectos: ASPECTOS_BASE[tipo].map((a) => ({ ...a })) };
}

export const ETIQUETA_ORIGEN: Record<OrigenAspecto, string> = {
  PUESTO: "los aspectos de su puesto",
  GENERAL: "los aspectos generales (su puesto no tiene propios)",
  BASE: "la lista base (no hay aspectos configurados)",
};
