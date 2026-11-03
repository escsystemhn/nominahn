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
