/**
 * Copiar un respaldo a cada destino (disco local, carpeta de red, nube S3), podar los
 * que sobran y probar la conexión. SERVIDOR.
 */

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { descifrar } from "@/lib/seguridad/cifrado";
import { aPodar, PREFIJO_ARCHIVO, recursoUnc, vigentesEnCarpeta, type Destino, type DestinoNube, type DestinoRed } from "./config";
import { borrarObjeto, listarObjetos, subirObjeto, subirTexto, type DestinoS3 } from "./s3";

export interface ResultadoDestino {
  destinoId: string;
  nombre: string;
  tipo: Destino["tipo"];
  ok: boolean;
  error?: string;
  /** Dónde quedó: carpeta o bucket/clave. */
  ubicacion?: string;
  podados?: number;
}

const enWindows = process.platform === "win32";

function correr(exe: string, args: string[], timeoutMs = 60_000): Promise<{ codigo: number; salida: string }> {
  return new Promise((resolver) => {
    const p = spawn(exe, args, { windowsHide: true });
    let salida = "";
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on("data", (b: Buffer) => { salida += b.toString(); });
    p.stderr.on("data", (b: Buffer) => { salida += b.toString(); });
    p.on("error", (e) => { clearTimeout(t); resolver({ codigo: -1, salida: e.message }); });
    p.on("close", (codigo) => { clearTimeout(t); resolver({ codigo: codigo ?? -1, salida }); });
  });
}

/**
 * Con usuario, conecta la carpeta compartida con `net use` (sin unidad, sin
 * guardarla) y devuelve cómo desconectarla. Sin usuario se usa la identidad del
 * servicio: la del equipo en un dominio.
 */
async function conectarRed(d: DestinoRed): Promise<() => Promise<void>> {
  if (!enWindows) throw new Error("La carpeta de red se usa en la instalación de Windows. En Linux, monte la carpeta y elija «Disco local».");
  if (!d.usuario) return async () => {};
  const recurso = recursoUnc(d.ruta);
  const clave = d.clave ? descifrar(d.clave) : "";
  const r = await correr("net", ["use", recurso, clave, `/user:${d.usuario}`, "/persistent:no"]);
  // «Error de sistema 53» / «System error 53». El 1219 es que ya hay una conexión a ese
  // servidor con otro usuario: se sigue y, si no tiene acceso, falla la copia.
  const codigo = /(?:error de sistema|system error)\s+(\d+)/i.exec(r.salida)?.[1];
  if (r.codigo !== 0 && codigo !== "1219") {
    const MOTIVOS: Record<string, string> = {
      "5": "acceso denegado", "53": "no se encontró el servidor", "67": "no se encontró la carpeta compartida",
      "86": "contraseña incorrecta", "1326": "usuario o contraseña incorrectos", "1909": "la cuenta está bloqueada",
    };
    const motivo = (codigo && MOTIVOS[codigo]) ?? r.salida.trim().split(/\r?\n/).filter(Boolean).pop() ?? `error ${r.codigo}`;
    throw new Error(`No se pudo conectar ${recurso}: ${motivo}.`);
  }
  return async () => { await correr("net", ["use", recurso, "/delete", "/y"]); };
}

function s3De(d: DestinoNube): DestinoS3 {
  if (!d.secretAccessKey) throw new Error("Falta la clave secreta.");
  return { endpoint: d.endpoint, region: d.region, bucket: d.bucket, accessKeyId: d.accessKeyId, secretAccessKey: descifrar(d.secretAccessKey), estiloRuta: d.estiloRuta };
}

async function aCarpeta(carpeta: string, archivo: string, nombre: string, conservar: number): Promise<{ ubicacion: string; podados: number }> {
  await mkdir(carpeta, { recursive: true });
  const destino = join(carpeta, nombre);
  await copyFile(archivo, destino);
  const [a, b] = await Promise.all([stat(archivo), stat(destino)]);
  if (a.size !== b.size) throw new Error("La copia quedó incompleta.");
  const sobran = aPodar(await readdir(carpeta), conservar);
  for (const f of sobran) await rm(join(carpeta, f), { force: true });
  return { ubicacion: destino, podados: sobran.length };
}

function textoError(e: unknown, d: Destino): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/EACCES|EPERM/.test(m)) return `Sin permiso para escribir en ${d.tipo === "NUBE" ? "el bucket" : "la carpeta"}. En la instalación de Windows, dé permiso de modificar a «NT SERVICE\\G360NominaApp».`;
  if (/ENOENT/.test(m) && d.tipo === "RED") return "No se encontró la ruta de red.";
  if (/ENOSPC/.test(m)) return "No hay espacio en el disco de destino.";
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return "No se encontró el servidor (revise el endpoint o la conexión a internet).";
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(m)) return "No se pudo conectar con el servidor.";
  return m;
}

/** Copia el respaldo al destino y poda los más viejos. Nunca lanza: devuelve el resultado. */
export async function enviarADestino(d: Destino, archivo: string, nombre: string, conservar: number): Promise<ResultadoDestino> {
  const base = { destinoId: d.id, nombre: d.nombre, tipo: d.tipo };
  try {
    if (d.tipo === "LOCAL") return { ...base, ok: true, ...(await aCarpeta(d.carpeta, archivo, nombre, conservar)) };
    if (d.tipo === "RED") {
      const desconectar = await conectarRed(d);
      try {
        return { ...base, ok: true, ...(await aCarpeta(d.ruta, archivo, nombre, conservar)) };
      } finally {
        await desconectar();
      }
    }
    const s3 = s3De(d);
    await subirObjeto(s3, d.prefijo + nombre, archivo);
    const objetos = await listarObjetos(s3, d.prefijo + PREFIJO_ARCHIVO);
    const sobran = aPodar(objetos.map((o) => o.clave.slice(d.prefijo.length)), conservar);
    for (const f of sobran) await borrarObjeto(s3, d.prefijo + f);
    return { ...base, ok: true, ubicacion: `${d.bucket}/${d.prefijo}${nombre}`, podados: sobran.length };
  } catch (e) {
    return { ...base, ok: false, error: textoError(e, d) };
  }
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/** Escribe, lee y borra un archivo de prueba. */
export async function probarDestino(d: Destino): Promise<{ ok: boolean; mensaje: string }> {
  const prueba = `.g360-prueba-${randomBytes(4).toString("hex")}.txt`;
  try {
    if (d.tipo === "NUBE") {
      const s3 = s3De(d);
      await subirTexto(s3, d.prefijo + prueba, "prueba de Gestión360 Nómina");
      const hay = await listarObjetos(s3, d.prefijo + PREFIJO_ARCHIVO);
      await borrarObjeto(s3, d.prefijo + prueba);
      return { ok: true, mensaje: `Conectado: se pudo escribir y borrar en ${d.bucket}/${d.prefijo}. Respaldos ahí: ${hay.length}.` };
    }
    const carpeta = d.tipo === "LOCAL" ? d.carpeta : d.ruta;
    const desconectar = d.tipo === "RED" ? await conectarRed(d) : async () => {};
    try {
      await mkdir(carpeta, { recursive: true });
      await writeFile(join(carpeta, prueba), "prueba de Gestión360 Nómina");
      await readFile(join(carpeta, prueba));
      await rm(join(carpeta, prueba), { force: true });
      const libre = await statfs(carpeta).then((s) => s.bavail * s.bsize).catch(() => null);
      const hay = (await readdir(carpeta)).filter((f) => f.startsWith(PREFIJO_ARCHIVO)).length;
      return { ok: true, mensaje: `Se pudo escribir y borrar en ${carpeta}.${libre !== null ? ` Espacio libre: ${gb(libre)}.` : ""} Respaldos ahí: ${hay}.` };
    } finally {
      await desconectar();
    }
  } catch (e) {
    return { ok: false, mensaje: textoError(e, d) };
  }
}

/**
 * Qué respaldos del historial se pueden descargar todavía. Un disco local se lee (es instantáneo);
 * una carpeta de red se deduce del historial, porque conectarse a ella puede tardar.
 */
export async function descargables(
  destinos: readonly Destino[],
  historial: readonly { archivo: string | null; destinos: unknown }[],
  conservar: number,
): Promise<Set<string>> {
  const hay = new Set<string>();
  for (const d of destinos) {
    if (d.tipo === "LOCAL") {
      for (const f of await readdir(d.carpeta).catch(() => [] as string[])) hay.add(f);
    } else if (d.tipo === "RED") {
      for (const f of vigentesEnCarpeta(historial, d.id, conservar)) hay.add(f);
    }
  }
  return hay;
}

/** La ruta de un respaldo en un disco local o carpeta de red, para descargarlo. */
export async function ubicarEnDisco(destinos: readonly Destino[], nombre: string): Promise<{ ruta: string; desconectar: () => Promise<void> } | null> {
  for (const d of destinos) {
    if (d.tipo === "NUBE") continue;
    const carpeta = d.tipo === "LOCAL" ? d.carpeta : d.ruta;
    const desconectar = d.tipo === "RED" ? await conectarRed(d).catch(() => null) : async () => {};
    if (!desconectar) continue;
    const ruta = join(carpeta, nombre);
    if (await stat(ruta).then((s) => s.isFile()).catch(() => false)) return { ruta, desconectar };
    await desconectar();
  }
  return null;
}
