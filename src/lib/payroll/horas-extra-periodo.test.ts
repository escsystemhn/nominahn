import { describe, it, expect } from "vitest";
import { combinarFijadas, decidirHoras, horasDelPeriodo, horasEnCelda, recargoDeCabecera, sumarMarcajes, textoHoras } from "@/lib/payroll/horas-extra-periodo";

const recargo = (c: string) => recargoDeCabecera(c)?.porcentaje ?? null;

describe("la columna de cada recargo", () => {
  it("por el código del formato, debajo del encabezado", () => {
    expect(recargo("Horas extra 25 % (HE-25)")).toBe(25);
    expect(recargo("Horas extra 100 %\n(HE-100)")).toBe(100);
  });
  it("por como la llaman las planillas hechas a mano", () => {
    expect(["Horas extra 25%", "H.E. 50%", "HE 75", "Extra 100 %", "Horas al 25 %", "Horas extras 50", "Horas 75%", "Tiempo extra 100"].map(recargo))
      .toEqual([25, 50, 75, 100, 25, 50, 75, 100]);
  });
  it("un número suelto o un porcentaje que no es de recargo no es una columna de horas", () => {
    expect(["25", "25 %", "Horas extra 30 %", "Cooperativa 50", "Total horas"].map(recargo)).toEqual([null, null, null, null, null]);
  });
});

describe("qué hace cada celda", () => {
  it("igual a lo de hoy: nada; distinta: se fija para el período", () => {
    expect(decidirHoras(null, 6, 6)).toEqual({ accion: "IGUAL" });
    expect(decidirHoras(null, 6, 8)).toEqual({ accion: "PONER", valor: 8, antes: 6, despues: 8 });
    expect(decidirHoras(8, 6, 8)).toEqual({ accion: "IGUAL" });
    expect(decidirHoras(8, 6, 0)).toEqual({ accion: "PONER", valor: 0, antes: 8, despues: 0 });
  });
  it("lo fijado que vuelve a ser lo de los marcajes se quita: no queda nada fijado sin necesidad", () => {
    expect(decidirHoras(8, 6, 6)).toEqual({ accion: "QUITAR", antes: 8, despues: 6 });
  });
});

describe("lo que paga la planilla", () => {
  it("cada recargo fijado reemplaza al de los marcajes; los demás quedan", () => {
    const deMarcajes = { diurnas: 6, mixtas: 2, nocturnas: 0, feriado: 4 };
    expect(horasDelPeriodo(deMarcajes, { diurnas: 10, mixtas: null, nocturnas: null, feriado: 0 })).toEqual({ diurnas: 10, mixtas: 2, nocturnas: 0, feriado: 0 });
    expect(horasDelPeriodo(deMarcajes, null)).toEqual(deMarcajes);
  });
  it("los marcajes de antes del desglose van al 25 %", () => {
    const m = (total: number, d = 0, mi = 0, n = 0, f = 0) => ({ horasExtra: total, horasExtraDiurna: d, horasExtraMixta: mi, horasExtraNocturna: n, horasFeriado: f });
    expect(sumarMarcajes([m(3), m(4, 2, 2), m(0, 0, 0, 0, 8)])).toEqual({ diurnas: 5, mixtas: 2, nocturnas: 0, feriado: 8 });
  });
  it("dos registros en el período se suman; un recargo sin fijar en ninguno queda sin fijar", () => {
    expect(combinarFijadas([{ diurnas: 4, mixtas: null }, { diurnas: "2.5", feriado: 8 }])).toEqual({ diurnas: 6.5, mixtas: null, nocturnas: null, feriado: 8 });
    expect(combinarFijadas([])).toBeNull();
  });
  it("la celda del formato: lo fijado o lo de los marcajes", () => {
    expect(horasEnCelda({ diurnas: 0, mixtas: null, nocturnas: null, feriado: null }, { diurnas: 5, mixtas: 3, nocturnas: 0, feriado: 0 }, "diurnas")).toBe(0);
    expect(horasEnCelda(null, { diurnas: 5, mixtas: 3, nocturnas: 0, feriado: 0 }, "mixtas")).toBe(3);
    expect(textoHoras(2.5)).toBe("2.5 h");
    expect(textoHoras(0)).toBe("—");
  });
});
