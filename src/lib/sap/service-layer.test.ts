import { describe, it, expect, vi } from "vitest";
import { ServiceLayer, leerCookies, literalOData, longitudesDesdeMetadata } from "./service-layer";
import { ErrorServiceLayer } from "./errores";

/** Service Layer de mentira: cuenta logins y exige la cookie en lo demás. */
function servidorFalso(opts: { caducarTras?: number; versionSap?: string } = {}) {
  let logins = 0;
  let llamadasConSesion = 0;
  const peticiones: Array<{ url: string; method: string; cookie: string | null; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (entrada, init) => {
    const url = String(entrada);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const cookie = headers.Cookie ?? null;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    peticiones.push({ url, method, cookie, body });

    if (url.endsWith("/Login")) {
      logins++;
      if (body?.Password !== "ok") {
        return new Response(JSON.stringify({ error: { code: -1, message: { value: "Invalid user name or password" } } }), { status: 401, headers: { "content-type": "application/json" } });
      }
      const h = new Headers({ "content-type": "application/json" });
      h.append("set-cookie", `B1SESSION=sesion-${logins}; Path=/b1s/v1; HttpOnly`);
      h.append("set-cookie", "ROUTEID=.node1; Path=/b1s");
      return new Response(JSON.stringify({ SessionId: `sesion-${logins}`, Version: opts.versionSap ?? "1000230", SessionTimeout: 30 }), { status: 200, headers: h });
    }
    if (url.endsWith("/Logout")) return new Response(null, { status: 204 });

    if (!cookie?.includes("B1SESSION=")) {
      return new Response(JSON.stringify({ error: { code: 301, message: { value: "Invalid session." } } }), { status: 401, headers: { "content-type": "application/json" } });
    }
    llamadasConSesion++;
    if (opts.caducarTras && llamadasConSesion === opts.caducarTras) {
      return new Response(JSON.stringify({ error: { code: 301, message: { value: "Invalid session." } } }), { status: 401, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/JournalEntries") && method === "POST") {
      return new Response(JSON.stringify({ JdtNum: 4321, Number: 1234, ...body }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/JournalEntries?")) {
      return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/ChartOfAccounts")) {
      return new Response(JSON.stringify({ value: [{ Code: "_SYS00000000123", Name: "Sueldos y salarios", FormatCode: "610201", ActiveAccount: "tYES" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/$metadata")) {
      return new Response(
        `<EntityType Name="JournalEntry"><Property Name="Memo" Type="Edm.String" MaxLength="50"/><Property Name="Reference" Type="Edm.String" MaxLength="100"/><Property Name="Reference2" Type="Edm.String" MaxLength="100"/></EntityType>` +
          `<EntityType Name="JournalEntryLine"><Property Name="LineMemo" Type="Edm.String" MaxLength="50"/></EntityType>`,
        { status: 200, headers: { "content-type": "application/xml" } }
      );
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, get logins() { return logins; }, peticiones };
}

const cfg = (fetchImpl: typeof fetch, password = "ok") => ({
  urlBase: "https://sap.local:50000/b1s/v1",
  companyDb: "SBO_PRUEBA",
  usuario: "nomina",
  password,
  fetchImpl,
});

describe("ServiceLayer", () => {
  it("entra una vez y reutiliza la sesión en las llamadas siguientes", async () => {
    const srv = servidorFalso();
    const sl = new ServiceLayer(cfg(srv.fetchImpl));
    await sl.buscarCuentas("6");
    await sl.buscarCuentas("61");
    await sl.crearAsiento({ Memo: "x" });
    expect(srv.logins).toBe(1);
    const conSesion = srv.peticiones.filter((p) => !p.url.endsWith("/Login"));
    expect(conSesion.every((p) => p.cookie === "B1SESSION=sesion-1; ROUTEID=.node1")).toBe(true);
    expect(sl.versionSap).toBe("1000230");
  });

  it("normaliza la URL base con y sin barra final", async () => {
    const srv = servidorFalso();
    await new ServiceLayer({ ...cfg(srv.fetchImpl), urlBase: "https://sap.local:50000/b1s/v1/" }).buscarCuentas("6");
    expect(srv.peticiones[0].url).toBe("https://sap.local:50000/b1s/v1/Login");
  });

  it("ante un 401 de sesión caducada vuelve a entrar UNA vez y repite la petición", async () => {
    const srv = servidorFalso({ caducarTras: 2 });
    const sl = new ServiceLayer(cfg(srv.fetchImpl));
    await sl.buscarCuentas("6");
    const r = await sl.crearAsiento({ Memo: "x" });
    expect(r.JdtNum).toBe(4321);
    expect(srv.logins).toBe(2);
    expect(srv.peticiones.at(-1)?.cookie).toBe("B1SESSION=sesion-2; ROUTEID=.node1");
  });

  it("credenciales malas: error 401 no reintentable como sesión", async () => {
    const srv = servidorFalso();
    const sl = new ServiceLayer(cfg(srv.fetchImpl, "mala"));
    await expect(sl.login()).rejects.toMatchObject({ http: 401, codigo: "-1", message: "Invalid user name or password" });
    // El 401 del propio Login no debe disparar un segundo login en cadena.
    await expect(sl.buscarCuentas("6")).rejects.toBeInstanceOf(ErrorServiceLayer);
    expect(srv.logins).toBe(2);
  });

  it("corta la petición al vencer el tiempo máximo", async () => {
    const fetchImpl: typeof fetch = (_u, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })));
      });
    const sl = new ServiceLayer({ ...cfg(fetchImpl), timeoutMs: 20 });
    await expect(sl.login()).rejects.toMatchObject({ http: 0, codigo: "TIMEOUT", transitorio: true });
  });

  it("envía el login con CompanyDB, UserName y Password y JSON en el cuerpo", async () => {
    const srv = servidorFalso();
    await new ServiceLayer(cfg(srv.fetchImpl)).login();
    expect(srv.peticiones[0]).toMatchObject({ method: "POST", body: { CompanyDB: "SBO_PRUEBA", UserName: "nomina", Password: "ok" } });
  });

  it("busca por Reference2 con el literal escapado y codificado", async () => {
    const srv = servidorFalso();
    await new ServiceLayer(cfg(srv.fetchImpl)).buscarAsientosPorReferencia2("abc'def");
    const url = srv.peticiones.at(-1)?.url ?? "";
    expect(url).toContain("$filter=Reference2 eq " + encodeURIComponent("'abc''def'"));
  });

  it("probar: entra, lee el plan y las longitudes, y sale", async () => {
    const srv = servidorFalso();
    const r = await new ServiceLayer(cfg(srv.fetchImpl)).probar();
    expect(r).toMatchObject({ version: "1000230", sessionTimeout: 30, cuentas: true, longitudes: { memo: 50, lineMemo: 50, referencia: 100 } });
    expect(srv.peticiones.at(-1)?.url).toMatch(/\/Logout$/);
  });

  it("logout tolera fallos y limpia la sesión", async () => {
    const srv = servidorFalso();
    const sl = new ServiceLayer(cfg(srv.fetchImpl));
    await sl.login();
    await sl.logout();
    expect(sl.versionSap).toBeNull();
    await sl.logout(); // sin sesión: no hace nada
    expect(srv.peticiones.filter((p) => p.url.endsWith("/Logout"))).toHaveLength(1);
  });
});

describe("ayudas", () => {
  it("literalOData duplica las comillas simples", () => {
    expect(literalOData("O'Brien")).toBe("'O''Brien'");
  });

  it("leerCookies usa getSetCookie cuando existe y cae a set-cookie plano", () => {
    const h = new Headers();
    h.append("set-cookie", "B1SESSION=abc; Path=/; HttpOnly");
    h.append("set-cookie", "ROUTEID=.n1; Path=/");
    expect(leerCookies(h)).toEqual({ B1SESSION: "abc", ROUTEID: ".n1" });

    const plano = { get: (n: string) => (n === "set-cookie" ? "B1SESSION=xyz; Path=/, ROUTEID=.n2; Path=/" : null) } as unknown as Headers;
    expect(leerCookies(plano)).toEqual({ B1SESSION: "xyz", ROUTEID: ".n2" });
  });

  it("longitudesDesdeMetadata toma MaxLength de cada entidad y el mínimo de las referencias", () => {
    const xml =
      `<EntityType Name="JournalEntry"><Property Name="Memo" MaxLength="60"/><Property Name="Reference" MaxLength="27"/><Property Name="Reference2" MaxLength="100"/></EntityType>` +
      `<EntityType Name="JournalEntryLine"><Property Name="LineMemo" MaxLength="40"/></EntityType>`;
    expect(longitudesDesdeMetadata(xml)).toEqual({ memo: 60, lineMemo: 40, referencia: 27 });
    expect(longitudesDesdeMetadata("")).toEqual({ memo: 50, lineMemo: 50, referencia: 100 });
  });
});

// vi queda importado para los tests que necesiten temporizadores falsos.
void vi;
