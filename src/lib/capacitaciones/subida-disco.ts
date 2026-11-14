/**
 * Las subidas por partes en el disco del servidor: el archivo que va creciendo
 * (`<subida>.parte`) y lo recibido hasta ahora (`<subida>.json`), en la carpeta del material.
 * Las reglas están en ./subida.ts.
 */
import { open, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { directorioMaterial } from "./material";
import type { EstadoSubida } from "./subida";

/** Una subida que nadie terminó en un día se borra. */
const VIDA_SUBIDA_MS = 24 * 60 * 60 * 1000;

export function rutasSubida(subida: string) {
  const dir = directorioMaterial();
  return { dir, parte: path.join(dir, `${subida}.parte`), estado: path.join(dir, `${subida}.json`) };
}

export async function leerEstado(subida: string): Promise<EstadoSubida | null> {
  try {
    const e = JSON.parse(await readFile(rutasSubida(subida).estado, "utf8"));
    return typeof e?.usuarioId === "string" && typeof e?.capacitacionId === "string" && Number.isInteger(e?.bytes) ? e : null;
  } catch {
    return null;
  }
}

export const guardarEstado = (subida: string, e: EstadoSubida) => writeFile(rutasSubida(subida).estado, JSON.stringify(e));

export async function borrarSubida(subida: string) {
  const r = rutasSubida(subida);
  await Promise.all([unlink(r.parte).catch(() => {}), unlink(r.estado).catch(() => {})]);
}

/** Los primeros bytes del archivo, para reconocer su formato por la firma. */
export async function leerCabeza(archivo: string, n = 16): Promise<Uint8Array> {
  const fh = await open(archivo, "r");
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return new Uint8Array(b.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** Borra las subidas abandonadas (más de un día sin terminar). Si algo falla, no importa. */
export async function limpiarVencidas(ahora = Date.now()) {
  const dir = directorioMaterial();
  let nombres: string[] = [];
  try {
    nombres = await readdir(dir);
  } catch {
    return;
  }
  for (const n of nombres.filter((x) => x.endsWith(".parte") || (x.endsWith(".json") && x.length === 41))) {
    const ruta = path.join(dir, n);
    try {
      if (ahora - (await stat(ruta)).mtimeMs > VIDA_SUBIDA_MS) await unlink(ruta);
    } catch {}
  }
}
