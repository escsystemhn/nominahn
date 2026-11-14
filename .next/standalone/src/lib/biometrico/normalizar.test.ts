import { describe, it, expect } from "vitest";
import { instanteDePared, normalizarLote } from "./normalizar";
import type { EventoCrudo } from "./driver";

const HN = -360; // UTC−6, el desfase de Honduras

const pared = (
  anio: number, mes: number, dia: number,
  hora: number, minuto = 0, segundo = 0
): EventoCrudo["pared"] => ({ anio, mes, dia, hora, minuto, segundo });

describe("instanteDePared", () => {
  it("convierte la hora de pared hondureña al instante UTC correcto", () => {
    // 08:00 en Honduras (UTC−6) son las 14:00 UTC del mismo día.
    expect(instanteDePared(pared(2026, 9, 4, 8), HN).toISOString()).toBe("2026-09-04T14:00:00.000Z");
  });

  it("usa mes 1-12, no el 0-11 de Date", () => {
    // Si alguien pasara el mes directo a Date.UTC, enero saldría como febrero.
    expect(instanteDePared(pared(2026, 1, 15, 6), HN).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("no depende de la zona horaria del proceso", () => {
    // El cálculo es aritmético sobre Date.UTC; el mismo entrada→salida en
    // cualquier máquina. Si se usara `new Date(a,m,d,...)` esto variaría.
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const enUtc = instanteDePared(pared(2026, 9, 4, 8), HN).toISOString();
      process.env.TZ = "Asia/Tokyo";
      const enTokio = instanteDePared(pared(2026, 9, 4, 8), HN).toISOString();
      expect(enUtc).toBe(enTokio);
    } finally {
      process.env.TZ = original;
    }
  });

  it("respeta un desfase distinto del hondureño", () => {
    expect(instanteDePared(pared(2026, 9, 4, 8), 0).toISOString()).toBe("2026-09-04T08:00:00.000Z");
  });
});

describe("normalizarLote", () => {
  const base = { dispositivoId: "disp1", offsetMinutos: HN };

  it("imputa una marca nocturna al día hondureño, no al día UTC", () => {
    // 23:40 en Honduras ocurre a las 05:40 UTC del día SIGUIENTE. Tomar la fecha
    // en UTC movería la jornada al día equivocado.
    const [e] = normalizarLote({
      ...base,
      eventos: [{ pin: "1", pared: pared(2026, 9, 4, 23, 40) }],
      pinesConocidos: new Map([["1", "emp1"]]),
    });

    expect(e.ocurridoEn.toISOString()).toBe("2026-09-05T05:40:00.000Z");
    expect(e.fechaLocal.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  it("deja la fecha de calendario a medianoche UTC, como manda la doctrina", () => {
    const [e] = normalizarLote({
      ...base,
      eventos: [{ pin: "1", pared: pared(2026, 9, 4, 8) }],
      pinesConocidos: new Map([["1", "emp1"]]),
    });
    expect(e.fechaLocal.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  it("pone en cuarentena el PIN sin dueño en vez de descartarlo", () => {
    const eventos = normalizarLote({
      ...base,
      eventos: [
        { pin: "1", pared: pared(2026, 9, 4, 8) },
        { pin: "99", pared: pared(2026, 9, 4, 8) },
      ],
      pinesConocidos: new Map([["1", "emp1"]]),
    });

    expect(eventos).toHaveLength(2); // el huérfano NO se pierde
    expect(eventos[0]).toMatchObject({ empleadoId: "emp1", estado: "PENDIENTE" });
    expect(eventos[1]).toMatchObject({ empleadoId: null, estado: "CUARENTENA", pin: "99" });
  });

  it("marca DESCONOCIDO cuando el equipo no informa entrada/salida", () => {
    // Es el caso NORMAL en ZKTeco: getAttendances() da un timestamp pelado.
    const [e] = normalizarLote({
      ...base,
      eventos: [{ pin: "1", pared: pared(2026, 9, 4, 8) }],
      pinesConocidos: new Map([["1", "emp1"]]),
    });
    expect(e.tipo).toBe("DESCONOCIDO");
  });

  it("respeta el tipo cuando el equipo sí lo informa", () => {
    const [e] = normalizarLote({
      ...base,
      eventos: [{ pin: "1", pared: pared(2026, 9, 4, 8), tipo: "ENTRADA" }],
      pinesConocidos: new Map([["1", "emp1"]]),
    });
    expect(e.tipo).toBe("ENTRADA");
  });
});
