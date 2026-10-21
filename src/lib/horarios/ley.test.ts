import { describe, it, expect } from "vitest";
import { tipoJornada, minutosNocturnos, minutosEfectivos, analizarJornada, topeSemanalH, jornadaDeHoras } from "./ley";

const j = (entrada: string, salida: string, pausa = 0) => jornadaDeHoras(entrada, salida, pausa)!;

describe("tipo de jornada (Art. 321)", () => {
  it("toda entre 5:00 y 19:00 es diurna", () => {
    expect(tipoJornada(j("06:00", "15:00").entrada, j("06:00", "15:00").salida)).toBe("DIURNA");
    expect(tipoJornada(5 * 60, 19 * 60)).toBe("DIURNA");
  });

  it("con menos de 3 h nocturnas es mixta", () => {
    const x = j("12:00", "21:59");
    expect(minutosNocturnos(x.entrada, x.salida)).toBe(179);
    expect(tipoJornada(x.entrada, x.salida)).toBe("MIXTA");
  });

  it("con 3 h nocturnas exactas ya es NOCTURNA (no 3.5 h)", () => {
    const x = j("14:00", "22:00");
    expect(minutosNocturnos(x.entrada, x.salida)).toBe(180);
    expect(tipoJornada(x.entrada, x.salida)).toBe("NOCTURNA");
  });

  it("cruza la medianoche y cuenta la madrugada como nocturna", () => {
    const x = j("22:00", "06:00");
    expect(x.salida).toBe(30 * 60);
    expect(minutosNocturnos(x.entrada, x.salida)).toBe(7 * 60);
    expect(tipoJornada(x.entrada, x.salida)).toBe("NOCTURNA"); // 1 h diurna (5–6) y 7 nocturnas
  });

  it("de madrugada a la mañana con 3 h o más nocturnas es nocturna", () => {
    const x = j("02:00", "08:00");
    expect(minutosNocturnos(x.entrada, x.salida)).toBe(180);
    expect(tipoJornada(x.entrada, x.salida)).toBe("NOCTURNA");
  });
});

describe("horas efectivas (Art. 326)", () => {
  it("la pausa de 30 min de una jornada continua cuenta como trabajo", () => {
    expect(minutosEfectivos(j("06:00", "14:00", 30))).toBe(480);
  });
  it("un almuerzo de 60 min (jornada dividida) no cuenta", () => {
    expect(minutosEfectivos(j("06:00", "15:00", 60))).toBe(480);
  });
});

describe("horas extra (Arts. 330 y 322)", () => {
  it("diurna de 8 h efectivas: sin extra", () => {
    const r = analizarJornada(j("06:00", "15:00", 60));
    expect(r.tipo).toBe("DIURNA");
    expect(r.extraTotal).toBe(0);
  });

  it("un cierre de 14:00 a 22:00 con almuerzo es nocturno: 1 h extra al 75 %", () => {
    const r = analizarJornada(j("14:00", "22:00", 60));
    expect(r.tipo).toBe("NOCTURNA");
    expect(r.efectivos).toBe(420);
    expect(r.extraTotal).toBe(60);
    expect(r.extra.PROLONGACION_NOCTURNA_75).toBe(60);
  });

  it("una mixta de 8 h: la hora extra cae de noche y va al 50 %", () => {
    const r = analizarJornada(j("12:00", "21:00", 60)); // 2 h nocturnas → mixta, 8 h efectivas
    expect(r.tipo).toBe("MIXTA");
    expect(r.extraTotal).toBe(60);
    expect(r.extra.NOCTURNA_50).toBe(60);
  });

  it("una diurna de 9 h: la hora extra es diurna al 25 %", () => {
    const r = analizarJornada(j("07:00", "16:00", 0));
    expect(r.extra.DIURNA_25).toBe(60);
  });

  it("respeta una jornada pactada menor que la legal", () => {
    const r = analizarJornada(j("07:00", "14:00", 0), { ordinariasPactadasH: 6 });
    expect(r.extraTotal).toBe(60);
  });

  it("un cargo de dirección (Art. 325) no genera extra por jornada", () => {
    const r = analizarJornada(j("07:00", "18:00", 90), { exento: true });
    expect(r.extraTotal).toBe(0);
  });
});

describe("tope semanal", () => {
  it("una semana de un solo tipo usa su tope legal", () => {
    expect(topeSemanalH(["DIURNA", "DIURNA"])).toBe(44);
    expect(topeSemanalH(["NOCTURNA"])).toBe(36);
  });
  it("una semana mezclada pondera por días", () => {
    expect(topeSemanalH(["DIURNA", "DIURNA", "DIURNA", "MIXTA", "MIXTA", "MIXTA"])).toBe(43);
  });
});
