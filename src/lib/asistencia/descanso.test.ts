import { describe, it, expect } from "vitest";
import { depurarDuplicados, resolverDescanso, type ReglaDescanso } from "./descanso";
import type { MarcaMinima } from "./extremos";

const REGLA: ReglaDescanso = { almuerzoMinutos: 60, almuerzoDesdeHoras: 6 };

/** Hora de pared hondureña del 04/09/2026 → instante (UTC−6). */
const hn = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 8, 4, h + 6, m, s));
const marca = (h: number, m = 0, s = 0, tipo: MarcaMinima["tipo"] = "DESCONOCIDO"): MarcaMinima => ({
  ocurridoEn: hn(h, m, s),
  tipo,
});

describe("resolverDescanso — el almuerzo no es tiempo de trabajo", () => {
  it("con el almuerzo marcado descuenta el hueco real", () => {
    // 07:50 entra, 12:00 sale a almorzar, 12:45 regresa, 16:05 sale.
    const d = resolverDescanso({
      entrada: hn(7, 50), salida: hn(16, 5), regla: REGLA,
      marcas: [marca(7, 50), marca(12, 0), marca(12, 45), marca(16, 5)],
    });
    expect(d).toEqual({ minutos: 45, origen: "MARCADO", aviso: null });
  });

  it("suma dos pausas cuando las hay", () => {
    const d = resolverDescanso({
      entrada: hn(7), salida: hn(17), regla: REGLA,
      marcas: [marca(7), marca(10), marca(10, 15), marca(12), marca(13), marca(17)],
    });
    expect(d.minutos).toBe(75);
    expect(d.origen).toBe("MARCADO");
  });

  it("sin marcas intermedias descuenta el almuerzo fijo del turno", () => {
    // Es el caso del horario por defecto del sistema: 08:00 a 17:00, 8 h de
    // jornada. Antes salía una hora extra diaria; con el descuento, cero.
    const d = resolverDescanso({
      entrada: hn(8), salida: hn(17), regla: REGLA,
      marcas: [marca(8), marca(17)],
    });
    expect(d).toEqual({ minutos: 60, origen: "FIJO", aviso: null });
  });

  it("la carga manual, sin marcas, también descuenta el fijo", () => {
    const d = resolverDescanso({ entrada: hn(7), salida: hn(16), regla: REGLA });
    expect(d.minutos).toBe(60);
  });

  it("en medio día no asume almuerzo", () => {
    const d = resolverDescanso({
      entrada: hn(8), salida: hn(12), regla: REGLA,
      marcas: [marca(8), marca(12)],
    });
    expect(d).toEqual({ minutos: 0, origen: "NINGUNO", aviso: null });
  });

  it("con marcas impares aplica el fijo y deja el día señalado", () => {
    // Marcó la salida al almuerzo pero no el regreso: no hay forma de saber
    // cuánto duró. No se inventa un número; se usa el fijo y se avisa.
    const d = resolverDescanso({
      entrada: hn(7, 50), salida: hn(16, 5), regla: REGLA,
      marcas: [marca(7, 50), marca(12), marca(16, 5)],
    });
    expect(d.minutos).toBe(60);
    expect(d.origen).toBe("FIJO");
    expect(d.aviso).toMatch(/incompletas/);
  });

  it("una marca repetida en ráfaga no rompe el emparejamiento", () => {
    // El dedo dos veces al volver del almuerzo: 5 marcas en vez de 4. Sin
    // depurar quedarían impares y se perdería el hueco real.
    const d = resolverDescanso({
      entrada: hn(7, 50), salida: hn(16, 5), regla: REGLA,
      marcas: [marca(7, 50), marca(12), marca(12, 45), marca(12, 45, 20), marca(16, 5)],
    });
    expect(d).toEqual({ minutos: 45, origen: "MARCADO", aviso: null });
  });

  it("la salida repetida no se toma por el regreso de nadie", () => {
    // 16:05:00 y 16:05:40: la segunda es la salida; la primera, un duplicado
    // que no debe contar como marca intermedia.
    const d = resolverDescanso({
      entrada: hn(7, 50), salida: hn(16, 5, 40), regla: REGLA,
      marcas: [marca(7, 50), marca(12), marca(12, 45), marca(16, 5), marca(16, 5, 40)],
    });
    expect(d).toEqual({ minutos: 45, origen: "MARCADO", aviso: null });
  });

  it("con etiquetas del equipo empareja cada SALIDA con la ENTRADA siguiente", () => {
    const d = resolverDescanso({
      entrada: hn(8), salida: hn(17), regla: REGLA,
      marcas: [
        marca(8, 0, 0, "ENTRADA"), marca(12, 0, 0, "SALIDA"),
        marca(12, 50, 0, "ENTRADA"), marca(17, 0, 0, "SALIDA"),
      ],
    });
    expect(d).toEqual({ minutos: 50, origen: "MARCADO", aviso: null });
  });
});

describe("depurarDuplicados", () => {
  it("conserva la primera de cada ráfaga y respeta las marcas separadas", () => {
    const r = depurarDuplicados([marca(12, 45, 20), marca(12, 45), marca(12), marca(16, 5)]);
    expect(r.map((m) => m.ocurridoEn.toISOString())).toEqual([
      hn(12).toISOString(), hn(12, 45).toISOString(), hn(16, 5).toISOString(),
    ]);
  });
});
