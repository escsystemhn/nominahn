/**
 * Orden de una lista por la URL: `?orden=campo&dir=desc`. Va en la URL y no en el
 * estado de la pantalla para que sobreviva al recargar y se pueda compartir el enlace.
 */

export type Direccion = "asc" | "desc";

export interface Orden<C extends string = string> {
  campo: C;
  dir: Direccion;
}

/** Lo que pida la URL, si es una columna permitida; si no, el orden de siempre. */
export function leerOrden<C extends string>(
  sp: { orden?: string; dir?: string },
  permitidos: readonly C[],
  porOmision: Orden<C>
): Orden<C> {
  const campo = permitidos.find((c) => c === sp.orden);
  if (!campo) return porOmision;
  return { campo, dir: sp.dir === "desc" ? "desc" : "asc" };
}

/**
 * El orden que produce pulsar una columna. La primera vez usa `dirInicial` (lo
 * natural para montos y fechas es de mayor a menor); la segunda, la invierte.
 */
export function ordenAlPulsar<C extends string>(actual: Orden<C>, campo: C, dirInicial: Direccion = "asc"): Orden<C> {
  if (actual.campo !== campo) return { campo, dir: dirInicial };
  return { campo, dir: actual.dir === "asc" ? "desc" : "asc" };
}
