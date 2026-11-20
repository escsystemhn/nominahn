/**
 * Buscar como la gente escribe: sin tildes y en cualquier orden. «mejia ana» debe
 * encontrar a «Ana Lucía Mejía». Sirve en el navegador y en el servidor.
 */

/** Más palabras que esto no afinan la búsqueda: sólo hacen más larga la consulta. */
const MAX_PALABRAS = 6;

export function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function palabrasDeBusqueda(texto: string): string[] {
  return sinAcentos(texto).split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS);
}

/** ¿Aparecen todas las palabras en el texto? */
export function coincide(texto: string, palabras: string[]): boolean {
  const limpio = sinAcentos(texto);
  return palabras.every((p) => limpio.includes(p));
}

export interface Tramo {
  texto: string;
  /** Es parte de lo que se buscó. */
  marca: boolean;
}

/**
 * El texto partido en tramos para resaltar lo buscado, sin importar tildes ni mayúsculas:
 * buscar «mejia» marca «Mejía» tal como está escrito. Se compara letra por letra, así que
 * las posiciones del texto limpio son las del original.
 */
export function tramosResaltados(texto: string, palabras: string[]): Tramo[] {
  if (!texto) return [];
  const limpio = Array.from(texto, (c) => sinAcentos(c).charAt(0) || c).join("");
  const marcado = new Array<boolean>(texto.length).fill(false);
  for (const p of palabras) {
    if (!p) continue;
    for (let i = limpio.indexOf(p); i >= 0; i = limpio.indexOf(p, i + 1)) {
      for (let j = i; j < i + p.length && j < marcado.length; j++) marcado[j] = true;
    }
  }
  const tramos: Tramo[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.marca === marcado[i]) ultimo.texto += texto[i];
    else tramos.push({ texto: texto[i], marca: marcado[i] });
  }
  return tramos;
}
