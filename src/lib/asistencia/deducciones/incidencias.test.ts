import { describe, expect, it } from "vitest";
import type { Turno } from "@/lib/asistencia/turnos";
import { incidenciasDelPeriodo, perfilDesdeTurno, tiempoFueraDeHorario, type MarcaParaAsistencia } from "./incidencias";

const TURNO: Turno = {
  jornadaHoras: 8, descanso: { almuerzoMinutos: 60, almuerzoDesdeHoras: 6 }, cruzaMedianoche: false, nombre: "Oficina", id: "t1",
  tipoJornada: "DIURNA", horaEntrada: "08:00", horaSalida: "17:00", toleranciaMinutos: 5, diasLaborales: "1,2,3,4,5",
};
// Horas locales (noviembre = mes 10): `minutosDelDia` lee la hora local, igual que el reporte de puntualidad.
const h = (dia: number, hh: number, mm: number) => new Date(2026, 10, dia, hh, mm);
const marca = (dia: number, entrada: [number, number], salida: [number, number], horasNormales: number): MarcaParaAsistencia => ({
  fecha: `2026-11-${String(dia).padStart(2, "0")}`, esAusencia: false, horaEntrada: h(dia, ...entrada), horaSalida: h(dia, ...salida), horasNormales,
});
const falta = (dia: number): MarcaParaAsistencia => ({ fecha: `2026-11-${String(dia).padStart(2, "0")}`, esAusencia: true, horaEntrada: null, horaSalida: null, horasNormales: 0 });

const armar = (marcas: MarcaParaAsistencia[], extra: Partial<Parameters<typeof incidenciasDelPeriodo>[0]> = {}) =>
  incidenciasDelPeriodo({ desde: "2026-11-01", hasta: "2026-11-30", marcas, turnoDe: () => TURNO, permisos: [], fechasIncapacidad: new Set(), feriados: new Set(), ...extra });

describe("tiempo fuera de horario de una marca", () => {
  it("llegó 20 tarde y se quedó 20 más: completó la jornada, todo repuesto", () => {
    expect(tiempoFueraDeHorario(marca(3, [8, 20], [17, 20], 8), TURNO)).toEqual({ tarde: 20, temprano: 0, repuestoTarde: 20, repuestoTemprano: 0 });
  });

  it("llegó 20 tarde y salió a su hora: le faltan 20, nada repuesto", () => {
    expect(tiempoFueraDeHorario(marca(3, [8, 20], [17, 0], 7 + 40 / 60), TURNO)).toMatchObject({ tarde: 20, repuestoTarde: 0 });
  });

  it("llegó 12 tarde y se quedó 5: repuso 5", () => {
    expect(tiempoFueraDeHorario(marca(3, [8, 12], [17, 5], 473 / 60), TURNO)).toMatchObject({ tarde: 12, repuestoTarde: 5 });
  });

  it("salió 30 antes; si entró 30 antes, también lo repuso", () => {
    expect(tiempoFueraDeHorario(marca(3, [8, 0], [16, 30], 7.5), TURNO)).toMatchObject({ temprano: 30, repuestoTemprano: 0 });
    expect(tiempoFueraDeHorario(marca(3, [7, 30], [16, 30], 8), TURNO)).toMatchObject({ tarde: 0, temprano: 30, repuestoTemprano: 30 });
  });

  it("sin salida o con el turno implícito (sin horario) no se mide", () => {
    expect(tiempoFueraDeHorario({ ...marca(3, [8, 20], [17, 0], 0), horaSalida: null }, TURNO)).toBeNull();
    expect(tiempoFueraDeHorario(marca(3, [8, 20], [17, 0], 7.67), { ...TURNO, horaEntrada: null, horaSalida: null })).toBeNull();
  });

  it("turno nocturno que cruza la medianoche", () => {
    const noche: Turno = { ...TURNO, tipoJornada: "NOCTURNA", jornadaHoras: 6, horaEntrada: "22:00", horaSalida: "04:00", cruzaMedianoche: true };
    const m: MarcaParaAsistencia = { fecha: "2026-11-03", esAusencia: false, horaEntrada: h(3, 22, 15), horaSalida: h(4, 4, 0), horasNormales: 5.75 };
    expect(tiempoFueraDeHorario(m, noche)).toMatchObject({ tarde: 15, temprano: 0, repuestoTarde: 0 });
  });
});

describe("incidencias del período", () => {
  it("una falta del reloj es injustificada; con incapacidad o permiso cambia su clase", () => {
    const r = armar([falta(3), falta(4), falta(5)], {
      fechasIncapacidad: new Set(["2026-11-04"]),
      permisos: [{ tipo: "PERSONAL", desde: "2026-11-05", hasta: "2026-11-05", dias: 1 }],
    });
    expect(r.map((i) => i.tipo === "AUSENCIA" && i.clasificacion)).toEqual(["INJUSTIFICADA", "INCAPACIDAD", "CON_GOCE"]);
  });

  it("un permiso sin goce descuenta sus días aprobados aunque el reloj no los marque, y no el día que trabajó", () => {
    const r = armar([marca(4, [8, 0], [17, 0], 8)], {
      permisos: [{ tipo: "SIN_GOCE", desde: "2026-11-03", hasta: "2026-11-09", dias: 3 }],
    });
    // Cubre los 3 primeros días laborales (3, 4 y 5 de noviembre); el 4 trabajó.
    expect(r).toEqual([
      { tipo: "AUSENCIA", fecha: "2026-11-03", clasificacion: "SIN_GOCE" },
      { tipo: "AUSENCIA", fecha: "2026-11-05", clasificacion: "SIN_GOCE" },
    ]);
  });

  it("una falta fuera de los días aprobados del permiso sigue siendo injustificada", () => {
    const r = armar([falta(6)], { permisos: [{ tipo: "SIN_GOCE", desde: "2026-11-03", hasta: "2026-11-09", dias: 3 }] });
    expect(r.find((i) => i.fecha === "2026-11-06")).toMatchObject({ clasificacion: "INJUSTIFICADA" });
  });

  it("llegadas tarde y salidas anticipadas, con lo repuesto; nada en feriado ni en fin de semana", () => {
    const r = armar(
      [marca(3, [8, 12], [17, 5], 473 / 60), marca(4, [8, 0], [16, 30], 7.5), marca(11, [8, 30], [17, 0], 7.5), { ...marca(7, [9, 0], [13, 0], 4) }],
      { feriados: new Set(["2026-11-11"]) }
    );
    expect(r).toEqual([
      { tipo: "TARDANZA", fecha: "2026-11-03", minutos: 12, minutosRepuestos: 5 },
      { tipo: "SALIDA_ANTICIPADA", fecha: "2026-11-04", minutos: 30, minutosRepuestos: 0 },
    ]);
  });

  it("el perfil sale del turno: jornada legal si coincide, personalizada si no", () => {
    expect(perfilDesdeTurno(TURNO, 30000, "MENSUAL")).toMatchObject({ jornada: { tipo: "DIURNA" }, horario: { 1: 8, 5: 8 } });
    expect(perfilDesdeTurno({ ...TURNO, jornadaHoras: 7.5 }, 30000, "MENSUAL").jornada).toEqual({ tipo: "PERSONALIZADA", horasDiarias: 7.5 });
  });
});
