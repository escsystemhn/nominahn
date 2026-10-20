/**
 * Validación de las tablas por tramos que el administrador edita en
 * Configuración → Parámetros de ley: ISR (SAR) e impuesto vecinal (municipio).
 *
 * Una tabla mal armada no da error: da un impuesto equivocado en silencio. Un
 * hueco entre tramos deja una porción del ingreso sin tributar; un solape la
 * cobra dos veces; un último tramo con techo deja sin tramo a los salarios más
 * altos. Por eso se rechaza al guardar, no al calcular la planilla.
 *
 * Puro: sin base de datos, para poder probarlo.
 */

export interface TramoISREditable {
  desde: number;
  hasta: number | null;
  cuotaFija: number;
  /** Fracción: 0.15 = 15 %. */
  porcentaje: number;
  excedenteDesde: number;
}

export interface TramoVecinalEditable {
  desde: number;
  hasta: number | null;
  porMillar: number;
}

/**
 * Tolerancia entre el `hasta` de un tramo y el `desde` del siguiente en la
 * tabla ISR. El SAR publica los tramos con un centavo de separación
 * (228,324.32 → 228,324.33); también se acepta que coincidan.
 */
const SALTO_MAXIMO_ISR = 0.01;

const MAX_TRAMOS = 30;

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/** Errores comunes a ambas tablas: orden, techos y último tramo abierto. */
function erroresDeForma(tramos: Array<{ desde: number; hasta: number | null }>): string[] {
  const errores: string[] = [];
  if (tramos.length === 0) return ["La tabla necesita al menos un tramo."];
  if (tramos.length > MAX_TRAMOS) errores.push(`La tabla admite hasta ${MAX_TRAMOS} tramos.`);

  if (tramos[0].desde !== 0) errores.push("El primer tramo debe empezar en 0.");

  tramos.forEach((t, i) => {
    const n = i + 1;
    const ultimo = i === tramos.length - 1;
    if (!Number.isFinite(t.desde) || t.desde < 0) errores.push(`Tramo ${n}: «desde» inválido.`);
    if (ultimo) {
      if (t.hasta !== null) errores.push(`Tramo ${n}: el último tramo no lleva «hasta» (queda abierto hacia arriba).`);
    } else if (t.hasta === null) {
      errores.push(`Tramo ${n}: sólo el último tramo puede quedar sin «hasta».`);
    } else if (!Number.isFinite(t.hasta) || t.hasta <= t.desde) {
      errores.push(`Tramo ${n}: «hasta» debe ser mayor que «desde».`);
    }
  });
  return errores;
}

export function validarTramosISR(tramos: TramoISREditable[]): string[] {
  const errores = erroresDeForma(tramos);

  tramos.forEach((t, i) => {
    const n = i + 1;
    if (!Number.isFinite(t.porcentaje) || t.porcentaje < 0 || t.porcentaje > 1) {
      errores.push(`Tramo ${n}: el porcentaje debe estar entre 0 y 100.`);
    }
    if (!Number.isFinite(t.cuotaFija) || t.cuotaFija < 0) errores.push(`Tramo ${n}: cuota fija inválida.`);
    if (!Number.isFinite(t.excedenteDesde) || t.excedenteDesde < 0) {
      errores.push(`Tramo ${n}: «excedente desde» inválido.`);
    } else if (t.excedenteDesde > t.desde) {
      // El excedente se mide desde el techo del tramo anterior; si fuera mayor
      // que el inicio del tramo, la parte baja del tramo no pagaría nada.
      errores.push(`Tramo ${n}: «excedente desde» no puede ser mayor que «desde».`);
    }

    const sig = tramos[i + 1];
    if (sig && t.hasta !== null) {
      const salto = redondear2(sig.desde - t.hasta);
      if (salto < 0) errores.push(`Tramos ${n} y ${n + 1} se solapan.`);
      else if (salto > SALTO_MAXIMO_ISR) errores.push(`Hay un hueco entre los tramos ${n} y ${n + 1}.`);
    }
  });
  return errores;
}

export function validarTramosVecinal(tramos: TramoVecinalEditable[]): string[] {
  const errores = erroresDeForma(tramos);

  tramos.forEach((t, i) => {
    const n = i + 1;
    if (!Number.isFinite(t.porMillar) || t.porMillar < 0 || t.porMillar > 1000) {
      errores.push(`Tramo ${n}: la tarifa por millar debe estar entre 0 y 1000.`);
    }
    // El vecinal suma porción por porción del ingreso, en (desde, hasta]: el
    // siguiente tramo tiene que empezar EXACTAMENTE donde termina éste.
    const sig = tramos[i + 1];
    if (sig && t.hasta !== null) {
      const salto = redondear2(sig.desde - t.hasta);
      if (salto < 0) errores.push(`Tramos ${n} y ${n + 1} se solapan.`);
      else if (salto > 0) errores.push(`El tramo ${n + 1} debe empezar donde termina el ${n} (${t.hasta}).`);
    }
  });
  return errores;
}

/**
 * Cuota fija y «excedente desde» que corresponden a cada tramo de la tabla ISR,
 * calculados a partir de los tramos y porcentajes: la cuota fija de un tramo es
 * el impuesto acumulado de los tramos anteriores completos.
 *
 * Reproduce la tabla publicada por el SAR (p. ej. 2026: 17,974.47 y 110,275.80),
 * así que el administrador sólo tiene que teclear rangos y porcentajes.
 */
export function derivarCuotasISR(
  tramos: Array<{ desde: number; hasta: number | null; porcentaje: number }>
): TramoISREditable[] {
  const salida: TramoISREditable[] = [];
  let cuota = 0;
  tramos.forEach((t, i) => {
    const anterior = salida[i - 1];
    const excedenteDesde = anterior ? (tramos[i - 1].hasta ?? t.desde) : 0;
    if (anterior && tramos[i - 1].hasta !== null) {
      cuota = redondear2(cuota + (tramos[i - 1].hasta! - anterior.excedenteDesde) * tramos[i - 1].porcentaje);
    }
    salida.push({ desde: t.desde, hasta: t.hasta, porcentaje: t.porcentaje, excedenteDesde, cuotaFija: cuota });
  });
  return salida;
}
