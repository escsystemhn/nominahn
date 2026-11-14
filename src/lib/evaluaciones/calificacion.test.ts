import { describe, expect, it } from "vitest";
import {
  calificacionPonderada,
  consolidarCriterios,
  consolidarParticipantes,
  estanTodosCalificados,
  redondear2,
} from "./calificacion";

describe("calificacionPonderada", () => {
  it("con pesos iguales es el promedio simple", () => {
    expect(calificacionPonderada([{ calificacion: 80, peso: 1 }, { calificacion: 90, peso: 1 }, { calificacion: 70, peso: 1 }])).toBe(80);
  });

  it("respeta el peso de cada aspecto", () => {
    // (90×3 + 60×1) ÷ 4 = 82.5
    expect(calificacionPonderada([{ calificacion: 90, peso: 3 }, { calificacion: 60, peso: 1 }])).toBe(82.5);
  });

  it("un 100 es válido (antes desbordaba la columna)", () => {
    expect(calificacionPonderada([{ calificacion: 100, peso: 1 }])).toBe(100);
  });

  it("ignora los aspectos sin calificar en vez de contarlos como 0", () => {
    expect(calificacionPonderada([{ calificacion: 80, peso: 1 }, { calificacion: null, peso: 5 }, { calificacion: undefined, peso: 1 }])).toBe(80);
  });

  it("ignora pesos cero o negativos y valores no finitos", () => {
    expect(calificacionPonderada([{ calificacion: 50, peso: 0 }, { calificacion: 70, peso: -1 }, { calificacion: Number.NaN, peso: 1 }, { calificacion: 90, peso: 2 }])).toBe(90);
  });

  it("sin nada calificado devuelve null, no 0", () => {
    expect(calificacionPonderada([])).toBeNull();
    expect(calificacionPonderada([{ calificacion: null, peso: 1 }])).toBeNull();
  });

  it("acota a 0–100 y redondea a dos decimales", () => {
    expect(calificacionPonderada([{ calificacion: 150, peso: 1 }, { calificacion: -10, peso: 1 }])).toBe(50);
    expect(calificacionPonderada([{ calificacion: 85, peso: 1 }, { calificacion: 90, peso: 1 }, { calificacion: 92, peso: 1 }])).toBe(89);
    expect(calificacionPonderada([{ calificacion: 85, peso: 1.5 }, { calificacion: 90, peso: 1 }, { calificacion: 92, peso: 1 }])).toBe(88.43); // 309.5 ÷ 3.5
  });
});

describe("estanTodosCalificados", () => {
  it("exige calificación en cada aspecto con peso", () => {
    expect(estanTodosCalificados([{ calificacion: 80, peso: 1 }, { calificacion: 0, peso: 1 }])).toBe(true);
    expect(estanTodosCalificados([{ calificacion: 80, peso: 1 }, { calificacion: null, peso: 1 }])).toBe(false);
    expect(estanTodosCalificados([{ calificacion: 80, peso: 1 }, { calificacion: null, peso: 0 }])).toBe(true);
    expect(estanTodosCalificados([])).toBe(false);
  });
});

describe("consolidarParticipantes", () => {
  it("promedia evaluadores; cada uno vale por sus aspectos ponderados", () => {
    expect(
      consolidarParticipantes([
        { calificacion: 10, criterios: [{ calificacion: 90, peso: 3 }, { calificacion: 60, peso: 1 }] }, // 82.5; su general no cuenta
        { calificacion: 74, criterios: [] }, // sin aspectos: vale su general
      ])
    ).toBe(78.25);
  });

  it("es el caso de la evaluación que quedó en 0 con 78 y 74", () => {
    expect(consolidarParticipantes([{ calificacion: 78, criterios: [] }, { calificacion: 74, criterios: [] }])).toBe(76);
  });

  it("null si nadie calificó", () => {
    expect(consolidarParticipantes([{ calificacion: null, criterios: [] }])).toBeNull();
  });
});

describe("consolidarCriterios", () => {
  it("promedia por aspecto del catálogo o por nombre si es libre", () => {
    const r = consolidarCriterios([
      { competenciaId: "c1", criterio: "Puntualidad", peso: 2, calificacion: 80 },
      { competenciaId: "c1", criterio: "Puntualidad", peso: 2, calificacion: 90 },
      { competenciaId: null, criterio: "Orden ", peso: 1, calificacion: 70 },
      { competenciaId: null, criterio: "orden", peso: 1, calificacion: 75 },
      { competenciaId: "c2", criterio: "Sin nota", peso: 1, calificacion: null },
    ]);
    expect(r).toEqual([
      { competenciaId: "c1", criterio: "Puntualidad", peso: 2, calificacion: 85 },
      { competenciaId: null, criterio: "Orden ", peso: 1, calificacion: 72.5 },
    ]);
  });
});

describe("redondear2", () => {
  it("redondea mitad hacia arriba sin errores de coma flotante", () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(88.705)).toBe(88.71);
  });
});
