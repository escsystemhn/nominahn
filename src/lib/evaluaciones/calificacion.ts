/**
 * Calificación de una evaluación de desempeño, en escala 0–100.
 *
 * Funciones puras: las usan la API (que es la que guarda) y la pantalla (que sólo
 * muestra el resultado mientras se llena el formulario). La calificación que vale
 * es la que calcula el servidor; la del navegador nunca se guarda tal cual.
 *
 * POR QUÉ existe: antes la pantalla calculaba un promedio simple y lo mandaba, la API
 * lo descartaba al validar y la evaluación quedaba con su valor por omisión, 0. Los
 * pesos de cada aspecto (PuestoCompetencia.peso) tampoco se usaban.
 */

export interface CriterioPuntuado {
  /** 0–100; null o ausente = todavía sin calificar. */
  calificacion: number | null | undefined;
  /** Peso relativo del aspecto; 0 o negativo lo deja fuera. */
  peso: number;
}

/** Redondeo a dos decimales, mitad hacia arriba (lo que guarda Decimal(5,2)). */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calificacionValida(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Promedio ponderado de los aspectos calificados: Σ(calificación × peso) ÷ Σ peso.
 * Un aspecto sin calificar no cuenta (ni en la suma ni en los pesos), así que una
 * evaluación a medio llenar muestra el promedio de lo que ya tiene.
 * Devuelve null si no hay ningún aspecto calificado con peso positivo.
 */
export function calificacionPonderada(criterios: readonly CriterioPuntuado[]): number | null {
  let suma = 0;
  let pesos = 0;
  for (const c of criterios) {
    if (!calificacionValida(c.calificacion) || !(c.peso > 0)) continue;
    const nota = Math.min(100, Math.max(0, c.calificacion));
    suma += nota * c.peso;
    pesos += c.peso;
  }
  return pesos > 0 ? redondear2(suma / pesos) : null;
}

/** ¿Tiene calificación cada aspecto con peso positivo? */
export function estanTodosCalificados(criterios: readonly CriterioPuntuado[]): boolean {
  const conPeso = criterios.filter((c) => c.peso > 0);
  return conPeso.length > 0 && conPeso.every((c) => calificacionValida(c.calificacion));
}

export interface ResultadoParticipante {
  /** La calificación general que dio el evaluador, si no calificó por aspecto. */
  calificacion: number | null | undefined;
  criterios: readonly CriterioPuntuado[];
}

/**
 * Calificación de una evaluación 360°: cada evaluador vale lo mismo. De cada uno se
 * toma el promedio ponderado de sus aspectos; si no calificó por aspecto, su
 * calificación general. Null si nadie calificó.
 */
export function consolidarParticipantes(participantes: readonly ResultadoParticipante[]): number | null {
  const notas = participantes
    .map((p) => calificacionPonderada(p.criterios) ?? (calificacionValida(p.calificacion) ? p.calificacion : null))
    .filter((n): n is number => n !== null);
  if (notas.length === 0) return null;
  return redondear2(notas.reduce((a, b) => a + b, 0) / notas.length);
}

export interface CriterioDeEvaluador extends CriterioPuntuado {
  competenciaId: string | null;
  criterio: string;
}

/**
 * Criterios consolidados de una evaluación 360°: por aspecto (el del catálogo o, si es
 * libre, su nombre), el promedio de lo que le dio cada evaluador, con el peso que tenía.
 */
export function consolidarCriterios(filas: readonly CriterioDeEvaluador[]): CriterioDeEvaluador[] {
  const grupos = new Map<string, { base: CriterioDeEvaluador; notas: number[] }>();
  for (const f of filas) {
    if (!calificacionValida(f.calificacion)) continue;
    const clave = f.competenciaId ?? `libre:${f.criterio.trim().toLowerCase()}`;
    const g = grupos.get(clave) ?? { base: f, notas: [] };
    g.notas.push(f.calificacion);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map(({ base, notas }) => ({
    competenciaId: base.competenciaId,
    criterio: base.criterio,
    peso: base.peso,
    calificacion: redondear2(notas.reduce((a, b) => a + b, 0) / notas.length),
  }));
}
