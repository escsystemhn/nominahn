/**
 * Qué respaldos se conservan en cada destino (2026-11-25, pedido de Edbin): retención
 * tipo GFS — los de los últimos días, uno por semana y uno por mes — y los manuales
 * aparte, para que una tanda de «Respaldar ahora» no borre los automáticos. PURO.
 *
 * Se decide con la fecha y el tipo que lleva el nombre de cada archivo
 * («g360-nomina_2026-11-25_013000_automatico.tar.gz.enc»), sin consultar la base: así
 * vale igual en un disco, una carpeta de red o un bucket. Lo que no se entiende no se
 * borra nunca.
 */

/** Así empiezan los archivos de respaldo: la poda sólo toca los que empiezan así. */
export const PREFIJO_ARCHIVO = "g360-nomina_";

export const esArchivoDeRespaldo = (nombre: string) => nombre.startsWith(PREFIJO_ARCHIVO) && /\.tar\.gz(\.enc)?$/.test(nombre);

export interface RetencionGFS {
  /** Días distintos, los más recientes: el último automático de cada uno. */
  diarios: number;
  /** Semanas distintas (de lunes a domingo): el último automático de cada una. */
  semanales: number;
  /** Meses distintos: el último automático de cada uno. */
  mensuales: number;
  /** Los manuales más recientes, aparte de los automáticos. */
  manuales: number;
}

export const RETENCION_POR_OMISION: RetencionGFS = { diarios: 7, semanales: 4, mensuales: 12, manuales: 5 };

export interface ArchivoFechado {
  nombre: string;
  /** «2026-11-25», en hora de Honduras (la del nombre). */
  dia: string;
  /** Para ordenar: «2026-11-25 013000». */
  orden: string;
  tipo: "automatico" | "manual";
}

/** Fecha y tipo de un respaldo por su nombre; `null` si no tiene la forma esperada. */
export function leerNombre(nombre: string): ArchivoFechado | null {
  if (!esArchivoDeRespaldo(nombre)) return null;
  const m = /_(\d{4}-\d{2}-\d{2})_(\d{4,6})_(automatico|manual)\.tar\.gz(\.enc)?$/.exec(nombre);
  if (!m) return null;
  return { nombre, dia: m[1], orden: `${m[1]} ${m[2].padEnd(6, "0")}`, tipo: m[3] as ArchivoFechado["tipo"] };
}

/** «2026-W48»: la semana de lunes a domingo que contiene ese día. */
function semanaDe(dia: string): string {
  const f = new Date(`${dia}T00:00:00Z`);
  const lunes = new Date(f.getTime() - ((f.getUTCDay() + 6) % 7) * 86_400_000);
  return lunes.toISOString().slice(0, 10);
}

/** De una lista ordenada del más nuevo al más viejo: el primero de cada grupo, en los `n` grupos más recientes. */
function primeroDeCada(lista: readonly ArchivoFechado[], grupo: (a: ArchivoFechado) => string, n: number): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const a of lista) {
    const g = grupo(a);
    if (vistos.has(g)) continue;
    if (vistos.size >= n) break;
    vistos.add(g);
    salida.push(a.nombre);
  }
  return salida;
}

/** Los que se quedan. Siempre el más reciente de todos, aunque la política diga cero. */
export function aConservar(nombres: readonly string[], politica: RetencionGFS): Set<string> {
  const queda = new Set<string>();
  const leidos: ArchivoFechado[] = [];
  for (const n of nombres) {
    if (!esArchivoDeRespaldo(n)) continue;
    const a = leerNombre(n);
    if (a) leidos.push(a);
    else queda.add(n); // con el prefijo pero sin la forma esperada: no se toca
  }
  const masNuevoPrimero = [...leidos].sort((a, b) => b.orden.localeCompare(a.orden));
  const automaticos = masNuevoPrimero.filter((a) => a.tipo === "automatico");
  const manuales = masNuevoPrimero.filter((a) => a.tipo === "manual");
  for (const n of primeroDeCada(automaticos, (a) => a.dia, politica.diarios)) queda.add(n);
  for (const n of primeroDeCada(automaticos, (a) => semanaDe(a.dia), politica.semanales)) queda.add(n);
  for (const n of primeroDeCada(automaticos, (a) => a.dia.slice(0, 7), politica.mensuales)) queda.add(n);
  for (const a of manuales.slice(0, politica.manuales)) queda.add(a.nombre);
  if (masNuevoPrimero[0]) queda.add(masNuevoPrimero[0].nombre);
  return queda;
}

/** Los que sobran, del más viejo al más nuevo. Sólo archivos de respaldo propios. */
export function aPodar(nombres: readonly string[], politica: RetencionGFS): string[] {
  const queda = aConservar(nombres, politica);
  return nombres.filter((n) => esArchivoDeRespaldo(n) && !queda.has(n)).sort();
}
