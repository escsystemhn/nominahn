/**
 * Jerarquía de reporte: ciclos, ancestros y construcción del organigrama.
 *
 * DOS JERARQUÍAS, NO UNA. Conviene tenerlo presente al leer este módulo:
 *
 *   ESTRUCTURA        Empresa → Sucursal → Departamento → Puesto → Empleado
 *   LÍNEA DE REPORTE  Empleado.supervisorId → Empleado
 *
 * Aquí se trata SÓLO la segunda. Es la que gobierna comportamientos reales del
 * sistema —quién aprueba los permisos de quién, y a quién se añade como
 * `JEFE_DIRECTO` en una evaluación 360°—, así que el organigrama que se dibuja
 * sobre ella no es un diagrama decorativo: es la pantalla donde se ven y se
 * corrigen reglas que ya se ejecutan.
 *
 * POR QUÉ ESTE MÓDULO EXISTE. La única defensa contra ciclos era impedir que
 * alguien fuera su propio jefe. `A → B → A` se aceptaba sin más, y cualquier
 * recorrido hacia arriba entra entonces en bucle infinito. Todas las funciones
 * de aquí son a prueba de ciclos POR CONSTRUCCIÓN —llevan un conjunto de
 * visitados— porque impedir ciclos nuevos no arregla los que ya pudieran estar
 * guardados.
 *
 * Lógica pura, sin Prisma: se prueba sobre árboles sintéticos de cualquier forma.
 */

/** Lo mínimo para razonar sobre la jerarquía: quién es el jefe de quién. */
export type PadreDe = ReadonlyMap<string, string | null>;

/** Un empleado tal como lo necesita el organigrama. */
export interface NodoEmpleado {
  id: string;
  supervisorId: string | null;
}

/**
 * Cadena de mando de un empleado, del jefe directo hacia arriba.
 *
 * Se detiene al llegar a la raíz o al reencontrar a alguien ya visitado, de modo
 * que sobre datos con un ciclo devuelve la parte recorrida en vez de colgarse.
 */
export function cadenaAscendente(padreDe: PadreDe, id: string): string[] {
  const cadena: string[] = [];
  const visitados = new Set<string>([id]);
  let actual = padreDe.get(id) ?? null;

  while (actual && !visitados.has(actual)) {
    cadena.push(actual);
    visitados.add(actual);
    actual = padreDe.get(actual) ?? null;
  }
  return cadena;
}

/**
 * ¿Asignar `nuevoSupervisorId` como jefe de `empleadoId` crearía un ciclo?
 *
 * Se sube desde el supervisor propuesto: si en el camino aparece el propio
 * empleado, la asignación cerraría el lazo. Cubre el caso trivial (ser jefe de
 * uno mismo) y los largos (A → B → C → A), que eran los que pasaban.
 */
export function creariaCiclo(
  padreDe: PadreDe,
  empleadoId: string,
  nuevoSupervisorId: string | null | undefined
): boolean {
  if (!nuevoSupervisorId) return false;
  if (nuevoSupervisorId === empleadoId) return true;

  const visitados = new Set<string>();
  let actual: string | null = nuevoSupervisorId;

  while (actual) {
    if (actual === empleadoId) return true;
    // Un ciclo preexistente entre terceros no debe colgar esta comprobación.
    if (visitados.has(actual)) return false;
    visitados.add(actual);
    actual = padreDe.get(actual) ?? null;
  }
  return false;
}

/**
 * Ciclos ya presentes en los datos, cada uno como la lista de sus integrantes.
 *
 * Sirve para diagnosticar una base que venía de antes de esta comprobación:
 * el organigrama necesita saber qué nodos no puede colgar de ningún sitio.
 */
export function detectarCiclosExistentes(padreDe: PadreDe): string[][] {
  const estado = new Map<string, "recorriendo" | "limpio">();
  const ciclos: string[][] = [];

  for (const inicio of padreDe.keys()) {
    if (estado.has(inicio)) continue;

    const camino: string[] = [];
    const posicion = new Map<string, number>();
    let actual: string | null = inicio;

    while (actual && !estado.has(actual)) {
      if (posicion.has(actual)) {
        // Se cierra un lazo: el ciclo es la cola del camino desde su primera aparición.
        ciclos.push(camino.slice(posicion.get(actual)!));
        break;
      }
      posicion.set(actual, camino.length);
      camino.push(actual);
      actual = padreDe.get(actual) ?? null;
    }

    for (const id of camino) estado.set(id, "limpio");
  }

  return ciclos;
}

// ─── CONSTRUCCIÓN DEL ÁRBOL ──────────────────────────────────────────────────

export interface NodoArbol<T> {
  datos: T;
  hijos: NodoArbol<T>[];
  /** Profundidad desde la raíz del árbol devuelto (0 = raíz). */
  nivel: number;
  /** Subordinados directos. */
  directos: number;
  /** Todos los subordinados, a cualquier profundidad. */
  total: number;
  /**
   * Nodo de CONTEXTO: se dibuja para no dejar a sus descendientes colgando, pero
   * queda fuera del alcance de datos de quien mira y no lleva detalle.
   */
  contexto?: boolean;
}

export interface ResultadoArbol<T> {
  raices: NodoArbol<T>[];
  /** Ids que no se pudieron colgar por formar parte de un ciclo. */
  enCiclo: string[];
  /** Ids cuyo supervisor no está en el conjunto recibido. */
  huerfanos: string[];
}

/**
 * Arma el bosque a partir de una lista plana.
 *
 * BOSQUE Y NO ÁRBOL: una empresa real tiene varias raíces —el gerente general,
 * y todo aquel a quien nadie asignó jefe todavía—. Devolver una sola raíz
 * obligaría a inventar un nodo padre falso o a esconder a los demás.
 *
 * Los nodos que forman parte de un ciclo NO se cuelgan: se listan aparte. Un
 * ciclo no tiene raíz por definición, y colgarlo de cualquier sitio produciría
 * un dibujo que miente sobre la estructura.
 */
export function construirArbol<T extends NodoEmpleado>(
  nodos: readonly T[],
  opciones?: { contexto?: ReadonlySet<string> }
): ResultadoArbol<T> {
  const porId = new Map<string, T>(nodos.map((n) => [n.id, n]));
  const padreDe: PadreDe = new Map(nodos.map((n) => [n.id, n.supervisorId]));

  const enCiclo = new Set(detectarCiclosExistentes(padreDe).flat());
  const huerfanos: string[] = [];

  const construidos = new Map<string, NodoArbol<T>>();
  for (const n of nodos) {
    if (enCiclo.has(n.id)) continue;
    construidos.set(n.id, {
      datos: n,
      hijos: [],
      nivel: 0,
      directos: 0,
      total: 0,
      ...(opciones?.contexto?.has(n.id) ? { contexto: true } : {}),
    });
  }

  const raices: NodoArbol<T>[] = [];
  for (const nodo of construidos.values()) {
    const idPadre = nodo.datos.supervisorId;
    if (!idPadre) {
      raices.push(nodo);
      continue;
    }
    const padre = construidos.get(idPadre);
    if (!padre) {
      // El jefe existe pero quedó fuera del conjunto (alcance, filtro, o borrado).
      if (!porId.has(idPadre)) huerfanos.push(nodo.datos.id);
      raices.push(nodo);
      continue;
    }
    padre.hijos.push(nodo);
  }

  // Niveles y conteos en una sola pasada iterativa. Recursiva sería más corta,
  // pero una jerarquía profunda desbordaría la pila justo en la instalación
  // grande, que es donde menos se puede permitir.
  for (const raiz of raices) asignarNiveles(raiz);
  for (const raiz of raices) contarSubordinados(raiz);

  return { raices, enCiclo: [...enCiclo], huerfanos };
}

function asignarNiveles<T>(raiz: NodoArbol<T>): void {
  const pila: NodoArbol<T>[] = [raiz];
  raiz.nivel = 0;
  while (pila.length) {
    const nodo = pila.pop()!;
    for (const hijo of nodo.hijos) {
      hijo.nivel = nodo.nivel + 1;
      pila.push(hijo);
    }
  }
}

/** Subordinados directos y totales, de abajo hacia arriba. */
function contarSubordinados<T>(raiz: NodoArbol<T>): number {
  const orden: NodoArbol<T>[] = [];
  const pila: NodoArbol<T>[] = [raiz];
  while (pila.length) {
    const nodo = pila.pop()!;
    orden.push(nodo);
    pila.push(...nodo.hijos);
  }
  // En orden inverso, los hijos ya tienen su total calculado.
  for (let i = orden.length - 1; i >= 0; i--) {
    const nodo = orden[i];
    nodo.directos = nodo.hijos.length;
    nodo.total = nodo.hijos.reduce((suma, h) => suma + 1 + h.total, 0);
  }
  return raiz.total;
}

/**
 * Ordena el bosque por un criterio estable, recursivamente.
 * Sin esto el dibujo cambia de orden entre recargas y parece que se movió algo.
 */
export function ordenarArbol<T>(
  raices: NodoArbol<T>[],
  comparar: (a: T, b: T) => number
): NodoArbol<T>[] {
  const pila: NodoArbol<T>[][] = [raices];
  while (pila.length) {
    const nivel = pila.pop()!;
    nivel.sort((a, b) => comparar(a.datos, b.datos));
    for (const nodo of nivel) if (nodo.hijos.length) pila.push(nodo.hijos);
  }
  return raices;
}

/**
 * Ids que hay que añadir al conjunto visible para que ningún nodo quede colgando.
 *
 * EL PROBLEMA QUE RESUELVE: al filtrar por alcance de datos, alguien puede
 * alcanzar a un subordinado pero no a su jefe. El árbol se rompe y el dibujo
 * parece corrupto. Estos ancestros se añaden como nodos de CONTEXTO: se ven el
 * nombre y el puesto para entender de quién cuelga la rama, pero no el detalle,
 * porque el alcance sigue mandando sobre los datos.
 */
export function ancestrosDeContexto(
  padreDe: PadreDe,
  visibles: ReadonlySet<string>
): Set<string> {
  const contexto = new Set<string>();
  for (const id of visibles) {
    for (const ancestro of cadenaAscendente(padreDe, id)) {
      if (!visibles.has(ancestro)) contexto.add(ancestro);
    }
  }
  return contexto;
}
