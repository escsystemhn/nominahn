/**
 * Política de deducciones por asistencia: llegadas tarde, salidas anticipadas y ausencias.
 *
 * Una sola política para toda la instalación (Edbin, 2026-11-16: «no consideres lo de
 * multiempresa»). Lo que sí cambia según la persona —el séptimo día de la planilla
 * semanal frente a la mensual— va DENTRO de la política, por frecuencia de pago.
 *
 * Se guarda como JSON (clave de ConfiguracionSistema o columna Json) y se valida con
 * `zPoliticaAsistencia` al leerla: un JSON viejo o editado a mano no llega al motor sin
 * pasar por aquí.
 *
 * Base legal, leída del Código del Trabajo (Decreto 189-59, copia de Wikisource con errores
 * de OCR; confirmar contra La Gaceta antes de citarlo en un documento):
 *   · Art. 92, num. 9: «se prohíbe descontar suma alguna del salario de los trabajadores en
 *     concepto de multa». Art. 96, num. 5 y 11, y Art. 94: sólo deducciones y sanciones que
 *     autoricen la ley, el contrato o el reglamento. → Descontar MÁS tiempo del no
 *     trabajado (redondeos hacia arriba, convertir una tardanza en media jornada a quien
 *     trabajó) equivale a una multa: por omisión se TOPA al tiempo real.
 *   · Arts. 321 y 322: jornada diurna 8 h y 44 semanales (equivalentes a 48 de salario),
 *     nocturna 6 h y 36, mixta 7 h y 42. Art. 322: quien no completa las 44 horas cobra «un
 *     salario proporcional al tiempo trabajado» → el sábado corto se descuenta proporcional.
 *   · Art. 338: un día de descanso por cada seis de trabajo. Decreto 112-82, Art. 7 (citado
 *     por fuentes secundarias; el texto oficial no se pudo leer): «el trabajador que no
 *     labore la semana completa sin causa justificada no tiene derecho al pago del séptimo
 *     día». → Sólo la ausencia INJUSTIFICADA toca el séptimo; una por semana como máximo.
 *   · Art. 339: enumera los feriados y dice que el salario por quincena o por mes ya
 *     incluye su pago. NO trata las faltas antes o después de un feriado: esa regla sólo
 *     puede venir del reglamento interno, y el motor la marca como riesgo legal.
 *   · Art. 112 h): faltar dos días completos seguidos, o tres hábiles en un mes, sin causa
 *     justificada, es causa justa de despido. El motor sólo AVISA.
 */

import { z } from "zod";

/** Horas diarias de cada jornada legal (Arts. 321 y 322). */
export const HORAS_JORNADA_LEGAL = { DIURNA: 8, NOCTURNA: 6, MIXTA: 7 } as const;

export type FrecuenciaPago = "SEMANAL" | "QUINCENAL" | "MENSUAL";

// ─── Piezas ──────────────────────────────────────────────────────────────────────

const zTolerancia = z.discriminatedUnion("modo", [
  /** Todo minuto tarde se descuenta. */
  z.object({ modo: z.literal("NINGUNA") }),
  /** Minutos de gracia por evento. Pasados, se descuenta todo o sólo el excedente. */
  z.object({
    modo: z.literal("POR_EVENTO"),
    minutos: z.number().int().min(1).max(120),
    descontarCompletoSiExcede: z.boolean(),
  }),
  /** Bolsa de gracia por período (reglamento interno típico): se gasta evento por evento. */
  z.object({
    modo: z.literal("BOLSA_PERIODO"),
    minutos: z.number().int().min(1).max(600),
    /** Al agotarla: sólo lo que la pasa, o todo lo acumulado en el período. */
    alAgotarse: z.enum(["SOLO_EXCEDENTE", "TOTAL_ACUMULADO"]),
  }),
]);

const zRedondeo = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("MINUTO_EXACTO") }),
  /** Hacia arriba en bloques (15, 30, 60…). Puede pasar del tiempo real: ver `proteccion`. */
  z.object({ modo: z.literal("BLOQUES"), minutos: z.number().int().min(1).max(480) }),
]);

const zReglaTiempo = z.object({ tolerancia: zTolerancia, redondeo: zRedondeo });

const zSeptimo = z.discriminatedUnion("modo", [
  /** Política A: el día faltado más el séptimo completo (uno por semana como máximo). */
  z.object({ modo: z.literal("DIA_COMPLETO") }),
  /** Política B: sólo el día faltado. */
  z.object({ modo: z.literal("NINGUNO") }),
  /** Política C: el día faltado más 1/5 o 1/6 de día por cada falta, hasta un séptimo por semana. */
  z.object({ modo: z.literal("PROPORCIONAL"), diasSemana: z.union([z.literal(5), z.literal(6)]) }),
]);

// ─── Política ────────────────────────────────────────────────────────────────────

export const zPoliticaAsistencia = z.object({
  version: z.literal(1),
  /**
   * Interruptor de llegadas tarde y salidas anticipadas. Apagado (por omisión) sólo se
   * descuentan ausencias, como siempre hizo la planilla (Edbin, 2026-11-16).
   */
  descontarTiempo: z.boolean(),
  /** Divisor del salario mensual para el valor día. */
  divisor: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("TREINTA") }),
    /** Los días del mes en que cae la incidencia: 28, 29, 30 o 31. */
    z.object({ tipo: z.literal("DIAS_REALES") }),
    /** Días laborables efectivos fijos, p. ej. 26 o 22. */
    z.object({ tipo: z.literal("LABORABLES"), dias: z.number().int().min(1).max(31) }),
  ]),
  tardanzas: zReglaTiempo,
  salidasAnticipadas: zReglaTiempo,
  /** Una llegada muy tarde se convierte en ausencia de media jornada o de día completo. */
  umbralAusencia: z.object({
    activo: z.boolean(),
    minutos: z.number().int().min(1).max(720),
    /** Si se le dejó trabajar el resto del día. Si no se le dejó entrar, es ausencia del día. */
    siTrabajo: z.enum(["MEDIA_JORNADA", "DIA_COMPLETO"]),
  }),
  /** Los minutos tarde se compensan 1:1 con tiempo trabajado después de la salida, el mismo día. */
  compensacion: z.object({ activa: z.boolean() }),
  ausencias: z.object({
    septimo: z.object({ SEMANAL: zSeptimo, QUINCENAL: zSeptimo, MENSUAL: zSeptimo }),
    /** Fracción mínima de un día faltado para que cuente para el séptimo (1 = sólo días completos). */
    fraccionMinimaParaSeptimo: z.number().min(0.01).max(1),
    /** Día con menos horas que la jornada (sábado de 4 h en la semana de 44). */
    diaCorto: z.object({
      /** PROPORCIONAL: sus horas (4 de 8 = 0.5 día). DIA_COMPLETO pasa del tiempo real: ver `proteccion`. */
      descuento: z.enum(["PROPORCIONAL", "DIA_COMPLETO"]),
      cuentaParaSeptimo: z.boolean(),
    }),
    /** Falta injustificada el día laboral inmediatamente anterior o posterior a un feriado. */
    feriadoAdyacente: z.enum(["IGNORAR", "ALERTAR", "DESCONTAR_FERIADO"]),
  }),
  proteccion: z.object({
    /**
     * Qué hacer cuando una regla descontaría MÁS que el tiempo no trabajado. TOPAR (por
     * omisión) lo deja en el tiempo real; PERMITIR_CON_ALERTA lo aplica y deja una alerta
     * de riesgo legal (Art. 92, num. 9). Existe para reproducir un reglamento ajeno y
     * medir su exposición, no para usarlo así.
     */
    excesoSobreTiempoReal: z.enum(["TOPAR", "PERMITIR_CON_ALERTA"]),
  }),
});

export type PoliticaAsistencia = z.infer<typeof zPoliticaAsistencia>;
export type ReglaTiempo = PoliticaAsistencia["tardanzas"];
export type ReglaSeptimo = PoliticaAsistencia["ausencias"]["septimo"]["MENSUAL"];

/**
 * Por omisión: lo más conservador. Tardanzas apagadas; si se encienden, 5 minutos de
 * gracia y minuto exacto. El séptimo como hoy lo descuenta la planilla
 * (`FACTOR_DESCUENTO_AUSENCIA = 2`: día + séptimo, uno por semana) y nada que pase del
 * tiempo real.
 */
export const POLITICA_POR_OMISION: PoliticaAsistencia = {
  version: 1,
  descontarTiempo: false,
  divisor: { tipo: "TREINTA" },
  tardanzas: { tolerancia: { modo: "POR_EVENTO", minutos: 5, descontarCompletoSiExcede: false }, redondeo: { modo: "MINUTO_EXACTO" } },
  salidasAnticipadas: { tolerancia: { modo: "NINGUNA" }, redondeo: { modo: "MINUTO_EXACTO" } },
  umbralAusencia: { activo: false, minutos: 120, siTrabajo: "MEDIA_JORNADA" },
  compensacion: { activa: false },
  ausencias: {
    septimo: { SEMANAL: { modo: "DIA_COMPLETO" }, QUINCENAL: { modo: "DIA_COMPLETO" }, MENSUAL: { modo: "DIA_COMPLETO" } },
    fraccionMinimaParaSeptimo: 1,
    diaCorto: { descuento: "PROPORCIONAL", cuentaParaSeptimo: true },
    feriadoAdyacente: "IGNORAR",
  },
  proteccion: { excesoSobreTiempoReal: "TOPAR" },
};

/** Lee una política guardada; un JSON inválido no llega al motor. */
export function leerPolitica(json: unknown): PoliticaAsistencia {
  return zPoliticaAsistencia.parse(json);
}
