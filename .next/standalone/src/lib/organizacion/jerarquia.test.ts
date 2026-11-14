import { describe, it, expect } from "vitest";
import {
  creariaCiclo,
  cadenaAscendente,
  detectarCiclosExistentes,
  construirArbol,
  ordenarArbol,
  ancestrosDeContexto,
  type PadreDe,
} from "./jerarquia";

/** `{"b": "a"}` se lee «b reporta a a». `null` = sin jefe. */
const jerarquia = (pares: Record<string, string | null>): PadreDe => new Map(Object.entries(pares));

/** Empleados planos con el mínimo que necesita el árbol. */
const emp = (id: string, supervisorId: string | null, extra: { nombre?: string } = {}) => ({
  id,
  supervisorId,
  nombre: extra.nombre ?? id,
});

describe("creariaCiclo", () => {
  // ORGANIGRAMA:  ana → luis → marta
  const ORG = jerarquia({ ana: null, luis: "ana", marta: "luis" });

  it("acepta una asignación que no cierra ningún lazo", () => {
    expect(creariaCiclo(ORG, "pedro", "marta")).toBe(false);
  });

  it("quitar el jefe nunca crea un ciclo", () => {
    expect(creariaCiclo(ORG, "marta", null)).toBe(false);
    expect(creariaCiclo(ORG, "marta", undefined)).toBe(false);
  });

  it("impide ser jefe de uno mismo", () => {
    expect(creariaCiclo(ORG, "luis", "luis")).toBe(true);
  });

  /**
   * EL CASO QUE PASABA. La única defensa era `supervisorId === id`, así que
   * poner a Ana bajo Luis —que ya cuelga de ella— se aceptaba, y el recorrido
   * hacia arriba dejaba de terminar.
   */
  it("impide el ciclo de dos: A → B → A", () => {
    expect(creariaCiclo(ORG, "ana", "luis")).toBe(true);
  });

  it("impide un ciclo largo: A → B → C → A", () => {
    expect(creariaCiclo(ORG, "ana", "marta")).toBe(true);
  });

  it("da igual la profundidad de la cadena", () => {
    const larga = jerarquia({ n0: null, n1: "n0", n2: "n1", n3: "n2", n4: "n3", n5: "n4" });
    expect(creariaCiclo(larga, "n0", "n5")).toBe(true);
    expect(creariaCiclo(larga, "n3", "n5")).toBe(true);
    expect(creariaCiclo(larga, "n5", "n3")).toBe(false); // ya cuelga de ahí: no es un lazo
  });

  /**
   * Impedir ciclos NUEVOS no arregla los ya guardados. Si la comprobación se
   * colgara ante uno preexistente entre terceros, la pantalla de empleados
   * quedaría inservible justo en la base que hay que reparar.
   */
  it("no se cuelga si ya hay un ciclo entre terceros", () => {
    const corrupta = jerarquia({ x: "y", y: "x", nuevo: null });
    expect(creariaCiclo(corrupta, "nuevo", "x")).toBe(false);
  });

  it("un jefe que no existe en el mapa se trata como raíz", () => {
    expect(creariaCiclo(ORG, "pedro", "fantasma")).toBe(false);
  });
});

describe("cadenaAscendente", () => {
  const ORG = jerarquia({ ana: null, luis: "ana", marta: "luis" });

  it("devuelve la cadena de mando, del jefe directo hacia arriba", () => {
    expect(cadenaAscendente(ORG, "marta")).toEqual(["luis", "ana"]);
    expect(cadenaAscendente(ORG, "luis")).toEqual(["ana"]);
    expect(cadenaAscendente(ORG, "ana")).toEqual([]);
  });

  it("sobre datos con ciclo devuelve lo recorrido, sin colgarse", () => {
    const corrupta = jerarquia({ x: "y", y: "z", z: "x" });
    const cadena = cadenaAscendente(corrupta, "x");
    expect(cadena).toEqual(["y", "z"]);
    expect(new Set(cadena).size).toBe(cadena.length); // sin repeticiones
  });
});

describe("detectarCiclosExistentes", () => {
  it("no ve ciclos donde no los hay", () => {
    expect(detectarCiclosExistentes(jerarquia({ a: null, b: "a", c: "a" }))).toEqual([]);
  });

  it("encuentra un ciclo de dos", () => {
    const ciclos = detectarCiclosExistentes(jerarquia({ x: "y", y: "x" }));
    expect(ciclos).toHaveLength(1);
    expect(new Set(ciclos[0])).toEqual(new Set(["x", "y"]));
  });

  it("encuentra un ciclo largo sin arrastrar a quien cuelga de él", () => {
    // p → a, y a → b → c → a es el lazo. `p` NO forma parte del ciclo.
    const ciclos = detectarCiclosExistentes(jerarquia({ a: "b", b: "c", c: "a", p: "a" }));
    expect(ciclos).toHaveLength(1);
    expect(new Set(ciclos[0])).toEqual(new Set(["a", "b", "c"]));
  });

  it("encuentra varios ciclos independientes", () => {
    const ciclos = detectarCiclosExistentes(jerarquia({ x: "y", y: "x", m: "n", n: "m", ok: null }));
    expect(ciclos).toHaveLength(2);
  });
});

describe("construirArbol", () => {
  it("arma la jerarquía y calcula niveles", () => {
    const { raices } = construirArbol([
      emp("ana", null),
      emp("luis", "ana"),
      emp("marta", "luis"),
    ]);
    expect(raices).toHaveLength(1);
    expect(raices[0].datos.id).toBe("ana");
    expect(raices[0].nivel).toBe(0);
    expect(raices[0].hijos[0].datos.id).toBe("luis");
    expect(raices[0].hijos[0].nivel).toBe(1);
    expect(raices[0].hijos[0].hijos[0].nivel).toBe(2);
  });

  /**
   * Un bosque, no un árbol: el gerente general y todo aquel a quien nadie
   * asignó jefe todavía son raíces por igual. Devolver una sola escondería a
   * la mitad de la plantilla justo mientras se está poblando la jerarquía.
   */
  it("admite varias raíces", () => {
    const { raices } = construirArbol([emp("ana", null), emp("beto", null), emp("c", "ana")]);
    expect(raices.map((r) => r.datos.id).sort()).toEqual(["ana", "beto"]);
  });

  it("cuenta subordinados directos y totales", () => {
    //      ana
    //     /   \
    //   luis  bea
    //   /  \
    // m     n
    const { raices } = construirArbol([
      emp("ana", null), emp("luis", "ana"), emp("bea", "ana"),
      emp("m", "luis"), emp("n", "luis"),
    ]);
    const ana = raices[0];
    expect(ana.directos).toBe(2);
    expect(ana.total).toBe(4);
    const luis = ana.hijos.find((h) => h.datos.id === "luis")!;
    expect(luis.directos).toBe(2);
    expect(luis.total).toBe(2);
  });

  it("un empleado cuyo jefe no está en el conjunto queda como raíz y se reporta", () => {
    const r = construirArbol([emp("hijo", "jefe-ausente")]);
    expect(r.raices.map((x) => x.datos.id)).toEqual(["hijo"]);
    expect(r.huerfanos).toEqual(["hijo"]);
  });

  /**
   * Un ciclo no tiene raíz: colgarlo de cualquier sitio produciría un dibujo que
   * miente. Se aparta y se reporta para que la pantalla pueda avisar.
   */
  it("aparta los nodos en ciclo en vez de colgarlos", () => {
    const r = construirArbol([emp("ana", null), emp("x", "y"), emp("y", "x")]);
    expect(r.raices.map((n) => n.datos.id)).toEqual(["ana"]);
    expect(new Set(r.enCiclo)).toEqual(new Set(["x", "y"]));
  });

  it("no se cuelga con una jerarquía profunda", () => {
    const nodos = Array.from({ length: 5000 }, (_, i) => emp(`n${i}`, i === 0 ? null : `n${i - 1}`));
    const { raices } = construirArbol(nodos);
    expect(raices).toHaveLength(1);
    expect(raices[0].total).toBe(4999);
  });

  it("con lista vacía no revienta", () => {
    expect(construirArbol([])).toEqual({ raices: [], enCiclo: [], huerfanos: [] });
  });

  it("marca los nodos de contexto", () => {
    const { raices } = construirArbol(
      [emp("jefa", null), emp("yo", "jefa")],
      { contexto: new Set(["jefa"]) }
    );
    expect(raices[0].contexto).toBe(true);
    expect(raices[0].hijos[0].contexto).toBeUndefined();
  });
});

describe("ordenarArbol", () => {
  it("ordena en todos los niveles, para que el dibujo no baile entre recargas", () => {
    const { raices } = construirArbol([
      emp("a", null, { nombre: "Ana" }),
      emp("z", "a", { nombre: "Zoe" }),
      emp("b", "a", { nombre: "Beto" }),
    ]);
    const ordenado = ordenarArbol(raices, (x, y) => x.nombre.localeCompare(y.nombre));
    expect(ordenado[0].hijos.map((h) => h.datos.id)).toEqual(["b", "z"]);
  });
});

describe("ancestrosDeContexto", () => {
  const ORG = jerarquia({ dir: null, gerente: "dir", jefe: "gerente", yo: "jefe" });

  /**
   * El problema real del alcance de datos: se alcanza a un subordinado pero no a
   * su jefe, y la rama queda colgando como si el dibujo estuviera corrupto.
   */
  it("saca los ancestros que faltan para no dejar ramas colgando", () => {
    const contexto = ancestrosDeContexto(ORG, new Set(["yo"]));
    expect(contexto).toEqual(new Set(["jefe", "gerente", "dir"]));
  });

  it("no añade a quien ya es visible", () => {
    expect(ancestrosDeContexto(ORG, new Set(["yo", "jefe", "gerente", "dir"]))).toEqual(new Set());
  });

  it("con alcance total no hace falta contexto", () => {
    expect(ancestrosDeContexto(ORG, new Set(["dir"]))).toEqual(new Set());
  });

  it("sobre datos con ciclo tampoco se cuelga", () => {
    expect(() => ancestrosDeContexto(jerarquia({ x: "y", y: "x" }), new Set(["x"]))).not.toThrow();
  });
});
