import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { autorizacionDigest, DriverHikvision, eventoDe, fechaIsapi, leerDesafio, paredDe } from "./hikvision";

describe("Digest", () => {
  it("da la respuesta del ejemplo del RFC 2617 (sección 3.5)", () => {
    const h = autorizacionDigest({
      usuario: "Mufasa", password: "Circle Of Life", metodo: "GET", uri: "/dir/index.html", nc: 1, cnonce: "0a4f113b",
      desafio: { realm: "testrealm@host.com", nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093", qop: "auth,auth-int", opaque: "5ccc069c403ebaf9f0171e9517f40e41" },
    });
    expect(h).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(h).toContain("qop=auth, nc=00000001");
  });

  it("lee la cabecera que respondió el reloj de Edbin (AC-FEW, 2026-11-24)", () => {
    expect(leerDesafio('Digest qop="auth", realm="DS-8C731EC7", nonce="abc==", stale="false", opaque="xyz", domain="::"'))
      .toEqual({ realm: "DS-8C731EC7", nonce: "abc==", qop: "auth", opaque: "xyz", algorithm: undefined, stale: false });
    expect(leerDesafio('Basic realm="x"')).toBeNull();
  });
});

describe("fechas y eventos", () => {
  it("las fechas de la consulta van en la hora del equipo, con su zona", () => {
    expect(fechaIsapi(new Date("2026-11-24T14:00:05Z"), -360)).toBe("2026-11-24T08:00:05-06:00");
    expect(fechaIsapi(new Date("2026-11-24T00:30:00Z"), -360)).toBe("2026-11-23T18:30:00-06:00");
  });

  it("la hora de pared del evento, sin aplicarle la zona", () => {
    expect(paredDe("2026-11-24T08:01:02-06:00")).toEqual({ anio: 2026, mes: 11, dia: 24, hora: 8, minuto: 1, segundo: 2 });
    expect(paredDe("raro")).toBeNull();
  });

  it("una marca es un evento de control de acceso de una persona identificada", () => {
    const e = eventoDe({ major: 5, minor: 75, time: "2026-11-24T08:01:02-06:00", employeeNoString: "12", currentVerifyMode: "cardOrFaceOrFp", attendanceStatus: "checkIn" });
    expect(e).toMatchObject({ pin: "12", tipo: "ENTRADA", verificacion: "cardOrFaceOrFp (minor 75)", pared: { hora: 8, minuto: 1 } });
    expect(eventoDe({ major: 5, minor: 76, time: "2026-11-24T08:01:02-06:00" })).toBeNull(); // rostro desconocido
    expect(eventoDe({ major: 2, minor: 1024, time: "2026-11-24T08:01:02-06:00", employeeNoString: "12" })).toBeNull(); // no es de acceso
    expect(eventoDe({ major: 5, minor: 1, time: "2026-11-24T17:00:00-06:00", employeeNo: 7 })?.pin).toBe("7");
    expect(eventoDe({ major: 5, minor: 75, time: "2026-11-24T17:00:00-06:00", employeeNoString: "7", attendanceStatus: "breakOut" })?.tipo).toBeUndefined();
  });
});

// ─── Un reloj simulado: Digest, capacidades, páginas y bloqueo ────────────────

const REALM = "DS-PRUEBA";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const EVENTOS = [
  { major: 5, minor: 75, time: "2026-11-24T07:58:00-06:00", employeeNoString: "1", currentVerifyMode: "face" },
  { major: 5, minor: 76, time: "2026-11-24T07:59:00-06:00" },
  { major: 5, minor: 75, time: "2026-11-24T08:02:00-06:00", employeeNoString: "2", currentVerifyMode: "face" },
  { major: 5, minor: 21, time: "2026-11-24T08:02:01-06:00" },
  { major: 5, minor: 38, time: "2026-11-24T12:00:00-06:00", employeeNoString: "1", currentVerifyMode: "fp" },
  { major: 5, minor: 75, time: "2026-11-24T17:01:00-06:00", employeeNoString: "2", currentVerifyMode: "face" },
  { major: 5, minor: 75, time: "2026-11-24T17:05:00-06:00", employeeNoString: "1", currentVerifyMode: "face" },
];

let servidor: Server;
let puerto = 0;
const estado = { fallidos: 0, nonce: "n1", usos: 0, rotarCada: 0, cuerpos: [] as Array<Record<string, unknown>> };

/** Verifica la cabecera con su propio cálculo (MD5, qop=auth), sin usar el del conector. */
function autenticado(cabecera: string | undefined, metodo: string): boolean | "stale" {
  if (!cabecera?.startsWith("Digest ")) return false;
  const c = Object.fromEntries([...cabecera.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1], m[2] ?? m[3]]));
  if (c.nonce !== estado.nonce) return "stale";
  const ha1 = md5(`admin:${REALM}:clave-buena`);
  const ha2 = md5(`${metodo}:${c.uri}`);
  return c.response === md5(`${ha1}:${c.nonce}:${c.nc}:${c.cnonce}:auth:${ha2}`);
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      const desafio = (stale = false) => `Digest qop="auth", realm="${REALM}", nonce="${estado.nonce}", stale="${stale}", opaque="o"`;
      const ok = autenticado(req.headers.authorization, req.method!);
      if (ok !== true) {
        if (req.headers.authorization && ok === false) estado.fallidos++;
        res.writeHead(401, { "WWW-Authenticate": desafio(ok === "stale") }).end("");
        return;
      }
      if (estado.rotarCada && ++estado.usos % estado.rotarCada === 0) estado.nonce = `n${estado.usos}`;
      if (req.url === "/ISAPI/System/deviceInfo") {
        res.writeHead(200, { "Content-Type": "application/xml" }).end("<DeviceInfo><model>AC-FEW</model><serialNumber>K0000</serialNumber><firmwareVersion>V3.3.4 build 220318</firmwareVersion></DeviceInfo>");
        return;
      }
      if (req.url === "/ISAPI/AccessControl/AcsEvent/capabilities?format=json") {
        res.writeHead(200).end(JSON.stringify({ AcsEvent: { AcsEventCond: { maxResults: { "@min": 1, "@max": 3 } } } }));
        return;
      }
      if (req.url === "/ISAPI/AccessControl/AcsEvent?format=json" && req.method === "POST") {
        const c = JSON.parse(cuerpo).AcsEventCond;
        estado.cuerpos.push(c);
        // Como los equipos reales: sin fechas con zona, o con más de su tope, «badParameters».
        if (!/[+-]\d{2}:\d{2}$/.test(c.startTime ?? "") || !/[+-]\d{2}:\d{2}$/.test(c.endTime ?? "") || c.maxResults > 3) {
          res.writeHead(400).end(JSON.stringify({ statusCode: 6, statusString: "Invalid Content", subStatusCode: "badParameters" }));
          return;
        }
        const pagina = EVENTOS.slice(c.searchResultPosition, c.searchResultPosition + c.maxResults);
        const quedan = c.searchResultPosition + pagina.length < EVENTOS.length;
        res.writeHead(200).end(JSON.stringify({ AcsEvent: { searchID: c.searchID, totalMatches: EVENTOS.length, numOfMatches: pagina.length, responseStatusStrg: quedan ? "MORE" : "OK", InfoList: pagina } }));
        return;
      }
      res.writeHead(404).end(JSON.stringify({ statusCode: 4, statusString: "Invalid Operation", subStatusCode: "notSupport" }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  puerto = (servidor.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

const driver = (password = "clave-buena") => new DriverHikvision({ ip: "127.0.0.1", puerto, usuario: "admin", password, offsetMinutos: -360, tiempoMs: 3000 });

describe("contra un reloj simulado", () => {
  it("«Probar conexión» dice qué equipo es y que entrega las marcas", async () => {
    const r = await driver().probar();
    expect(r.ok).toBe(true);
    expect(r.detalle).toContain("AC-FEW, serie K0000, firmware V3.3.4 build 220318");
    expect(r.detalle).toContain("hasta 3 por consulta");
  });

  it("lee todas las páginas y sólo las marcas de personas identificadas", async () => {
    estado.cuerpos = [];
    const eventos = await driver().leerEventos(new Date("2026-11-24T06:00:00Z"));
    expect(eventos.map((e) => `${e.pin}@${e.pared.hora}:${e.pared.minuto}`)).toEqual(["1@7:58", "2@8:2", "1@12:0", "2@17:1", "1@17:5"]);
    expect(estado.cuerpos.map((c) => c.searchResultPosition)).toEqual([0, 3, 6]);
    expect(new Set(estado.cuerpos.map((c) => c.searchID)).size).toBe(1);
    expect(estado.cuerpos[0]).toMatchObject({ major: 5, minor: 0, maxResults: 3, startTime: "2026-11-23T23:59:00-06:00" });
  });

  it("con la contraseña equivocada no reintenta: un solo intento fallido", async () => {
    estado.fallidos = 0;
    const r = await driver("mala").probar();
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain("rechazó el usuario o la contraseña");
    expect(estado.fallidos).toBe(1);
    await expect(driver("mala").leerEventos(null)).rejects.toThrow("rechazó el usuario o la contraseña");
    expect(estado.fallidos).toBe(2);
  });

  it("si el nonce vence a media lectura, sigue", async () => {
    estado.rotarCada = 2;
    try {
      const eventos = await driver().leerEventos(null);
      expect(eventos).toHaveLength(5);
    } finally {
      estado.rotarCada = 0;
      estado.nonce = "n1";
    }
  });

  it("sin usuario o contraseña lo dice antes de tocar el equipo", async () => {
    const r = await new DriverHikvision({ ip: "127.0.0.1", puerto, usuario: "admin", password: null, offsetMinutos: -360 }).probar();
    expect(r).toEqual({ ok: false, detalle: "Falta el usuario o la contraseña del equipo: agréguelos en «Editar»." });
  });

  it("un puerto cerrado se explica", async () => {
    const cerrado = createServer();
    await new Promise<void>((r) => cerrado.listen(0, "127.0.0.1", r));
    const p = (cerrado.address() as AddressInfo).port;
    await new Promise<void>((r) => cerrado.close(() => r()));
    const r = await new DriverHikvision({ ip: "127.0.0.1", puerto: p, usuario: "admin", password: "x", offsetMinutos: -360, tiempoMs: 2000 }).probar();
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/rechazó la conexión|no contestó a tiempo/);
  });
});
