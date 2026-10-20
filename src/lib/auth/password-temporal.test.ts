/**
 * El bloqueo por contraseña temporal, comprobado en las dos capas que lo
 * imponen: las guardias de API y el encierro de páginas del middleware.
 *
 * Lo que se prueba aquí no es el mensaje, es la FORMA del candado: que cierre
 * todo, que deje abierta exactamente una salida, y que esa salida sea la que
 * desbloquea. Un candado sin salida deja la cuenta muerta; una salida de más lo
 * convierte en un adorno.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Sesión que devuelve `auth()` en cada caso. */
let sesion: unknown = null;

vi.mock("@/lib/auth", () => ({ auth: async () => sesion }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

const { requerirPermiso, requerirSesion, requerirPermisoPagina, tienePasswordTemporal } =
  await import("./guard");

const CON_TEMPORAL = {
  user: { id: "u1", email: "a@b.hn", permisos: ["*"], debeCambiarPassword: true },
};
const NORMAL = {
  user: { id: "u1", email: "a@b.hn", permisos: ["*"], debeCambiarPassword: false },
};

/** Destino al que redirigió una guardia de página, o `null` si dejó pasar. */
async function destinoDe(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec(e instanceof Error ? e.message : "");
    if (m) return m[1];
    throw e;
  }
}

beforeEach(() => {
  sesion = null;
});

describe("tienePasswordTemporal", () => {
  it("distingue la marca de su ausencia", () => {
    expect(tienePasswordTemporal({ debeCambiarPassword: true })).toBe(true);
    expect(tienePasswordTemporal({ debeCambiarPassword: false })).toBe(false);
    expect(tienePasswordTemporal({})).toBe(false);
    expect(tienePasswordTemporal(undefined)).toBe(false);
  });
});

describe("requerirPermiso", () => {
  it("bloquea aunque la cuenta tenga TODOS los permisos", async () => {
    sesion = CON_TEMPORAL;
    const g = await requerirPermiso("planillas.pagar");
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.response.status).toBe(403);
      expect(await g.response.json()).toMatchObject({ codigo: "PASSWORD_TEMPORAL" });
    }
  });

  it("deja pasar cuando la contraseña ya es propia", async () => {
    sesion = NORMAL;
    expect((await requerirPermiso("planillas.pagar")).ok).toBe(true);
  });

  /**
   * El orden importa: si el permiso se comprobara primero, la respuesta sería
   * "permiso insuficiente" y quien tiene el permiso pero no ha cambiado su clave
   * recibiría un mensaje que no explica nada.
   */
  it("el bloqueo se evalúa antes que el permiso", async () => {
    sesion = { user: { id: "u1", permisos: [], debeCambiarPassword: true } };
    const g = await requerirPermiso("planillas.pagar");
    expect(g.ok).toBe(false);
    if (!g.ok) expect((await g.response.json()).codigo).toBe("PASSWORD_TEMPORAL");
  });

  it("sin sesión sigue siendo 401, no 403", async () => {
    sesion = null;
    const g = await requerirPermiso("planillas.ver");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
  });
});

describe("requerirSesion", () => {
  it("bloquea los recursos propios: sus boletas, sus datos", async () => {
    sesion = CON_TEMPORAL;
    expect((await requerirSesion()).ok).toBe(false);
  });

  /**
   * La única excepción, y la razón de que exista: es la ruta que quita el
   * bloqueo. Cerrarla también dejaría la cuenta sin forma de desbloquearse.
   */
  it("deja pasar SÓLO a quien lo pide explícitamente", async () => {
    sesion = CON_TEMPORAL;
    expect((await requerirSesion({ permitirPasswordTemporal: true })).ok).toBe(true);
  });

  it("la excepción no debilita el caso sin sesión", async () => {
    sesion = null;
    const g = await requerirSesion({ permitirPasswordTemporal: true });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
  });
});

describe("requerirPermisoPagina", () => {
  it("lleva a /mi-cuenta, no a /mi-espacio ni a un error", async () => {
    sesion = CON_TEMPORAL;
    expect(await destinoDe(() => requerirPermisoPagina("empleados.ver"))).toBe("/mi-cuenta");
  });

  it("sin permiso y sin bloqueo, el destino sigue siendo /mi-espacio", async () => {
    sesion = { user: { id: "u1", permisos: [], debeCambiarPassword: false } };
    expect(await destinoDe(() => requerirPermisoPagina("empleados.ver"))).toBe("/mi-espacio");
  });

  it("con la contraseña ya cambiada, no redirige", async () => {
    sesion = NORMAL;
    expect(await destinoDe(() => requerirPermisoPagina("empleados.ver"))).toBe(null);
  });
});
