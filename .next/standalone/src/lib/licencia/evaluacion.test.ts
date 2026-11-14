import { describe, it, expect } from "vitest";
import { calcularEvaluacion, textoAviso, inicioDelDiaHN, ultimoDiaValido } from "./evaluacion";

/** Instante a partir de una hora local de Honduras (UTC−6). */
const hn = (iso: string) => new Date(`${iso}-06:00`);

// Instalada el lunes 19 de octubre de 2026 a las 4 p. m., hora de Honduras.
const INICIO = hn("2026-10-19T16:00:00");

describe("calcularEvaluacion", () => {
  it("el día de la instalación es el día 1 y quedan 30", () => {
    const ev = calcularEvaluacion(INICIO, hn("2026-10-19T23:59:00"));
    expect(ev.dia).toBe(1);
    expect(ev.diasRestantes).toBe(30);
    expect(ev.mostrarAviso).toBe(false);
  });

  it("cuenta días de calendario de Honduras, no bloques de 24 horas", () => {
    // 8 horas después de instalar ya es otro día en Honduras.
    expect(calcularEvaluacion(INICIO, hn("2026-10-20T00:00:00")).dia).toBe(2);
  });

  it("no avisa el día 24", () => {
    const ev = calcularEvaluacion(INICIO, hn("2026-11-11T09:00:00"));
    expect(ev.dia).toBe(24);
    expect(ev.mostrarAviso).toBe(false);
  });

  it("avisa desde el día 25, con 6 días contando hoy", () => {
    const ev = calcularEvaluacion(INICIO, hn("2026-11-12T00:00:00"));
    expect(ev.dia).toBe(25);
    expect(ev.diasRestantes).toBe(6);
    expect(ev.mostrarAviso).toBe(true);
    expect(textoAviso(ev)).toBe("Quedan 6 días de evaluación: el último es el martes 17 de noviembre.");
  });

  it("el día 30 dice que es el último y sigue funcionando hasta la medianoche", () => {
    const ev = calcularEvaluacion(INICIO, hn("2026-11-17T23:59:59"));
    expect(ev.dia).toBe(30);
    expect(ev.diasRestantes).toBe(1);
    expect(ev.vencida).toBe(false);
    expect(ev.mostrarAviso).toBe(true);
    expect(textoAviso(ev)).toBe("Hoy es el último día de la evaluación.");
  });

  it("vence a la medianoche que cierra el día 30", () => {
    const ev = calcularEvaluacion(INICIO, hn("2026-11-18T00:00:00"));
    expect(ev.vencida).toBe(true);
    expect(ev.diasRestantes).toBe(0);
    expect(ev.mostrarAviso).toBe(false);
    expect(ev.venceEn.toISOString()).toBe("2026-11-18T06:00:00.000Z");
  });

  it("atrasar el reloj no devuelve días: manda la mayor fecha vista", () => {
    const mayorVisto = hn("2026-11-18T08:00:00");
    const ev = calcularEvaluacion(INICIO, hn("2026-10-25T08:00:00"), mayorVisto);
    expect(ev.vencida).toBe(true);
  });

  it("un inicio en el futuro (reloj adelantado al instalar) no da días negativos", () => {
    const ev = calcularEvaluacion(hn("2026-12-01T10:00:00"), hn("2026-10-19T10:00:00"));
    expect(ev.dia).toBe(1);
    expect(ev.diasRestantes).toBe(30);
  });
});

describe("ultimoDiaValido", () => {
  it("la medianoche que cierra el día 18 (06:00 UTC del 19) muestra el 18, con año", () => {
    expect(ultimoDiaValido("2027-10-19T06:00:00Z")).toBe("18 de octubre de 2027");
  });
});

describe("inicioDelDiaHN", () => {
  it("la medianoche de Honduras son las 06:00 UTC", () => {
    expect(new Date(inicioDelDiaHN(hn("2026-10-19T23:30:00").getTime())).toISOString()).toBe(
      "2026-10-19T06:00:00.000Z"
    );
    expect(new Date(inicioDelDiaHN(hn("2026-10-19T00:00:00").getTime())).toISOString()).toBe(
      "2026-10-19T06:00:00.000Z"
    );
  });
});
