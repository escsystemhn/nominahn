import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createWriteStream, createReadStream } from "node:fs";
import { flujoTar, inspeccionarTar } from "./tar";
import { cifradorOpenssl, descifradorOpenssl } from "./cifrado-openssl";
import { firmarS3, urlS3 } from "./s3";
import {
  CONFIG_POR_OMISION, aPodar, configPublica, debeIntentar, erroresDeConfig, esquemaConfig, nombreArchivo, proximoProgramado, vigentesEnCarpeta,
  recursoUnc, tocaRespaldo, ultimoProgramado, type ConfigRespaldos,
} from "./config";

const OPENSSL = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
const TAR = "C:\\Windows\\System32\\tar.exe";
const tmp = () => mkdtempSync(join(tmpdir(), "g360-test-"));

async function aBuffer(s: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const b of s) partes.push(typeof b === "string" ? Buffer.from(b) : b);
  return Buffer.concat(partes);
}

describe("TAR", () => {
  it("ida y vuelta: nombres (también largos y con tildes), tamaños, huellas y contenido", async () => {
    const dir = tmp();
    const grande = join(dir, "grande.bin");
    writeFileSync(grande, Buffer.alloc(70_000, 7));
    const largo = `adjuntos/${"carpeta-con-nombre-largo/".repeat(5)}contrato de trabajo de José Núñez.pdf`;
    const tar = await aBuffer(flujoTar([
      { nombre: "manifiesto.json", contenido: Buffer.from('{"ok":true}') },
      { nombre: "base/g360.dump", ruta: grande },
      { nombre: largo, contenido: Buffer.from("pdf") },
      { nombre: "vacio.txt", contenido: Buffer.alloc(0) },
    ]));
    expect(tar.length % 512).toBe(0);
    const miembros = await inspeccionarTar(Readable.from([tar.subarray(0, 700), tar.subarray(700, 5000), tar.subarray(5000)]), (n) => n === "manifiesto.json");
    expect(miembros.map((m) => [m.nombre, m.tamano])).toEqual([["manifiesto.json", 11], ["base/g360.dump", 70_000], [largo, 3], ["vacio.txt", 0]]);
    expect(miembros[0].contenido?.toString()).toBe('{"ok":true}');
  });

  it.skipIf(!existsSync(TAR))("lo abre el tar de Windows", async () => {
    const dir = tmp();
    const archivo = join(dir, "r.tar.gz");
    const largo = `adjuntos/${"x".repeat(120)}/año.txt`;
    await pipeline(flujoTar([{ nombre: "manifiesto.json", contenido: Buffer.from("{}") }, { nombre: largo, contenido: Buffer.from("hola") }]), createGzip(), createWriteStream(archivo));
    // Se extrae (listar imprime la «ñ» en la página de códigos de la consola).
    const destino = join(dir, "x");
    execFileSync("cmd", ["/c", "mkdir", destino]);
    execFileSync(TAR, ["-xzf", archivo, "-C", destino]);
    expect(readFileSync(join(destino, "manifiesto.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(destino, ...largo.split("/")), "utf8")).toBe("hola");
  });

  it("un archivo cortado no pasa por bueno", async () => {
    const tar = await aBuffer(flujoTar([{ nombre: "a.bin", contenido: Buffer.alloc(2000, 1) }]));
    await expect(inspeccionarTar(Readable.from([tar.subarray(0, 1200)]))).rejects.toThrow(/incompleto/);
  });
});

describe("cifrado compatible con OpenSSL", () => {
  it("ida y vuelta, y una contraseña equivocada no descifra", async () => {
    const claro = Buffer.from("respaldo de prueba ".repeat(1000));
    const cifrado = await aBuffer(Readable.from([claro]).pipe(cifradorOpenssl("una clave larga y buena")));
    expect(cifrado.subarray(0, 8).toString()).toBe("Salted__");
    expect(await aBuffer(Readable.from([cifrado]).pipe(descifradorOpenssl("una clave larga y buena")))).toEqual(claro);
    await expect(aBuffer(Readable.from([cifrado]).pipe(descifradorOpenssl("otra clave")))).rejects.toThrow(/no corresponde/);
  });

  it.skipIf(!existsSync(OPENSSL))("lo descifra el comando openssl, y al revés", async () => {
    const dir = tmp();
    const claro = Buffer.from("planilla de agosto, ñandú y tildes");
    const cifrado = join(dir, "x.enc");
    writeFileSync(cifrado, await aBuffer(Readable.from([claro]).pipe(cifradorOpenssl("Clave-De-Prueba-2026"))));
    const salida = execFileSync(OPENSSL, ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256", "-in", cifrado, "-pass", "pass:Clave-De-Prueba-2026"]);
    expect(salida).toEqual(claro);
    // Y lo que cifra openssl lo abre la app.
    const deOpenssl = join(dir, "y.enc");
    writeFileSync(join(dir, "claro.txt"), claro);
    execFileSync(OPENSSL, ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256", "-salt", "-in", join(dir, "claro.txt"), "-out", deOpenssl, "-pass", "pass:Clave-De-Prueba-2026"]);
    const vuelta = join(dir, "vuelta.txt");
    await pipeline(createReadStream(deOpenssl), descifradorOpenssl("Clave-De-Prueba-2026"), createWriteStream(vuelta));
    expect(readFileSync(vuelta)).toEqual(claro);
  });

  it("gzip + cifrado + tar: el respaldo completo se recorre de vuelta", async () => {
    const dir = tmp();
    const archivo = join(dir, "r.tar.gz.enc");
    await pipeline(flujoTar([{ nombre: "manifiesto.json", contenido: Buffer.from('{"v":1}') }]), createGzip(), cifradorOpenssl("clave-de-doce+"), createWriteStream(archivo));
    const m = await inspeccionarTar(createReadStream(archivo).pipe(descifradorOpenssl("clave-de-doce+")).pipe(createGunzip()), () => true);
    expect(m[0].contenido?.toString()).toBe('{"v":1}');
  });
});

describe("firma AWS SigV4 (ejemplos publicados por AWS)", () => {
  const credenciales = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", fecha: new Date("2013-05-24T00:00:00Z") };
  const VACIO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("GET objeto con Range", () => {
    const h = firmarS3({ ...credenciales, metodo: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), payloadHash: VACIO, headers: { Range: "bytes=0-9" } });
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("listar con parámetros de consulta", () => {
    const h = firmarS3({ ...credenciales, metodo: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"), payloadHash: VACIO });
    expect(h.authorization).toContain("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("URL con estilo de ruta o de dominio, con la clave codificada", () => {
    const d = { endpoint: "https://s3.us-west-004.backblazeb2.com", region: "us-west-004", bucket: "mi-bucket", accessKeyId: "k", secretAccessKey: "s", estiloRuta: true };
    expect(urlS3(d, "respaldos/g360 nómina.tar.gz").href).toBe("https://s3.us-west-004.backblazeb2.com/mi-bucket/respaldos/g360%20n%C3%B3mina.tar.gz");
    expect(urlS3({ ...d, endpoint: "https://s3.us-east-1.amazonaws.com", estiloRuta: false }, "a/b.enc").href).toBe("https://mi-bucket.s3.us-east-1.amazonaws.com/a/b.enc");
  });
});

describe("configuración y programación", () => {
  // 13/11/2026 15:00 en Honduras = 21:00 UTC.
  const AHORA = new Date("2026-11-13T21:00:00Z");

  it("diaria: lo programado más reciente y el siguiente, en hora de Honduras", () => {
    const p = { frecuencia: "DIARIA" as const, hora: "01:30", diaSemana: 0 };
    expect(ultimoProgramado(p, AHORA).toISOString()).toBe("2026-11-13T07:30:00.000Z");
    expect(proximoProgramado(p, AHORA).toISOString()).toBe("2026-11-14T07:30:00.000Z");
    expect(ultimoProgramado({ ...p, hora: "23:00" }, AHORA).toISOString()).toBe("2026-11-13T05:00:00.000Z"); // anoche
  });

  it("semanal: el último domingo a la hora elegida", () => {
    // 13/11/2026 es viernes; el domingo anterior, 08/11.
    expect(ultimoProgramado({ frecuencia: "SEMANAL", hora: "02:00", diaSemana: 0 }, AHORA).toISOString()).toBe("2026-11-08T08:00:00.000Z");
    expect(ultimoProgramado({ frecuencia: "SEMANAL", hora: "16:00", diaSemana: 5 }, AHORA).toISOString()).toBe("2026-11-06T22:00:00.000Z");
  });

  it("toca respaldar: una vez por hora programada, no antes de encenderlo, y recupera lo perdido una sola vez", () => {
    const p = { activo: true, frecuencia: "DIARIA" as const, hora: "01:30", diaSemana: 0, activadoEn: "2026-11-10T00:00:00Z" };
    expect(tocaRespaldo(p, null, AHORA)).toBe(true);
    expect(tocaRespaldo(p, new Date("2026-11-13T07:31:00Z"), AHORA)).toBe(false);
    expect(tocaRespaldo(p, new Date("2026-11-11T07:31:00Z"), AHORA)).toBe(true); // equipo apagado dos noches: uno solo
    expect(tocaRespaldo({ ...p, activadoEn: "2026-11-13T20:00:00Z" }, null, AHORA)).toBe(false); // se encendió hoy después de la 1:30
    expect(tocaRespaldo({ ...p, activo: false }, null, AHORA)).toBe(false);
  });

  it("nombres de archivo con la hora de Honduras, y la poda sólo toca los propios, los más viejos", () => {
    expect(nombreArchivo(AHORA, "MANUAL", true)).toBe("g360-nomina_2026-11-13_150000_manual.tar.gz.enc");
    const nombres = ["g360-nomina_2026-11-10_013000_automatico.tar.gz", "otro.zip", "g360-nomina_2026-11-12_013000_automatico.tar.gz", "g360-nomina_2026-11-11_013000_automatico.tar.gz.enc"];
    expect(aPodar(nombres, 2)).toEqual(["g360-nomina_2026-11-10_013000_automatico.tar.gz"]);
    expect(aPodar(nombres, 5)).toEqual([]);
  });

  it("una carpeta de red conserva los últimos envíos correctos a ella, según el historial", () => {
    const fila = (archivo: string | null, ...destinos: Array<{ destinoId: string; ok: boolean }>) => ({ archivo, destinos });
    const historial = [
      fila("e", { destinoId: "red", ok: false }, { destinoId: "loc", ok: true }), // no llegó a la red
      fila("d", { destinoId: "red", ok: true }),
      fila(null, { destinoId: "red", ok: true }), // falló antes de tener archivo
      fila("c", { destinoId: "red", ok: true }),
      fila("b", { destinoId: "red", ok: true }), // ya podado
      fila("a", null as unknown as { destinoId: string; ok: boolean }),
    ];
    expect([...vigentesEnCarpeta(historial, "red", 2)]).toEqual(["d", "c"]);
    expect([...vigentesEnCarpeta(historial, "otra", 2)]).toEqual([]);
  });

  it("la pantalla nunca recibe una clave", () => {
    const c: ConfigRespaldos = {
      ...CONFIG_POR_OMISION, claveCifrado: "cifrada",
      destinos: [
        { id: "r", nombre: "NAS", activo: true, tipo: "RED", ruta: "\\\\nas\\respaldos", usuario: "admin", clave: "cifrada" },
        { id: "n", nombre: "B2", activo: true, tipo: "NUBE", proveedor: "B2", endpoint: "https://s3.us-west-004.backblazeb2.com", region: "us-west-004", bucket: "b", prefijo: "", accessKeyId: "k", secretAccessKey: "cifrada", estiloRuta: true },
      ],
    };
    const texto = JSON.stringify(configPublica(c));
    expect(texto).not.toContain("cifrada");
    expect(configPublica(c).tieneClaveCifrado).toBe(true);
  });

  it("la nube exige cifrado y clave secreta; la contraseña de cifrado es larga", () => {
    const base = { automatico: { activo: false, frecuencia: "DIARIA" as const, hora: "01:30", diaSemana: 0 }, conservar: 7, incluirAdjuntos: true };
    const nube = { id: "n", nombre: "B2", activo: true, tipo: "NUBE" as const, proveedor: "B2" as const, endpoint: "https://s3.us-west-004.backblazeb2.com", region: "us-west-004", bucket: "mi-bucket", prefijo: "nomina", accessKeyId: "key", estiloRuta: true };
    const e = esquemaConfig.parse({ ...base, cifrar: false, destinos: [{ ...nube, secretAccessKey: "s" }] });
    expect(e.destinos[0].tipo === "NUBE" && e.destinos[0].prefijo).toBe("nomina/");
    expect(erroresDeConfig(e, CONFIG_POR_OMISION)).toEqual(["Un respaldo que sale a la nube debe ir cifrado: active el cifrado."]);
    const sinSecreto = esquemaConfig.parse({ ...base, cifrar: true, claveCifrado: "corta", destinos: [nube] });
    expect(erroresDeConfig(sinSecreto, CONFIG_POR_OMISION)).toEqual(["Falta la clave secreta de «B2».", "La contraseña de cifrado debe tener al menos 12 caracteres."]);
    expect(() => esquemaConfig.parse({ ...base, cifrar: false, destinos: [{ id: "l", nombre: "D", activo: true, tipo: "LOCAL", carpeta: "respaldos" }] })).toThrow(/ruta completa/);
    expect(() => esquemaConfig.parse({ ...base, cifrar: false, destinos: [{ id: "r", nombre: "NAS", activo: true, tipo: "RED", ruta: "nas/respaldos", usuario: null }] })).toThrow(/servidor/);
  });

  it("reintentos del automático: hasta 3 por horario, con una hora de espera", () => {
    const p = { activo: true, frecuencia: "DIARIA" as const, hora: "01:30", diaSemana: 0, activadoEn: "2026-11-01T00:00:00Z" };
    const fallo = (iso: string) => ({ fecha: new Date(iso), estado: "ERROR" });
    expect(debeIntentar(p, [], AHORA)).toBe(true);
    expect(debeIntentar(p, [fallo("2026-11-13T20:30:00Z")], AHORA)).toBe(false); // falló hace 30 min
    expect(debeIntentar(p, [fallo("2026-11-13T19:00:00Z")], AHORA)).toBe(true); // hace 2 h: se reintenta
    expect(debeIntentar(p, [fallo("2026-11-13T08:00:00Z"), fallo("2026-11-13T10:00:00Z"), fallo("2026-11-13T12:00:00Z")], AHORA)).toBe(false);
    expect(debeIntentar(p, [{ fecha: new Date("2026-11-13T07:31:00Z"), estado: "PARCIAL" }], AHORA)).toBe(false); // ya hubo uno bueno
    expect(debeIntentar(p, [{ fecha: new Date("2026-11-13T19:00:00Z"), estado: "EN_CURSO" }], AHORA)).toBe(false);
  });

  it("recurso de una ruta UNC", () => {
    expect(recursoUnc("\\\\nas01\\respaldos\\nomina\\2026")).toBe("\\\\nas01\\respaldos");
  });
});
