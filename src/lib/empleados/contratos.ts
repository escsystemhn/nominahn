/**
 * Historial de contratos de un empleado: las reglas, sin base de datos.
 *
 * Un empleado tiene a lo sumo un contrato vigente. Registrar uno nuevo (renovación,
 * cambio de tipo o de condiciones) cierra el anterior y lo deja en el historial,
 * en vez de sobrescribir los datos como pasaba al editar la ficha.
 *
 * No se admiten fechas futuras porque el contrato nuevo actualiza en el acto el
 * salario y el tipo de la ficha: uno que aún no empieza pagaría de más desde hoy.
 */

/** Por su naturaleza terminan en una fecha. */
const TIPOS_CON_FIN = new Set(["TEMPORAL", "PRUEBA"]);

const MS_DIA = 24 * 60 * 60 * 1000;

export type SituacionContrato = "VIGENTE" | "VENCIDO" | "TERMINADO";

/** Reglas de la fecha de fin, también al editar el contrato vigente. */
export function motivoFinInvalido(tipo: string, inicio: Date, fin: Date | null): string | null {
  if (TIPOS_CON_FIN.has(tipo) && !fin) return "Este tipo de contrato necesita fecha de fin.";
  if (tipo === "INDEFINIDO" && fin) return "Un contrato por tiempo indefinido no lleva fecha de fin.";
  if (fin && fin <= inicio) return "La fecha de fin debe ser posterior a la de inicio.";
  return null;
}

export function motivoContratoInvalido(c: {
  tipo: string;
  fechaInicio: Date;
  fechaFin: Date | null;
  fechaIngreso: Date;
  hoy: Date;
  /** Inicio del contrato más reciente; el nuevo debe empezar después. */
  ultimoInicio: Date | null;
  /** Fin del más reciente si ya está cerrado: tras una reincorporación no deben solaparse. */
  ultimoFinCerrado?: Date | null;
}): string | null {
  if (c.fechaInicio > c.hoy) return "Registre el contrato el día que empieza: al guardarlo cambia el salario y el tipo de la ficha.";
  if (c.fechaInicio < c.fechaIngreso) return "El contrato no puede empezar antes de la fecha de ingreso.";
  if (c.ultimoInicio && c.fechaInicio <= c.ultimoInicio) return "Debe empezar después del inicio del contrato anterior.";
  if (c.ultimoFinCerrado && c.fechaInicio <= c.ultimoFinCerrado) return "Debe empezar después de la fecha en que terminó el contrato anterior.";
  return motivoFinInvalido(c.tipo, c.fechaInicio, c.fechaFin);
}

/**
 * Cuándo termina el contrato que se reemplaza: el día anterior al nuevo, salvo
 * que ya hubiera terminado antes, y entonces conserva su fecha.
 */
export function finDelAnterior(anterior: { fechaFin: Date | null }, nuevoInicio: Date): Date {
  const diaAnterior = new Date(nuevoInicio.getTime() - MS_DIA);
  return anterior.fechaFin && anterior.fechaFin < diaAnterior ? anterior.fechaFin : diaAnterior;
}

/** Un contrato temporal que llegó a su fin sigue marcado activo hasta que alguien decida: se avisa como vencido. */
export function situacionContrato(c: { activo: boolean; fechaFin: Date | string | null }, hoy: Date): SituacionContrato {
  if (!c.activo) return "TERMINADO";
  return c.fechaFin && new Date(c.fechaFin) < hoy ? "VENCIDO" : "VIGENTE";
}
