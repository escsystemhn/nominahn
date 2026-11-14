import { describe, it, expect } from "vitest";
import {
  INACTIVIDAD_POR_OMISION, MARGEN_SERVIDOR_MS, anticipoAvisoMs, destinoSeguro, leerMinutos, normalizarMinutos, textoMinutos,
  vencidaPorInactividad,
} from "./inactividad";
import { configMiddleware } from "./middleware-config";

const MIN = 60_000;

describe("minutos de inactividad", () => {
  it("se guardan entre 1 y 480; lo demás vuelve a 5", () => {
    expect(normalizarMinutos("15")).toBe(15);
    expect(normalizarMinutos(480)).toBe(480);
    for (const malo of [null, undefined, "", "0", "481", "2.5", "abc", -3]) expect(normalizarMinutos(malo)).toBe(INACTIVIDAD_POR_OMISION);
  });

  it("lo que escribe el administrador se valida con mensaje claro", () => {
    expect(leerMinutos(" 10 ")).toEqual({ ok: true, valor: 10 });
    expect(leerMinutos("0")).toMatchObject({ ok: false, error: expect.stringMatching(/entre 1 y 480/) });
    expect(leerMinutos("5,5")).toMatchObject({ ok: false, error: expect.stringMatching(/número entero/) });
    expect(leerMinutos("")).toMatchObject({ ok: false });
  });

  it("textos de duración", () => {
    expect(textoMinutos(1)).toBe("1 minuto");
    expect(textoMinutos(5)).toBe("5 minutos");
    expect(textoMinutos(60)).toBe("1 hora");
    expect(textoMinutos(90)).toBe("1 hora y 30 minutos");
    expect(textoMinutos(480)).toBe("8 horas");
  });

  it("avisa un minuto antes, o a la mitad si el límite es más corto", () => {
    expect(anticipoAvisoMs(5 * MIN)).toBe(60_000);
    expect(anticipoAvisoMs(1 * MIN)).toBe(30_000);
  });
});

describe("vencimiento en el servidor", () => {
  const t0 = Date.UTC(2026, 10, 11, 12, 0, 0);

  it("vence pasado el límite más la holgura, nunca antes", () => {
    const token = { actividadEn: t0, inactividadMin: 5 };
    expect(vencidaPorInactividad(token, t0 + 5 * MIN)).toBe(false);
    expect(vencidaPorInactividad(token, t0 + 5 * MIN + MARGEN_SERVIDOR_MS)).toBe(false);
    expect(vencidaPorInactividad(token, t0 + 5 * MIN + MARGEN_SERVIDOR_MS + 1)).toBe(true);
  });

  it("la holgura cubre el latido atrasado: el navegador siempre cierra primero", () => {
    // Última tecla 59 s después del último latido: el navegador cierra a los 5 min de la tecla.
    const ultimoLatido = t0, ultimaTecla = t0 + 59_000;
    const cierreNavegador = ultimaTecla + 5 * MIN;
    expect(vencidaPorInactividad({ actividadEn: ultimoLatido, inactividadMin: 5 }, cierreNavegador)).toBe(false);
  });

  it("sin minutos en el token usa 5; sin marca de actividad no vence (token anterior a la regla)", () => {
    expect(vencidaPorInactividad({ actividadEn: t0 }, t0 + 8 * MIN)).toBe(true);
    expect(vencidaPorInactividad({}, t0 + 999 * MIN)).toBe(false);
  });
});

describe("adónde volver después de entrar", () => {
  it("sólo rutas de esta aplicación", () => {
    expect(destinoSeguro("/planillas/abc?tab=2")).toBe("/planillas/abc?tab=2");
    expect(destinoSeguro(null)).toBe("/dashboard");
  });
  it("rechaza destinos que sacarían a otro sitio o vuelven al login", () => {
    for (const malo of ["https://otro.sitio", "//otro.sitio/x", "/\\otro.sitio", "javascript:alert(1)", "planillas", "/login?x=1", "/api/reportes", "/planillas\n"]) {
      expect(destinoSeguro(malo)).toBe("/dashboard");
    }
  });
});

describe("el proxy y el token", () => {
  const jwt = (esLatido: boolean, token: Record<string, unknown>) =>
    configMiddleware(esLatido).callbacks!.jwt!({ token } as never) as Promise<Record<string, unknown> | null>;

  it("sólo el latido renueva la actividad; una consulta cualquiera no", async () => {
    const viejo = Date.now() - 3 * MIN;
    expect((await jwt(false, { actividadEn: viejo, inactividadMin: 5 }))?.actividadEn).toBe(viejo);
    const conLatido = await jwt(true, { actividadEn: viejo, inactividadMin: 5 });
    expect(conLatido?.actividadEn as number).toBeGreaterThan(viejo);
  });

  it("pasado el límite descarta el token, también para el latido", async () => {
    const vencido = { actividadEn: Date.now() - 10 * MIN, inactividadMin: 5 };
    expect(await jwt(false, { ...vencido })).toBeNull();
    expect(await jwt(true, { ...vencido })).toBeNull();
  });

  it("un token anterior a la regla empieza a contar ahora", async () => {
    const t = await jwt(false, { sub: "u1" });
    expect(typeof t?.actividadEn).toBe("number");
  });
});
