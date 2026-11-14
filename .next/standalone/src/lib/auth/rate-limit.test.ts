import { describe, it, expect, beforeEach } from "vitest";
import {
  registrarFallo,
  estaBloqueado,
  estado,
  limpiar,
  _reset,
  _claves,
  type ConfigRateLimit,
} from "./rate-limit";

const CFG: ConfigRateLimit = { maxIntentos: 3, ventanaMs: 1000 };
const T0 = 1_000_000;

beforeEach(() => _reset());

describe("rate-limit — bloqueo por intentos fallidos", () => {
  it("no bloquea mientras no se alcanza el máximo", () => {
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    expect(estaBloqueado("a@x.com", T0, CFG)).toBe(false);
  });

  it("bloquea exactamente al alcanzar el máximo de intentos", () => {
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    const r = registrarFallo("a@x.com", T0, CFG); // 3.º
    expect(r.bloqueado).toBe(true);
    expect(estaBloqueado("a@x.com", T0, CFG)).toBe(true);
  });

  it("informa los intentos restantes", () => {
    expect(estado("a@x.com", T0, CFG).intentosRestantes).toBe(3);
    registrarFallo("a@x.com", T0, CFG);
    expect(estado("a@x.com", T0, CFG).intentosRestantes).toBe(2);
  });

  it("cada clave (email/IP) se cuenta por separado", () => {
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    expect(estaBloqueado("a@x.com", T0, CFG)).toBe(true);
    expect(estaBloqueado("b@x.com", T0, CFG)).toBe(false);
  });

  it("la ventana es deslizante: los fallos viejos expiran", () => {
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    expect(estaBloqueado("a@x.com", T0, CFG)).toBe(true);
    // Pasada la ventana completa, ya no hay fallos vigentes.
    expect(estaBloqueado("a@x.com", T0 + 1001, CFG)).toBe(false);
  });

  it("un acierto (limpiar) borra el historial", () => {
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    limpiar("a@x.com");
    expect(estado("a@x.com", T0, CFG).intentosRestantes).toBe(3);
  });

  it("expone cuándo se libera el bloqueo", () => {
    registrarFallo("a@x.com", T0, CFG);
    registrarFallo("a@x.com", T0, CFG);
    const r = registrarFallo("a@x.com", T0, CFG);
    // se libera una ventana después del PRIMER fallo vigente
    expect(r.desbloqueaEn).toBe(T0 + CFG.ventanaMs);
  });

  it("un fallo aislado no reactiva un bloqueo ya expirado", () => {
    for (let i = 0; i < 3; i++) registrarFallo("a@x.com", T0, CFG);
    // muy después, un solo fallo: cuenta 1, no bloquea
    const r = registrarFallo("a@x.com", T0 + 10_000, CFG);
    expect(r.bloqueado).toBe(false);
    expect(r.intentosRestantes).toBe(2);
  });
});

describe("rate-limit — memoria acotada", () => {
  it("al llegar al tope barre las claves caducadas y conserva las vigentes", () => {
    for (let i = 0; i < 5000; i++) registrarFallo(`viejo${i}@x.com`, T0, CFG);
    registrarFallo("reciente@x.com", T0 + 900, CFG);
    expect(_claves()).toBe(5001);

    // Pasada la ventana de los viejos, una clave nueva dispara el barrido.
    registrarFallo("nuevo@x.com", T0 + 1500, CFG);
    expect(_claves()).toBe(2);
    expect(estado("reciente@x.com", T0 + 1500, CFG).intentosRestantes).toBe(2);
  });

  it("el barrido respeta la ventana con la que se registró cada clave", () => {
    const LARGA: ConfigRateLimit = { maxIntentos: 3, ventanaMs: 60_000 };
    registrarFallo("ip:1.2.3.4", T0, LARGA);
    for (let i = 0; i < 4999; i++) registrarFallo(`viejo${i}@x.com`, T0, CFG);

    registrarFallo("nuevo@x.com", T0 + 1500, CFG);
    // La de ventana larga sigue vigente aunque la corta ya habría caducado.
    expect(estado("ip:1.2.3.4", T0 + 1500, LARGA).intentosRestantes).toBe(2);
  });
});
