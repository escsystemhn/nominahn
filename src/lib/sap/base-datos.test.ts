import { describe, it, expect } from "vitest";
import { citar, configDriver, interpretarSonda, nombreBaseValido, traducirErrorSql, ErrorBaseDatos } from "./base-datos";
import { cambioDestinoBd, cambioDestinoSl } from "./credenciales";

const cfg = { servidor: "192.168.1.10", puerto: 1433, instancia: null, usuario: "nomina_lectura", password: "x", cifrar: false, confiarCertificado: true };

describe("nombres de base", () => {
  it("acepta los nombres habituales de SAP y rechaza lo que podría romper el SQL", () => {
    for (const n of ["SBO_EMPRESA", "SBO-COMMON", "Empresa 2026", "SBO.PRUEBA"]) expect(nombreBaseValido(n), n).toBe(true);
    for (const n of ["", " SBO", "SBO;DROP", "SBO]", "a".repeat(129), "SBO'X"]) expect(nombreBaseValido(n), n).toBe(false);
  });
  it("citar duplica el corchete de cierre", () => {
    expect(citar("SBO-COMMON")).toBe("[SBO-COMMON]");
    expect(citar("a]b")).toBe("[a]]b]");
  });
});

describe("configDriver", () => {
  it("puerto, tiempos cortos, intención de sólo lectura y nombre de aplicación", () => {
    const c = configDriver(cfg, "SBO_PRUEBA");
    expect(c).toMatchObject({ server: "192.168.1.10", port: 1433, user: "nomina_lectura", database: "SBO_PRUEBA", connectionTimeout: 15000, requestTimeout: 20000 });
    expect(c.options).toMatchObject({ encrypt: false, trustServerCertificate: true, readOnlyIntent: true, appName: "NominaHN" });
  });
  it("con instancia nombrada no manda puerto", () => {
    const c = configDriver({ ...cfg, instancia: "SAPB1" }, "SBO_PRUEBA");
    expect(c.port).toBeUndefined();
    expect(c.options?.instanceName).toBe("SAPB1");
  });
});

describe("interpretarSonda", () => {
  const base = { db: "SBO_PRUEBA", version: "Microsoft SQL Server 2022 (RTM)\n\tCopyright", login: "nomina_lectura", tieneOADM: 1, tieneOACT: 1, tieneOJDT: 1, tieneCINF: 1, insertar: 0, actualizar: 0, borrar: 0, alterar: 0 };

  it("base de SAP con usuario de lectura: sin avisos", () => {
    const r = interpretarSonda(base, { CompnyName: "Comercial del Valle ", MainCurncy: "L" }, "1000230", cfg, 42);
    expect(r).toMatchObject({ servidor: "192.168.1.10:1433", versionSql: "Microsoft SQL Server 2022 (RTM)", esBaseSap: true, empresa: "Comercial del Valle", moneda: "L", versionB1: "1000230", puedeEscribir: false, avisos: [], ms: 42 });
  });

  it("avisa si no es base de SAP, si el usuario puede escribir y si la moneda no es lempira", () => {
    const r = interpretarSonda({ ...base, tieneOJDT: 0, insertar: 1 }, { CompnyName: "X", MainCurncy: "USD" }, null, { ...cfg, instancia: "SAPB1" }, 1);
    expect(r.esBaseSap).toBe(false);
    expect(r.puedeEscribir).toBe(true);
    expect(r.servidor).toBe("192.168.1.10\\SAPB1");
    expect(r.avisos).toHaveLength(3);
    expect(r.avisos[0]).toMatch(/no tiene las tablas de SAP/);
    expect(r.avisos[1]).toMatch(/puede escribir/);
    expect(r.avisos[2]).toMatch(/moneda local de la empresa en SAP es USD/);
  });
});

describe("traducirErrorSql", () => {
  const ctx = { ...cfg, baseDatos: "SBO_PRUEBA" };
  const caso = (e: unknown) => traducirErrorSql(e, ctx);

  it("login, base inexistente, permiso, instancia, certificado y red", () => {
    expect(caso({ code: "ELOGIN", originalError: { info: { number: 18456 } }, message: "Login failed for user 'nomina_lectura'." })).toMatchObject({ codigo: "LOGIN" });
    expect(caso({ code: "ELOGIN", message: "Cannot open database \"SBO_X\" requested by the login." }).codigo).toBe("BASE");
    expect(caso({ number: 229, message: "The SELECT permission was denied on the object 'SRGC'" }).codigo).toBe("PERMISO");
    expect(caso({ code: "EINSTLOOKUP", message: "Port for SAPB1 not found in ServerName" }).codigo).toBe("INSTANCIA");
    expect(caso({ code: "ESOCKET", message: "self-signed certificate in certificate chain" }).codigo).toBe("TLS");
    expect(caso({ code: "ESOCKET", message: "Failed to connect to 192.168.1.10:1433 - connect ECONNREFUSED" })).toMatchObject({ codigo: "RED" });
    expect(caso({ code: "ETIMEOUT", message: "Failed to connect in 15000ms" }).message).toMatch(/No se alcanza SQL Server en 192.168.1.10:1433/);
  });

  it("conserva el detalle técnico y no re-traduce un error ya traducido", () => {
    const e = caso({ code: "ELOGIN", number: 18456, message: "Login failed" });
    expect(e.detalle).toBe("ELOGIN 18456: Login failed");
    const propio = new ErrorBaseDatos("NOMBRE", "x");
    expect(caso(propio)).toBe(propio);
  });
});

describe("cuándo se reutiliza la contraseña guardada", () => {
  it("Service Layer: sólo con la misma URL (sin importar la barra final ni mayúsculas)", () => {
    expect(cambioDestinoSl({ urlBase: "https://SAP:50000/b1s/v1/" }, { urlBase: "https://sap:50000/b1s/v1" })).toBe(false);
    expect(cambioDestinoSl({ urlBase: "https://otro:50000/b1s/v1/" }, { urlBase: "https://sap:50000/b1s/v1/" })).toBe(true);
    expect(cambioDestinoSl({ urlBase: "https://otro:50000/b1s/v1/" }, null)).toBe(false);
  });
  it("Base de datos: servidor, puerto e instancia", () => {
    const g = { servidor: "SRV-SAP", puerto: 1433, instancia: null };
    expect(cambioDestinoBd({ servidor: "srv-sap", puerto: 1433, instancia: "" }, g)).toBe(false);
    expect(cambioDestinoBd({ servidor: "srv-sap", puerto: 1434, instancia: null }, g)).toBe(true);
    expect(cambioDestinoBd({ servidor: "srv-sap", puerto: 1433, instancia: "SAPB1" }, g)).toBe(true);
    expect(cambioDestinoBd({ servidor: "otro", puerto: 1433, instancia: null }, g)).toBe(true);
    expect(cambioDestinoBd({ servidor: "otro", puerto: 1433, instancia: null }, { servidor: null, puerto: 1433, instancia: null })).toBe(false);
  });
});
