import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "crypto";
import { verificarArchivoActivacion, normalizarLlave, hashEquipo, type ClaimsActivacion } from "./sdl";

/** Firma un archivo como lo hace SDL: Ed25519 sobre los bytes ASCII de `SDL1.<payload>`. */
function emitir(claims: Partial<ClaimsActivacion>, privada: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const firmado = `SDL1.${payload}`;
  return `${firmado}.${sign(null, Buffer.from(firmado, "ascii"), privada).toString("base64url")}`;
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KID = "a1b2c3d4e5f60718";
const CLAVES = { [KID]: publicKey.export({ format: "jwk" }).x as string };
const EQUIPO = "1A2B-3C4D-5E6F-7A8B";
const AHORA = Date.parse("2026-10-19T12:00:00Z");

const base: Partial<ClaimsActivacion> = {
  v: 1,
  typ: "sdl-activation",
  kid: KID,
  product: "NOMI",
  customer: "Comercial Los Pinos",
  fingerprint_hash: hashEquipo(EQUIPO),
  issued_at: "2026-10-19T00:00:00Z",
  expires_at: "2027-10-19T06:00:00Z",
  refresh_before: null,
};

const verificar = (token: string) =>
  verificarArchivoActivacion(token, { claves: CLAVES, producto: "NOMI", codigoEquipo: EQUIPO, ahora: AHORA });

describe("verificarArchivoActivacion", () => {
  it("acepta un archivo de SDL para este producto y este equipo", () => {
    const r = verificar(emitir(base, privateKey));
    expect(r.ok).toBe(true);
  });

  it("el código de equipo se compara sin guiones ni mayúsculas", () => {
    const r = verificarArchivoActivacion(emitir(base, privateKey), {
      claves: CLAVES, producto: "NOMI", codigoEquipo: "1a2b3c4d5e6f7a8b", ahora: AHORA,
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza un archivo firmado con otra clave aunque el kid coincida", () => {
    const ajena = generateKeyPairSync("ed25519").privateKey;
    expect(verificar(emitir(base, ajena))).toEqual({ ok: false, error: "firma_invalida" });
  });

  it("rechaza un payload modificado", () => {
    const [p, datos, firma] = emitir(base, privateKey).split(".");
    const json = JSON.parse(Buffer.from(datos, "base64url").toString());
    json.expires_at = null;
    const editado = `${p}.${Buffer.from(JSON.stringify(json)).toString("base64url")}.${firma}`;
    expect(verificar(editado)).toEqual({ ok: false, error: "firma_invalida" });
  });

  it("rechaza un kid desconocido, otro producto, otro equipo y un archivo vencido", () => {
    expect(verificar(emitir({ ...base, kid: "ffff" }, privateKey))).toEqual({ ok: false, error: "clave_desconocida" });
    expect(verificar(emitir({ ...base, product: "FACT" }, privateKey))).toEqual({ ok: false, error: "otro_producto" });
    expect(verificar(emitir({ ...base, fingerprint_hash: hashEquipo("9999-9999-9999-9999") }, privateKey))).toEqual({
      ok: false, error: "otro_equipo",
    });
    expect(verificar(emitir({ ...base, expires_at: "2026-10-01T06:00:00Z" }, privateKey))).toEqual({
      ok: false, error: "vencida",
    });
  });

  it("una licencia perpetua no vence", () => {
    expect(verificar(emitir({ ...base, expires_at: null }, privateKey)).ok).toBe(true);
  });

  it("rechaza lo que no es un archivo SDL1", () => {
    expect(verificar("hola")).toEqual({ ok: false, error: "formato" });
    expect(verificar("SDL1.no-es-json.xx")).toEqual({ ok: false, error: "formato" });
  });
});

describe("normalizarLlave", () => {
  const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  /** Arma una llave válida: el último símbolo cierra la suma ponderada en múltiplo de 31. */
  function llaveValida(prefijo: string, quince: string): string {
    let suma = 0;
    for (let i = 0; i < 15; i++) suma += (i + 1) * ALFABETO.indexOf(quince[i]);
    // 16 · 2 ≡ 1 (mód 31): el inverso de 16 es 2.
    const control = ALFABETO[(((-suma * 2) % 31) + 31) % 31];
    return prefijo + quince + control;
  }

  it("acepta la llave como la escriba el cliente y la devuelve canónica", () => {
    const cruda = llaveValida("NOMI", "7KQ9M2XHR4TBW8N");
    const canonica = normalizarLlave(cruda);
    expect(canonica).toMatch(/^NOMI-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(normalizarLlave(` ${cruda.toLowerCase().replace(/(.{4})/g, "$1 ")} `)).toBe(canonica);
  });

  it("detecta un carácter cambiado y dos transpuestos", () => {
    const cruda = llaveValida("NOMI", "7KQ9M2XHR4TBW8N");
    const cambiado = cruda.slice(0, 6) + (cruda[6] === "Q" ? "R" : "Q") + cruda.slice(7);
    const transpuesto = cruda.slice(0, 5) + cruda[6] + cruda[5] + cruda.slice(7);
    expect(normalizarLlave(cambiado)).toBeNull();
    expect(normalizarLlave(transpuesto)).toBeNull();
  });

  it("rechaza los caracteres que se confunden (0, O, 1, I, L)", () => {
    expect(normalizarLlave("NOMI-0000-0000-0000-0000")).toBeNull();
  });
});
