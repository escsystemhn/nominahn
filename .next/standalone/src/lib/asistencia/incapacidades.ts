/**
 * Incapacidades temporales del IHSS. PURO.
 *
 * Verificado en fuentes primarias:
 *   · Reglamento de Incapacidad Temporal del IHSS (La Gaceta 35,267, 29 de
 *     mayo de 2020), Art. 71: los tres primeros días los paga el patrono; el
 *     IHSS paga el subsidio desde el cuarto día calendario, hasta 365 días.
 *   · Mismo reglamento, Art. 34: maternidad, 42 días prenatales y 42 posnatales.
 *   · Mismo reglamento, Art. 73 (verificado el 2026-11-10): «El Subsidio diario
 *     será igual al sesenta y seis por ciento (66%) del salario base mensual de
 *     referencia, de acuerdo al techo del Régimen que corresponda. El patrono
 *     pagará la diferencia hasta completar el salario total que devenga el
 *     trabajador.» No distingue causas: rige para enfermedad, accidente, riesgo
 *     profesional y maternidad.
 *   · Código del Trabajo, Art. 136: en maternidad el patrono cubre la diferencia
 *     entre el subsidio del IHSS y el salario.
 *
 * Efecto en planilla: los días del patrono se pagan normal. En los días del IHSS
 * se le descuenta al trabajador SÓLO lo que el IHSS le paga directo (el subsidio
 * estimado: 66 % del salario hasta el techo del IHSS, ÷ 30); la diferencia hasta
 * su salario la sigue pagando el patrono. Antes se le descontaba el salario
 * completo de esos días (salvo en maternidad).
 *
 * `porcentajeComplemento` quedó de antes, cuando el complemento era opcional: se
 * guarda por compatibilidad, pero ya no cambia el cálculo.
 */

export type TipoIncapacidad = "ENFERMEDAD_COMUN" | "ACCIDENTE_COMUN" | "RIESGO_PROFESIONAL" | "MATERNIDAD";

export interface ReglaIncapacidad {
  /** Días iniciales a cargo del patrono al 100 %. */
  diasPatrono: number;
  /** % del salario que paga el IHSS desde el día siguiente (estimación). */
  porcentajeSubsidio: number;
  /** % del salario que el patrono sigue pagando en los días del IHSS. */
  porcentajeComplemento: number;
}

export type ReglasIncapacidad = Record<TipoIncapacidad, ReglaIncapacidad>;

// El complemento ya no se configura: el patrono completa siempre la diferencia
// (Art. 73 del reglamento). Se deja 34 % como dato histórico, sin efecto.
export const REGLAS_POR_OMISION: ReglasIncapacidad = {
  ENFERMEDAD_COMUN: { diasPatrono: 3, porcentajeSubsidio: 66, porcentajeComplemento: 34 },
  ACCIDENTE_COMUN: { diasPatrono: 3, porcentajeSubsidio: 66, porcentajeComplemento: 34 },
  RIESGO_PROFESIONAL: { diasPatrono: 3, porcentajeSubsidio: 66, porcentajeComplemento: 34 },
  MATERNIDAD: { diasPatrono: 0, porcentajeSubsidio: 66, porcentajeComplemento: 34 },
};

export const ETIQUETA_TIPO_INCAPACIDAD: Record<TipoIncapacidad, string> = {
  ENFERMEDAD_COMUN: "Enfermedad común",
  ACCIDENTE_COMUN: "Accidente común",
  RIESGO_PROFESIONAL: "Riesgo profesional (accidente o enfermedad de trabajo)",
  MATERNIDAD: "Maternidad",
};

export const DIAS_MATERNIDAD = 84;

const MS_DIA = 86_400_000;

/** Días calendario entre dos fechas de calendario, ambos inclusive. */
export function diasEntre(inicio: Date, fin: Date): number {
  return Math.floor((fin.getTime() - inicio.getTime()) / MS_DIA) + 1;
}

export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * MS_DIA);
}

/** Lee reglas guardadas (JSON) sobre las de omisión; descarta valores fuera de rango. */
export function normalizarReglas(guardadas: unknown): ReglasIncapacidad {
  const out: ReglasIncapacidad = JSON.parse(JSON.stringify(REGLAS_POR_OMISION));
  if (!guardadas || typeof guardadas !== "object") return out;
  for (const tipo of Object.keys(out) as TipoIncapacidad[]) {
    const g = (guardadas as Record<string, Partial<ReglaIncapacidad>>)[tipo];
    if (!g) continue;
    if (Number.isInteger(g.diasPatrono) && (g.diasPatrono as number) >= 0 && (g.diasPatrono as number) <= 30) out[tipo].diasPatrono = g.diasPatrono as number;
    if (typeof g.porcentajeSubsidio === "number" && g.porcentajeSubsidio >= 0 && g.porcentajeSubsidio <= 100) out[tipo].porcentajeSubsidio = g.porcentajeSubsidio;
    if (typeof g.porcentajeComplemento === "number" && g.porcentajeComplemento >= 0 && g.porcentajeComplemento <= 100) out[tipo].porcentajeComplemento = g.porcentajeComplemento;
  }
  return out;
}

export function validarReglas(r: ReglasIncapacidad): string[] {
  const errores: string[] = [];
  for (const [tipo, regla] of Object.entries(r) as [TipoIncapacidad, ReglaIncapacidad][]) {
    if (regla.porcentajeSubsidio > 100.0001) {
      errores.push(`${ETIQUETA_TIPO_INCAPACIDAD[tipo]}: el subsidio no puede pasar de 100 %.`);
    }
  }
  return errores;
}

/**
 * Días a cargo del patrono para una incapacidad nueva. Una prórroga no
 * reinicia el conteo: descuenta lo que la cadena ya consumió.
 */
export function diasPatronoParaNueva(regla: ReglaIncapacidad, diasPatronoYaConsumidos: number): number {
  return Math.max(0, regla.diasPatrono - Math.max(0, diasPatronoYaConsumidos));
}

export interface IncapacidadParaPlanilla {
  fechaInicio: Date;
  fechaFin: Date;
  /** Días iniciales de ESTA incapacidad a cargo del patrono. */
  diasPatrono: number;
  /** % del salario de referencia (con techo) que paga el IHSS: lo único que se descuenta. */
  porcentajeSubsidio: number;
}

/** Cuántos días de una incapacidad caen en un período, y de quién son. */
export function diasEnPeriodo(inc: IncapacidadParaPlanilla, desde: Date, hasta: Date): { patrono: number; ihss: number } {
  const ini = Math.max(inc.fechaInicio.getTime(), desde.getTime());
  const fin = Math.min(inc.fechaFin.getTime(), hasta.getTime());
  if (fin < ini) return { patrono: 0, ihss: 0 };
  // Último día del patrono dentro de la incapacidad.
  const finPatrono = inc.diasPatrono > 0 ? sumarDias(inc.fechaInicio, inc.diasPatrono - 1).getTime() : inc.fechaInicio.getTime() - MS_DIA;
  const patronoFin = Math.min(fin, finPatrono);
  const patrono = patronoFin >= ini ? Math.floor((patronoFin - ini) / MS_DIA) + 1 : 0;
  const total = Math.floor((fin - ini) / MS_DIA) + 1;
  return { patrono, ihss: total - patrono };
}

/** Fechas (milisegundos) que cubre una incapacidad dentro de un período: no son ausencias. */
export function fechasCubiertas(inc: Pick<IncapacidadParaPlanilla, "fechaInicio" | "fechaFin">, desde: Date, hasta: Date): number[] {
  const out: number[] = [];
  const ini = Math.max(inc.fechaInicio.getTime(), desde.getTime());
  const fin = Math.min(inc.fechaFin.getTime(), hasta.getTime());
  for (let t = ini; t <= fin; t += MS_DIA) out.push(t);
  return out;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Lo que el patrono deja de pagar en el período por las incapacidades: lo que el
 * IHSS le paga directo al trabajador por los días a su cargo (el subsidio
 * estimado, nunca más que el salario de esos días). El resto lo paga el patrono
 * (Art. 73 del Reglamento de Incapacidad Temporal).
 *
 * `techoMensual`: techo del régimen de Enfermedad y Maternidad del IHSS.
 */
export function descuentoIncapacidades(
  salarioMensual: number,
  incs: IncapacidadParaPlanilla[],
  desde: Date,
  hasta: Date,
  techoMensual?: number | null
): { diasIhss: number; descuento: number } {
  const diario = salarioMensual / 30;
  let diasIhss = 0;
  let descuento = 0;
  for (const inc of incs) {
    const d = diasEnPeriodo(inc, desde, hasta);
    diasIhss += d.ihss;
    descuento += Math.min(diario * d.ihss, subsidioEstimado(salarioMensual, d.ihss, inc.porcentajeSubsidio, techoMensual));
  }
  return { diasIhss, descuento: centavos(descuento) };
}

/** Subsidio que pagaría el IHSS (estimado: el IHSS calcula con su propia base y techo). */
export function subsidioEstimado(salarioMensual: number, diasIhss: number, porcentajeSubsidio: number, techoMensual?: number | null): number {
  const base = techoMensual && techoMensual > 0 ? Math.min(salarioMensual, techoMensual) : salarioMensual;
  return centavos((base / 30) * diasIhss * (porcentajeSubsidio / 100));
}
