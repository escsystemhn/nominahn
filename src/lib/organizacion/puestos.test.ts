import { describe, it, expect } from "vitest";
import {
  claveNombre,
  limpiarNombrePuesto,
  motivoParaNoDesactivar,
  motivoParaNoEliminar,
  motivoParaNoMover,
  nombreRepetido,
  puestosPorCopiar,
  rangoSalarialValido,
  unificarPuestosPorNombre,
} from "./puestos";

const SIN_USO = { empleados: 0, competencias: 0, coberturas: 0 };

describe("nombres", () => {
  it("guarda el nombre sin espacios de más", () => {
    expect(limpiarNombrePuesto("  Jefe   de  RRHH ")).toBe("Jefe de RRHH");
  });

  it("compara sin acentos, mayúsculas ni espacios", () => {
    expect(claveNombre("  TÉCNICO   de Soporte")).toBe(claveNombre("tecnico de soporte"));
  });

  it("detecta el repetido dentro de la lista", () => {
    const lista = [{ id: "a", nombre: "Cajero" }, { id: "b", nombre: "Vendedor" }];
    expect(nombreRepetido("cajéro", lista)).toBe(true);
    expect(nombreRepetido("Bodeguero", lista)).toBe(false);
  });

  it("deja renombrar el propio puesto, también sólo en mayúsculas", () => {
    const lista = [{ id: "a", nombre: "Cajero" }, { id: "b", nombre: "Vendedor" }];
    expect(nombreRepetido("CAJERO", lista, "a")).toBe(false);
    expect(nombreRepetido("Vendedor", lista, "a")).toBe(true);
  });
});

describe("puestos de distintas sucursales para los horarios", () => {
  it("une los que se llaman igual y siempre con el mismo representante", () => {
    const mapa = unificarPuestosPorNombre([
      { id: "b", nombre: "Cajero" },
      { id: "a", nombre: "CAJÉRO " },
      { id: "c", nombre: "Gerente" },
    ]);
    expect(mapa.get("a")).toBe("a");
    expect(mapa.get("b")).toBe("a");
    expect(mapa.get("c")).toBe("c");
  });

  it("no depende del orden en que lleguen", () => {
    const a = { id: "a", nombre: "Cajero" };
    const b = { id: "b", nombre: "cajero" };
    expect(unificarPuestosPorNombre([a, b]).get("b")).toBe(unificarPuestosPorNombre([b, a]).get("b"));
  });

  it("no une nombres distintos", () => {
    const mapa = unificarPuestosPorNombre([{ id: "a", nombre: "Cajero" }, { id: "b", nombre: "Cajero Principal" }]);
    expect(mapa.get("b")).toBe("b");
  });
});

describe("copiar un departamento", () => {
  const origen = [{ nombre: "Cajero", salarioMinimo: 1 }, { nombre: "Vendedor", salarioMinimo: 2 }];

  it("a un departamento nuevo copia todos, con sus datos", () => {
    expect(puestosPorCopiar(origen, [])).toEqual(origen);
  });

  it("a uno existente sólo agrega los que le faltan", () => {
    expect(puestosPorCopiar(origen, [{ nombre: "CAJÉRO" }])).toEqual([origen[1]]);
    expect(puestosPorCopiar(origen, [{ nombre: "cajero" }, { nombre: "vendedor" }])).toEqual([]);
  });

  it("no crea dos veces un nombre repetido en el origen", () => {
    expect(puestosPorCopiar([{ nombre: "Cajero" }, { nombre: "cajero" }], [])).toHaveLength(1);
  });
});

describe("rango salarial", () => {
  it("es opcional: cero significa sin definir", () => {
    expect(rangoSalarialValido(0, 0)).toBe(true);
    expect(rangoSalarialValido(15000, 0)).toBe(true);
    expect(rangoSalarialValido(0, 15000)).toBe(true);
  });

  it("el mínimo no puede pasar del máximo", () => {
    expect(rangoSalarialValido(10000, 15000)).toBe(true);
    expect(rangoSalarialValido(15000, 15000)).toBe(true);
    expect(rangoSalarialValido(15001, 15000)).toBe(false);
  });
});

describe("puesto en uso", () => {
  it("sin uso se puede eliminar y mover", () => {
    expect(motivoParaNoEliminar(SIN_USO)).toBeNull();
    expect(motivoParaNoMover(SIN_USO)).toBeNull();
  });

  it("no se elimina si cualquier cosa lo usa, y dice qué", () => {
    expect(motivoParaNoEliminar({ ...SIN_USO, empleados: 1 })).toContain("1 empleado.");
    expect(motivoParaNoEliminar({ ...SIN_USO, competencias: 2 })).toContain("2 competencias asignadas");
    expect(motivoParaNoEliminar({ empleados: 3, competencias: 1, coberturas: 2 })).toBe(
      "No se puede eliminar: tiene 3 empleados, 1 competencia asignada y 2 reglas de cobertura de horarios. Desactívelo para retirarlo de las listas."
    );
  });

  it("no cambia de departamento con empleados o cobertura", () => {
    expect(motivoParaNoMover({ ...SIN_USO, empleados: 2 })).toContain("2 empleados");
    expect(motivoParaNoMover({ ...SIN_USO, coberturas: 1 })).toContain("cobertura de horarios");
    // Las competencias no dependen de la ubicación del puesto.
    expect(motivoParaNoMover({ ...SIN_USO, competencias: 4 })).toBeNull();
  });

  it("no se desactiva mientras una cobertura lo exija", () => {
    expect(motivoParaNoDesactivar(0)).toBeNull();
    expect(motivoParaNoDesactivar(1)).toContain("1 regla de cobertura de horarios lo exige");
    expect(motivoParaNoDesactivar(3)).toContain("3 reglas de cobertura de horarios lo exigen");
  });
});
