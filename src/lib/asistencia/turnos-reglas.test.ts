import { describe, it, expect } from "vitest";
import {
  parseHora,
  formatoHora,
  cruzaMedianoche,
  minutosProgramados,
  parseDias,
  describirDias,
  horasEfectivas,
  validarTurno,
  describirTurno,
  minutosTardanza,
  perteneceAlDiaAnterior,
  diaIso,
  esDiaLaboral,
  type TurnoDatos,
} from "./turnos-reglas";

const diurno: TurnoDatos = {
  tipoJornada: "DIURNA", horaEntrada: "08:00", horaSalida: "17:00", jornadaHoras: 8,
  almuerzoMinutos: 60, almuerzoDesdeHoras: 6, toleranciaMinutos: 5, diasLaborales: "1,2,3,4,5",
};
const nocturno: TurnoDatos = { ...diurno, tipoJornada: "NOCTURNA", horaEntrada: "22:00", horaSalida: "05:00", jornadaHoras: 6, almuerzoMinutos: 60 };

// Instante local del servidor (TZ = America/Tegucigalpa en las pruebas y en producción).
const local = (s: string) => new Date(s);

describe("horas y días", () => {
  it("parsea y formatea", () => {
    expect(parseHora("08:30")).toBe(510);
    expect(parseHora("24:00")).toBeNull();
    expect(parseHora("8:30")).toBeNull();
    expect(formatoHora(510)).toBe("08:30");
    expect(formatoHora(-60)).toBe("23:00");
  });
  it("detecta el cruce de medianoche y mide el lapso", () => {
    expect(cruzaMedianoche("22:00", "06:00")).toBe(true);
    expect(cruzaMedianoche("08:00", "17:00")).toBe(false);
    expect(minutosProgramados("22:00", "06:00")).toBe(480);
    expect(minutosProgramados("08:00", "17:00")).toBe(540);
  });
  it("describe los días como en un contrato", () => {
    expect(describirDias(parseDias("1,2,3,4,5"))).toBe("de lunes a viernes");
    expect(describirDias(parseDias("5,1,3"))).toBe("lunes, miércoles y viernes");
    expect(describirDias(parseDias("6"))).toBe("sábado");
    expect(describirDias(parseDias("1,2,3,4,5,6,7"))).toBe("todos los días");
    expect(parseDias("1, 2, x, 9, 2")).toEqual([1, 2]);
  });
  it("día ISO y día laboral", () => {
    expect(diaIso(new Date("2026-10-12T00:00:00Z"))).toBe(1); // lunes
    expect(diaIso(new Date("2026-10-18T00:00:00Z"))).toBe(7); // domingo
    expect(esDiaLaboral(new Date("2026-10-17T00:00:00Z"), "1,2,3,4,5")).toBe(false);
  });
});

describe("validación legal", () => {
  it("horas efectivas descuentan el almuerzo cuando el lapso lo justifica", () => {
    expect(horasEfectivas(diurno)).toBe(8);
    expect(horasEfectivas({ ...diurno, horaSalida: "12:00" })).toBe(4);
  });
  it("no deja pasar de 8, 7 y 6 horas ordinarias", () => {
    expect(validarTurno(diurno).errores).toEqual([]);
    expect(validarTurno({ ...diurno, jornadaHoras: 9 }).errores[0]).toMatch(/diurna no puede pasar de 8/);
    expect(validarTurno({ ...diurno, tipoJornada: "MIXTA", jornadaHoras: 7.5 }).errores[0]).toMatch(/mixta no puede pasar de 7/);
    expect(validarTurno({ ...nocturno, jornadaHoras: 7 }).errores[0]).toMatch(/nocturna no puede pasar de 6/);
  });
  it("avisa cuando el horario genera extra fija o pasa del máximo semanal", () => {
    const v = validarTurno(nocturno);
    expect(v.errores).toEqual([]);
    expect(v.avisos.some((a) => /h extra/.test(a))).toBe(false); // 7 h de lapso − 1 h almuerzo = 6
    const largo = validarTurno({ ...diurno, horaSalida: "18:00", diasLaborales: "1,2,3,4,5,6" });
    expect(largo.avisos.some((a) => /generará 1 h extra/.test(a))).toBe(true);
    expect(largo.avisos.some((a) => /48 horas ordinarias a la semana; el máximo de la jornada diurna es 44/.test(a))).toBe(true);
  });
  it("rechaza datos imposibles", () => {
    const v = validarTurno({ ...diurno, horaEntrada: "8", toleranciaMinutos: 90, diasLaborales: "" });
    expect(v.errores.length).toBe(3);
  });
});

describe("textos, tardanza y nocturnos", () => {
  it("describe el turno para el contrato", () => {
    expect(describirTurno(diurno)).toEqual({ jornada: "diurna", horario: "de lunes a viernes de 08:00 a 17:00" });
    expect(describirTurno(nocturno).horario).toBe("de lunes a viernes de 22:00 a 05:00 del día siguiente");
  });
  it("cuenta la tardanza después de la tolerancia", () => {
    expect(minutosTardanza(local("2026-10-12T08:04:00"), diurno)).toBe(0);
    expect(minutosTardanza(local("2026-10-12T08:20:00"), diurno)).toBe(15);
    expect(minutosTardanza(local("2026-10-12T07:50:00"), diurno)).toBe(0);
  });
  it("una marca de madrugada es la salida del nocturno de ayer", () => {
    expect(perteneceAlDiaAnterior(local("2026-10-13T05:10:00"), nocturno)).toBe(true);
    expect(perteneceAlDiaAnterior(local("2026-10-13T08:30:00"), nocturno)).toBe(true); // margen de 4 h
    expect(perteneceAlDiaAnterior(local("2026-10-13T09:30:00"), nocturno)).toBe(false);
    expect(perteneceAlDiaAnterior(local("2026-10-13T05:10:00"), diurno)).toBe(false);
    expect(perteneceAlDiaAnterior(local("2026-10-13T05:10:00"), null)).toBe(false);
  });
});
