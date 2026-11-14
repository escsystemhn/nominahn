/**
 * Evaluación de 30 días de la edición instalable.
 *
 * QUÉ CUENTA COMO UN DÍA. Se cuentan días de calendario en hora de Honduras, no
 * bloques de 24 horas desde la instalación: quien instala un lunes a las 4 p. m.
 * tiene el lunes como día 1, y el día 30 termina a la medianoche. Contar bloques
 * de 24 horas haría que la evaluación venciera a media tarde, en mitad de una
 * planilla, a una hora que nadie sabría predecir.
 *
 *   día 1 ............ el de la instalación
 *   días 1 a 24 ...... sin aviso: un banner presente desde el primer día se vuelve
 *                      parte del decorado y deja de leerse justo cuando importa
 *   días 25 a 30 ..... aviso en todas las pantallas con los días que faltan
 *   día 31 ........... la aplicación se bloquea hasta activar una licencia
 *
 * EL RELOJ NO SE PUEDE ATRASAR. Se guarda la mayor fecha vista y se compara con
 * `max(ahora, mayorVisto)`: atrasar el reloj del servidor no devuelve días.
 *
 * Honduras está en UTC−6 todo el año y no aplica horario de verano, así que el
 * desfase es una constante y el cálculo no depende de la variable TZ del proceso.
 */

export const DIAS_EVALUACION = 30;
/** Primer día en que se muestra el aviso de los días que faltan. */
export const DIA_INICIO_AVISO = 25;

const MS_DIA = 86_400_000;
const DESFASE_HN_MS = -6 * 3_600_000;

/** Medianoche de Honduras del día que contiene `instanteMs`, como instante UTC. */
export function inicioDelDiaHN(instanteMs: number): number {
  const local = instanteMs + DESFASE_HN_MS;
  return Math.floor(local / MS_DIA) * MS_DIA - DESFASE_HN_MS;
}

export interface Evaluacion {
  /** 1 = día de la instalación. Nunca menor que 1. */
  dia: number;
  /** Días que faltan contando hoy: 6 el día 25, 1 el día 30, 0 cuando venció. */
  diasRestantes: number;
  /** Medianoche (hora de Honduras) con la que empieza el día 30. */
  ultimoDia: Date;
  /** Instante en que la evaluación deja de valer: la medianoche que cierra el día 30. */
  venceEn: Date;
  vencida: boolean;
  mostrarAviso: boolean;
}

export function calcularEvaluacion(inicio: Date, ahora: Date, mayorVisto?: Date | null): Evaluacion {
  const efectivo = Math.max(ahora.getTime(), mayorVisto?.getTime() ?? 0);
  const primerDia = inicioDelDiaHN(inicio.getTime());
  const dia = Math.max(1, Math.floor((inicioDelDiaHN(efectivo) - primerDia) / MS_DIA) + 1);
  const venceEn = primerDia + DIAS_EVALUACION * MS_DIA;
  const vencida = efectivo >= venceEn;

  return {
    dia,
    diasRestantes: vencida ? 0 : DIAS_EVALUACION - dia + 1,
    ultimoDia: new Date(venceEn - MS_DIA),
    venceEn: new Date(venceEn),
    vencida,
    mostrarAviso: !vencida && dia >= DIA_INICIO_AVISO,
  };
}

const FECHA_LARGA = new Intl.DateTimeFormat("es-HN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Tegucigalpa",
});

/** «el lunes 17 de noviembre» */
export function fechaLarga(fecha: Date): string {
  return `el ${FECHA_LARGA.format(fecha).replace(",", "")}`;
}

const FECHA_CON_ANIO = new Intl.DateTimeFormat("es-HN", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Tegucigalpa",
});

/**
 * Último día en que algo sigue valiendo, a partir del INSTANTE en que deja de
 * valer. SDL fija `expires_at` en la medianoche que cierra el último día (hora de
 * Honduras): 2027-10-19T06:00Z vale todo el 18. Mostrar el 19 regalaría un día.
 */
export function ultimoDiaValido(instanteFinIso: string): string {
  return FECHA_CON_ANIO.format(new Date(Date.parse(instanteFinIso) - 1));
}

export function fechaConAnio(iso: string): string {
  return FECHA_CON_ANIO.format(new Date(iso));
}

/** Texto del aviso. Lleva la fecha además de la cuenta para que nadie tenga que adivinar si «hoy» cuenta. */
export function textoAviso(ev: Evaluacion): string {
  if (ev.vencida) return "La evaluación terminó.";
  if (ev.diasRestantes === 1) return "Hoy es el último día de la evaluación.";
  return `Quedan ${ev.diasRestantes} días de evaluación: el último es ${fechaLarga(ev.ultimoDia)}.`;
}
