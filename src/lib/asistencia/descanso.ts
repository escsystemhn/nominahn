/**
 * El almuerzo no es tiempo de trabajo.
 *
 * Regla de la empresa, confirmada por Edbin. Sin ella, el lapso entre la primera
 * y la última marca se pagaba entero, y el horario por defecto del sistema
 * (08:00–17:00 con jornada de 8 h) generaba una hora extra diaria a cada persona.
 *
 * Cómo se determina cuánto descontar, de más a menos exacto:
 *
 *   1. MARCADO — la persona marcó salida y regreso del almuerzo (4 marcas, o 6
 *      si hubo dos pausas). Se descuenta el hueco real entre ellas.
 *   2. FIJO — no marcó el almuerzo, o marcó un número impar de veces y no hay
 *      forma de emparejar las marcas. Se descuenta la duración fija del turno,
 *      siempre que el lapso sea lo bastante largo como para que lo hubiera.
 *   3. NINGUNO — jornada corta (medio día): no se asume almuerzo.
 *
 * Es lógica pura, sin base de datos, por la misma razón que `calculos-hn.ts`:
 * decide cuántas horas se pagan y tiene que poder probarse aislada.
 */

import type { MarcaMinima } from "./extremos";

export interface ReglaDescanso {
  /** Minutos que se descuentan cuando nadie marcó el almuerzo. */
  almuerzoMinutos: number;
  /** A partir de cuántas horas de lapso se asume que hubo almuerzo. */
  almuerzoDesdeHoras: number;
}

export type OrigenDescanso = "MARCADO" | "FIJO" | "NINGUNO";

export interface Descanso {
  minutos: number;
  origen: OrigenDescanso;
  /** Algo que un supervisor debería revisar, o `null`. */
  aviso: string | null;
}

/**
 * Dos marcas separadas por menos de esto son la misma.
 *
 * Los relojes reales duplican: la persona pone el dedo, no oye el pitido y lo
 * vuelve a poner. Una marca repetida rompe el emparejamiento entrada/salida —
 * cinco marcas en vez de cuatro— y dejaría el almuerzo sin descontar.
 */
export const SEGUNDOS_DUPLICADO = 120;

/** Quita las marcas repetidas en ráfaga, conservando la primera de cada una. */
export function depurarDuplicados<T extends MarcaMinima>(
  marcas: T[],
  segundos: number = SEGUNDOS_DUPLICADO
): T[] {
  const orden = [...marcas].sort((a, b) => a.ocurridoEn.getTime() - b.ocurridoEn.getTime());
  const out: T[] = [];
  for (const m of orden) {
    const previa = out[out.length - 1];
    if (previa && m.ocurridoEn.getTime() - previa.ocurridoEn.getTime() < segundos * 1000) continue;
    out.push(m);
  }
  return out;
}

const minutosEntre = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

/**
 * Pausas marcadas entre la entrada y la salida, en minutos, o `null` si las
 * marcas no permiten saberlo.
 *
 * Sin etiquetas (lo normal en ZKTeco) se emparejan en orden: tras la entrada,
 * cada marca intermedia impar es una salida y la siguiente, su regreso. Con
 * etiquetas (Hikvision en algunos modelos) manda lo que diga el equipo: cada
 * SALIDA intermedia se cierra con la ENTRADA que la sigue.
 */
function pausasMarcadas(interiores: MarcaMinima[]): number | null {
  if (interiores.length === 0) return 0;

  const etiquetadas = interiores.every((m) => m.tipo !== "DESCONOCIDO");
  if (etiquetadas) {
    let total = 0;
    for (let i = 0; i < interiores.length; i++) {
      if (interiores[i].tipo !== "SALIDA") continue;
      const regreso = interiores.slice(i + 1).find((m) => m.tipo === "ENTRADA");
      if (!regreso) return null; // salió y no consta el regreso
      total += minutosEntre(interiores[i].ocurridoEn, regreso.ocurridoEn);
    }
    return total;
  }

  // Sin etiquetas, un número impar de marcas intermedias no se puede emparejar.
  if (interiores.length % 2 !== 0) return null;
  let total = 0;
  for (let i = 0; i < interiores.length; i += 2) {
    total += minutosEntre(interiores[i].ocurridoEn, interiores[i + 1].ocurridoEn);
  }
  return total;
}

export function resolverDescanso(opts: {
  entrada: Date;
  salida: Date;
  regla: ReglaDescanso;
  /** Todas las marcas del día. Sin ellas (carga manual) se aplica la regla fija. */
  marcas?: MarcaMinima[];
}): Descanso {
  const { entrada, salida, regla, marcas } = opts;
  const lapsoMin = minutosEntre(entrada, salida);
  if (lapsoMin <= 0) return { minutos: 0, origen: "NINGUNO", aviso: null };

  const fijo = (): Descanso =>
    lapsoMin >= regla.almuerzoDesdeHoras * 60
      ? { minutos: regla.almuerzoMinutos, origen: "FIJO", aviso: null }
      : { minutos: 0, origen: "NINGUNO", aviso: null };

  if (marcas && marcas.length > 0) {
    // Intermedias son las que caen ENTRE la entrada y la salida con margen: una
    // marca a 40 s de la salida es la salida repetida, no el regreso de nadie.
    const margen = SEGUNDOS_DUPLICADO * 1000;
    const interiores = depurarDuplicados(marcas).filter(
      (m) =>
        m.ocurridoEn.getTime() - entrada.getTime() >= margen &&
        salida.getTime() - m.ocurridoEn.getTime() >= margen
    );

    if (interiores.length > 0) {
      const marcado = pausasMarcadas(interiores);
      if (marcado === null) {
        // No se puede saber cuánto duró la pausa: se aplica la fija, pero el día
        // queda señalado para que alguien lo mire.
        const f = fijo();
        return {
          ...f,
          aviso:
            "Marcas del almuerzo incompletas: se descontó el almuerzo fijo del turno. Requiere revisión.",
        };
      }
      return { minutos: Math.round(marcado), origen: "MARCADO", aviso: null };
    }
  }

  return fijo();
}
