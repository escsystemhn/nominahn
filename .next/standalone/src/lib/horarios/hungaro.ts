/**
 * Asignación de costo mínimo (algoritmo húngaro, O(n³)) sobre una matriz
 * cuadrada. Devuelve, para cada fila, la columna asignada. PURO.
 *
 * Se usa para repartir los turnos del día entre las personas disponibles: las
 * filas son personas, las columnas turnos, y el costo mide cuánto se aparta cada
 * opción de la política de rotación (un costo muy alto = no puede hacerlo).
 */
export function asignacionMinima(costo: number[][]): number[] {
  const n = costo.length;
  if (n === 0) return [];
  const INF = Number.MAX_SAFE_INTEGER;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const camino = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const usado = new Array<boolean>(n + 1).fill(false);
    do {
      usado[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (usado[j]) continue;
        const cur = costo[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          camino[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (usado[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = camino[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const resultado = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) resultado[p[j] - 1] = j - 1;
  return resultado;
}
