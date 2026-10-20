import { describe, it, expect } from "vitest";
import { proximoIntento, ESPERAS_REINTENTO_MIN, MAX_INTENTOS } from "./reintentos";

describe("proximoIntento", () => {
  const ahora = new Date("2026-10-15T12:00:00Z");
  const minutos = (d: Date | null) => (d ? (d.getTime() - ahora.getTime()) / 60_000 : null);

  it("espera 1, 5, 15, 60 minutos y luego 6 horas", () => {
    expect(minutos(proximoIntento(1, ahora))).toBe(1);
    expect(minutos(proximoIntento(2, ahora))).toBe(5);
    expect(minutos(proximoIntento(3, ahora))).toBe(15);
    expect(minutos(proximoIntento(4, ahora))).toBe(60);
    expect(minutos(proximoIntento(5, ahora))).toBe(360);
    expect(minutos(proximoIntento(9, ahora))).toBe(360);
    expect(ESPERAS_REINTENTO_MIN).toEqual([1, 5, 15, 60, 360]);
  });

  it("al agotar los intentos ya no programa otro", () => {
    expect(proximoIntento(MAX_INTENTOS, ahora)).toBeNull();
    expect(proximoIntento(MAX_INTENTOS + 3, ahora)).toBeNull();
  });

  it("intentos en cero cuenta como el primero", () => {
    expect(minutos(proximoIntento(0, ahora))).toBe(1);
  });
});
