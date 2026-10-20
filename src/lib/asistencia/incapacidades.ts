/**
 * Incapacidades temporales del IHSS. PURO.
 *
 * Verificado en fuentes primarias:
 *   · Reglamento de Incapacidad Temporal del IHSS (La Gaceta 35,267, 29 de
 *     mayo de 2020), Art. 71: los tres primeros días los paga el patrono; el
 *     IHSS paga el subsidio desde el cuarto día calendario, hasta 365 días.
 *   · Mismo reglamento, Art. 34: maternidad, 42 días prenatales y 42 posnatales.
 *   · Código del Trabajo, Art. 136: en maternidad el patrono cubre la diferencia
 *     entre el subsidio del IHSS y el salario.
 *
 * NO verificado: el 66 % del subsidio viene del reglamento de aplicación de la
 * Ley del Seguro Social y puede estar desactualizado. Es un valor por omisión,
 * editable, y se usa sólo para el subsidio ESTIMADO que se muestra; no cambia
 * la planilla salvo en maternidad, donde fija el complemento patronal.
 *
 * Efecto en planilla: los días del patrono se pagan normal. Los días del IHSS
 * el patrono no paga salario (el IHSS paga el subsidio directo al trabajador),
 * salvo el complemento que corresponda: se descuenta salario diario × días ×
 * (1 − complemento). Mismo salario diario que las ausencias (mensual / 30).
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

export const REGLAS_POR_OMISION: ReglasIncapacidad = {
  ENFERMEDAD_COMUN: { diasPatrono: 3, porcentajeSubsidio: 66, porcentajeComplemento: 0 },
  ACCIDENTE_COMUN: { diasPatrono: 3, porcentajeSubsidio: 66, porcentajeComplemento: 0 },
  RIESGO_PROFESIONAL: { diasPatrono: 3, porcentajeSubsidio: 66, porcentajeComplemento: 0 },
  // Art. 136 C.T.: el patrono completa hasta el salario.
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
    if (regla.porcentajeSubsidio + regla.porcentajeComplemento > 100.0001) {
      errores.push(`${ETIQUETA_TIPO_INCAPACIDAD[tipo]}: subsidio más complemento no puede pasar de 100 %.`);
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
  porcentajeComplemento: number;
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
 * Lo que el patrono deja de pagar en el período por las incapacidades: por
 * cada una, salario diario × días del IHSS × (1 − complemento).
 */
export function descuentoIncapacidades(salarioMensual: number, incs: IncapacidadParaPlanilla[], desde: Date, hasta: Date): { diasIhss: number; descuento: number } {
  const diario = salarioMensual / 30;
  let diasIhss = 0;
  let descuento = 0;
  for (const inc of incs) {
    const d = diasEnPeriodo(inc, desde, hasta);
    diasIhss += d.ihss;
    descuento += diario * d.ihss * (1 - inc.porcentajeComplemento / 100);
  }
  return { diasIhss, descuento: centavos(descuento) };
}

/** Subsidio que pagaría el IHSS (estimado: el IHSS calcula con su propia base y techo). */
export function subsidioEstimado(salarioMensual: number, diasIhss: number, porcentajeSubsidio: number, techoMensual?: number | null): number {
  const base = techoMensual && techoMensual > 0 ? Math.min(salarioMensual, techoMensual) : salarioMensual;
  return centavos((base / 30) * diasIhss * (porcentajeSubsidio / 100));
}
