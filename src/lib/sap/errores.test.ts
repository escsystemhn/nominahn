import { describe, it, expect } from "vitest";
import { ErrorServiceLayer, errorDeRed, errorDeRespuesta, traducir } from "./errores";

describe("errorDeRespuesta", () => {
  it("lee código y mensaje del error OData del Service Layer", () => {
    const e = errorDeRespuesta(400, { error: { code: -5002, message: { lang: "en-us", value: "Posting period is locked" } } });
    expect(e).toBeInstanceOf(ErrorServiceLayer);
    expect(e.http).toBe(400);
    expect(e.codigo).toBe("-5002");
    expect(e.message).toBe("Posting period is locked");
    expect(e.transitorio).toBe(false);
  });

  it("acepta mensaje como texto plano", () => {
    const e = errorDeRespuesta(400, { error: { code: "X", message: "texto" } });
    expect(e.message).toBe("texto");
  });

  it("clasifica 401, 429 y 5xx como transitorios, y 400/403/404 como de negocio", () => {
    expect(errorDeRespuesta(401, null).transitorio).toBe(true);
    expect(errorDeRespuesta(429, null).transitorio).toBe(true);
    expect(errorDeRespuesta(502, "Bad Gateway").transitorio).toBe(true);
    expect(errorDeRespuesta(500, null).transitorio).toBe(true);
    expect(errorDeRespuesta(400, null).transitorio).toBe(false);
    expect(errorDeRespuesta(403, null).transitorio).toBe(false);
    expect(errorDeRespuesta(404, null).transitorio).toBe(false);
  });

  it("usa el cuerpo de texto (recortado) cuando no es JSON", () => {
    const e = errorDeRespuesta(502, "  <html>Bad Gateway</html>  ");
    expect(e.message).toBe("<html>Bad Gateway</html>");
    expect(e.codigo).toBe("502");
  });
});

describe("errorDeRed", () => {
  it("es siempre transitorio y conserva el código de Node", () => {
    const e = errorDeRed(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    expect(e.http).toBe(0);
    expect(e.codigo).toBe("ECONNREFUSED");
    expect(e.transitorio).toBe(true);
  });

  it("reconoce el código anidado en cause (fetch de undici)", () => {
    const e = errorDeRed(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }));
    expect(e.codigo).toBe("ENOTFOUND");
  });

  it("marca el abort del temporizador como TIMEOUT", () => {
    const e = errorDeRed(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    expect(e.codigo).toBe("TIMEOUT");
  });
});

describe("traducir", () => {
  const err = (http: number, mensaje: string, codigo = "x") => new ErrorServiceLayer({ http, codigo, mensaje, transitorio: false });

  it("red caída → revisar red/VPN, con el host", () => {
    const t = traducir(errorDeRed({ code: "ECONNREFUSED", message: "x" }), { host: "sap.local:50000" });
    expect(t).toMatch(/No se alcanza el Service Layer en sap.local:50000/);
  });

  it("401 de login → credenciales; 401 de sesión → se reconecta", () => {
    expect(traducir(err(401, "Invalid user name or password", "-1"), { usuario: "nomina" })).toMatch(/rechazó las credenciales del usuario nomina/);
    expect(traducir(err(401, "Invalid session.", "301"))).toMatch(/sesión con SAP caducó/);
  });

  it("período cerrado → mensaje con la fecha", () => {
    expect(traducir(err(400, "Posting period is locked [JDT1.RefDate]"), { fecha: "2026-09-30" })).toMatch(/período contable de SAP está cerrado para el 2026-09-30/);
    expect(traducir(err(400, "Date deviates from permissible range"))).toMatch(/período contable/);
  });

  it("cuenta inactiva o inexistente → corregir el mapeo", () => {
    expect(traducir(err(400, "Account is not active [JDT1.Account]"))).toMatch(/inactiva o es de título en SAP/);
    expect(traducir(err(400, "Invalid account code [JDT1.Account][line: 2]"))).toMatch(/no existe en SAP/);
  });

  it("dimensión obligatoria → revisar centros de costo", () => {
    expect(traducir(err(400, "Distribution rule is mandatory for this account"))).toMatch(/centro de costo/);
  });

  it("5xx → se reintenta más tarde", () => {
    expect(traducir(errorDeRespuesta(503, null))).toMatch(/HTTP 503.*se reintenta/);
  });

  it("sin patrón → mensaje original con el código", () => {
    expect(traducir(err(400, "Something odd happened", "-9999"))).toBe("SAP devolvió un error (-9999): Something odd happened");
  });
});
