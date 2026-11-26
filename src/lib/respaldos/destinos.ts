/**
 * Copiar un respaldo a cada destino (disco local, disco extraíble, carpeta de red, nube
 * S3), podar los que sobran y probar la conexión. SERVIDOR.
 *
 * 2026-11-25 (auditoría de respaldos):
 *   - Disco extraíble: sólo se escribe si el disco conectado lleva la marca de ESE
 *     destino y no es el disco del sistema. En Linux, una unidad sin montar deja la
 *     carpeta vacía en el disco del sistema: sin la marca, no se escribe ahí.
 *   - La copia es atómica: va a «nombre.parcial», se compara su SHA-256 con el original
 *     y recién entonces toma su nombre. Una copia cortada no queda como respaldo válido.
 *   - Se revisa el espacio libre antes de copiar.
 *   - Se poda con la retención GFS (`retencion.ts`).
 */

import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { descifrar } from "@/lib/seguridad/cifrado";
import { MARCA_DESTINO, PREFIJO_ARCHIVO, recursoUnc, vigentesEnCarpeta, type Destino, type DestinoExtraible, type DestinoNube, type DestinoRed } from "./config";
import { aPodar, type RetencionGFS } from "./retencion";
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

/** Un problema ya explicado para quien lo lee: se muestra tal cual. */
export class ErrorDestino extends Error {}

const enWindows = process.platform === "win32";
const SUFIJO_PARCIAL = ".parcial";
const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

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
  if (!enWindows) throw new ErrorDestino("La carpeta de red se usa en la instalación de Windows. En Linux, móntela (CIFS o NFS) y agréguela como «Disco extraíble o carpeta montada».");
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
    throw new ErrorDestino(`No se pudo conectar ${recurso}: ${motivo}.`);
  }
  return async () => { await correr("net", ["use", recurso, "/delete", "/y"]); };
}

function s3De(d: DestinoNube): DestinoS3 {
  if (!d.secretAccessKey) throw new ErrorDestino("Falta la clave secreta.");
  return { endpoint: d.endpoint, region: d.region, bucket: d.bucket, accessKeyId: d.accessKeyId, secretAccessKey: descifrar(d.secretAccessKey), estiloRuta: d.estiloRuta };
}

export async function sha256DeArchivo(ruta: string): Promise<string> {
  const h = createHash("sha256");
  for await (const b of createReadStream(ruta)) h.update(b as Buffer);
  return h.digest("hex");
}

// ─── Disco extraíble ─────────────────────────────────────────────────────────

/** La carpeta existente más cercana (la misma o un ancestro): dónde está el disco. */
async function existenteMasCercana(carpeta: string): Promise<string | null> {
  let actual = carpeta;
  for (;;) {
    if (await stat(actual).then((s) => s.isDirectory()).catch(() => false)) return actual;
    const arriba = dirname(actual);
    if (arriba === actual) return null;
    actual = arriba;
  }
}

/** ¿Está en el mismo disco que el sistema? Es lo que pasa en Linux con una unidad sin montar. */
async function enDiscoDelSistema(carpeta: string): Promise<boolean> {
  const raizSistema = enWindows ? `${process.env.SystemDrive ?? "C:"}\\` : "/";
  const [a, b] = await Promise.all([stat(carpeta).catch(() => null), stat(raizSistema).catch(() => null)]);
  if (!a || !b) return false;
  // En Windows el volumen se ve en la letra: comparar `dev` no basta con discos montados en carpetas.
  if (enWindows) return parse(carpeta).root.toUpperCase() === parse(raizSistema).root.toUpperCase();
  return a.dev === b.dev;
}

interface Marca { producto: string; destinoId: string; nombre: string; preparado: string }

/**
 * El disco conectado es el de este destino: la carpeta existe (no se crea), lleva la
 * marca de ese destino y no está en el disco del sistema. Si no, no se escribe nada.
 */
async function verificarDisco(d: DestinoExtraible): Promise<void> {
  if (!(await stat(d.carpeta).then((s) => s.isDirectory()).catch(() => false))) {
    throw new ErrorDestino(`El disco no está conectado: no se encuentra ${d.carpeta}. Conéctelo; mientras tanto el respaldo queda en los demás destinos.`);
  }
  if (await enDiscoDelSistema(d.carpeta)) {
    throw new ErrorDestino(`${d.carpeta} está en el disco del sistema, no en un disco extraíble (¿la unidad no está conectada o montada?). No se escribe ahí.`);
  }
  const marca = await readFile(join(d.carpeta, MARCA_DESTINO), "utf8").then((t) => JSON.parse(t) as Marca).catch(() => null);
  if (!marca || marca.destinoId !== d.id) {
    throw new ErrorDestino(marca
      ? `El disco conectado en ${d.carpeta} está preparado para otro destino («${marca.nombre}»). Conecte el de «${d.nombre}» o prepárelo para este.`
      : `El disco en ${d.carpeta} no está preparado para «${d.nombre}»: con el disco conectado, pulse «Preparar disco».`);
  }
}

/** Escribe la marca en el disco conectado. Se niega si la carpeta está en el disco del sistema. */
export async function prepararDisco(d: DestinoExtraible): Promise<{ ok: boolean; mensaje: string }> {
  try {
    const existente = await existenteMasCercana(d.carpeta);
    if (!existente) throw new ErrorDestino(`No se encuentra la unidad de ${d.carpeta}: conecte el disco.`);
    if (await enDiscoDelSistema(existente)) {
      throw new ErrorDestino(`${d.carpeta} queda en el disco del sistema. Elija una carpeta del disco extraíble (por ejemplo E:\\Respaldos) y conéctelo antes de prepararlo.`);
    }
    await mkdir(d.carpeta, { recursive: true });
    const marca: Marca = { producto: "Gestión360 Nómina", destinoId: d.id, nombre: d.nombre, preparado: new Date().toISOString() };
    await writeFile(join(d.carpeta, MARCA_DESTINO), JSON.stringify(marca, null, 2));
    const libre = await statfs(d.carpeta).then((s) => s.bavail * s.bsize).catch(() => null);
    return { ok: true, mensaje: `Disco preparado para «${d.nombre}» en ${d.carpeta}.${libre !== null ? ` Espacio libre: ${gb(libre)}.` : ""} Guarde la configuración para que lo use.` };
  } catch (e) {
    return { ok: false, mensaje: textoError(e, d) };
  }
}

// ─── Copiar y podar ──────────────────────────────────────────────────────────

/**
 * A la carpeta, sin dejar nunca un archivo a medias con nombre de respaldo: «.parcial»,
 * verificado por SHA-256 y recién entonces con su nombre. Antes revisa el espacio.
 */
async function aCarpeta(carpeta: string, archivo: string, nombre: string, sha256: string, retencion: RetencionGFS, crear: boolean): Promise<{ ubicacion: string; podados: number }> {
  if (crear) await mkdir(carpeta, { recursive: true });
  // Restos de una copia cortada antes (luz, disco desconectado): no son respaldos.
  for (const f of await readdir(carpeta).catch(() => [] as string[])) {
    if (f.startsWith(PREFIJO_ARCHIVO) && f.endsWith(SUFIJO_PARCIAL)) await rm(join(carpeta, f), { force: true });
  }
  const { size } = await stat(archivo);
  const libre = await statfs(carpeta).then((s) => s.bavail * s.bsize).catch(() => null);
  if (libre !== null && libre < size + 16 * 1024 ** 2) {
    throw new ErrorDestino(`No hay espacio en ${carpeta}: el respaldo ocupa ${gb(size)} y quedan ${gb(libre)}.`);
  }
  const destino = join(carpeta, nombre);
  const temporal = destino + SUFIJO_PARCIAL;
  try {
    await copyFile(archivo, temporal);
    if ((await stat(temporal)).size !== size || (await sha256DeArchivo(temporal)) !== sha256) {
      throw new ErrorDestino("La copia no coincide con el original (se cortó o el disco falla): no se dejó.");
    }
    await rename(temporal, destino);
  } catch (e) {
    await rm(temporal, { force: true });
    throw e;
  }
  const sobran = aPodar(await readdir(carpeta), retencion);
  for (const f of sobran) await rm(join(carpeta, f), { force: true });
  return { ubicacion: destino, podados: sobran.length };
}

function textoError(e: unknown, d: Destino): string {
  if (e instanceof ErrorDestino) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  const carpeta = d.tipo === "LOCAL" || d.tipo === "EXTRAIBLE" ? d.carpeta : d.tipo === "RED" ? d.ruta : "";
  if (/EACCES|EPERM/.test(m)) return `Sin permiso para escribir en ${d.tipo === "NUBE" ? "el bucket" : carpeta}. En la instalación de Windows, dé permiso de modificar a «NT SERVICE\\G360NominaApp».`;
  if (/ENOENT/.test(m) && d.tipo === "RED") return "No se encontró la ruta de red.";
  if (/ENOENT/.test(m)) return `No se encuentra ${carpeta} (¿la unidad existe y está conectada?).`;
  if (/ENOSPC/.test(m)) return "No hay espacio en el disco de destino.";
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return "No se encontró el servidor (revise el endpoint o la conexión a internet).";
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(m)) return "No se pudo conectar con el servidor.";
  return m;
}

/** Copia el respaldo al destino y poda los que sobran. Nunca lanza: devuelve el resultado. */
export async function enviarADestino(d: Destino, archivo: string, nombre: string, sha256: string, retencion: RetencionGFS): Promise<ResultadoDestino> {
  const base = { destinoId: d.id, nombre: d.nombre, tipo: d.tipo };
  try {
    if (d.tipo === "LOCAL") return { ...base, ok: true, ...(await aCarpeta(d.carpeta, archivo, nombre, sha256, retencion, true)) };
    if (d.tipo === "EXTRAIBLE") {
      await verificarDisco(d);
      return { ...base, ok: true, ...(await aCarpeta(d.carpeta, archivo, nombre, sha256, retencion, false)) };
    }
    if (d.tipo === "RED") {
      const desconectar = await conectarRed(d);
      try {
        return { ...base, ok: true, ...(await aCarpeta(d.ruta, archivo, nombre, sha256, retencion, true)) };
      } finally {
        await desconectar();
      }
    }
    // La nube verifica el contenido con la firma: el SHA-256 del cuerpo va firmado.
    const s3 = s3De(d);
    await subirObjeto(s3, d.prefijo + nombre, archivo);
    const objetos = await listarObjetos(s3, d.prefijo + PREFIJO_ARCHIVO);
    const sobran = aPodar(objetos.map((o) => o.clave.slice(d.prefijo.length)), retencion);
    for (const f of sobran) await borrarObjeto(s3, d.prefijo + f);
    return { ...base, ok: true, ubicacion: `${d.bucket}/${d.prefijo}${nombre}`, podados: sobran.length };
  } catch (e) {
    return { ...base, ok: false, error: textoError(e, d) };
  }
}

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
    if (d.tipo === "EXTRAIBLE") await verificarDisco(d);
    const carpeta = d.tipo === "RED" ? d.ruta : d.carpeta;
    const desconectar = d.tipo === "RED" ? await conectarRed(d) : async () => {};
    try {
      if (d.tipo !== "EXTRAIBLE") await mkdir(carpeta, { recursive: true });
      await writeFile(join(carpeta, prueba), "prueba de Gestión360 Nómina");
      await readFile(join(carpeta, prueba));
      await rm(join(carpeta, prueba), { force: true });
      const libre = await statfs(carpeta).then((s) => s.bavail * s.bsize).catch(() => null);
      const hay = (await readdir(carpeta)).filter((f) => f.startsWith(PREFIJO_ARCHIVO) && !f.endsWith(SUFIJO_PARCIAL)).length;
      const extra = d.tipo === "EXTRAIBLE" ? " Es el disco preparado para este destino." : "";
      return { ok: true, mensaje: `Se pudo escribir y borrar en ${carpeta}.${extra}${libre !== null ? ` Espacio libre: ${gb(libre)}.` : ""} Respaldos ahí: ${hay}.` };
    } finally {
      await desconectar();
    }
  } catch (e) {
    return { ok: false, mensaje: textoError(e, d) };
  }
}

/**
 * Qué respaldos del historial se pueden descargar todavía. Un disco se lee (es
 * instantáneo; uno extraíble desconectado no tiene nada); una carpeta de red se deduce
 * del historial, porque conectarse a ella puede tardar.
 */
export async function descargables(
  destinos: readonly Destino[],
  historial: readonly { archivo: string | null; destinos: unknown }[],
  retencion: RetencionGFS,
): Promise<Set<string>> {
  const hay = new Set<string>();
  for (const d of destinos) {
    if (d.tipo === "LOCAL" || d.tipo === "EXTRAIBLE") {
      for (const f of await readdir(d.carpeta).catch(() => [] as string[])) if (!f.endsWith(SUFIJO_PARCIAL)) hay.add(f);
    } else if (d.tipo === "RED") {
      for (const f of vigentesEnCarpeta(historial, d.id, retencion)) hay.add(f);
    }
  }
  return hay;
}

/** La ruta de un respaldo en un disco o carpeta de red, para descargarlo. */
export async function ubicarEnDisco(destinos: readonly Destino[], nombre: string): Promise<{ ruta: string; desconectar: () => Promise<void> } | null> {
  for (const d of destinos) {
    if (d.tipo === "NUBE") continue;
    const carpeta = d.tipo === "RED" ? d.ruta : d.carpeta;
    const desconectar = d.tipo === "RED" ? await conectarRed(d).catch(() => null) : async () => {};
    if (!desconectar) continue;
    const ruta = join(carpeta, nombre);
    if (await stat(ruta).then((s) => s.isFile()).catch(() => false)) return { ruta, desconectar };
    await desconectar();
  }
  return null;
}
