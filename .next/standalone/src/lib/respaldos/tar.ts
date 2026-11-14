/**
 * Archivo TAR (formato ustar, con encabezado PAX para nombres largos), escrito y
 * leído en flujo: un respaldo con años de documentos adjuntos no tiene por qué
 * caber en memoria. Sin dependencias: lo abre cualquier `tar` (también el que
 * trae Windows 10 y 11: `tar -xzf respaldo.tar.gz`).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

const BLOQUE = 512;

export interface EntradaTar {
  /** Ruta dentro del archivo, con «/». */
  nombre: string;
  /** Archivo en disco, o el contenido ya en memoria. */
  ruta?: string;
  contenido?: Buffer;
  mtime?: Date;
}

function octal(n: number, largo: number): string {
  return n.toString(8).padStart(largo - 1, "0") + "\0";
}

function encabezado(nombre: string, tamano: number, mtime: Date, tipo: "0" | "x" = "0"): Buffer {
  const h = Buffer.alloc(BLOQUE, 0);
  const escribir = (texto: string, desde: number, largo: number) => {
    Buffer.from(texto, "utf8").copy(h, desde, 0, largo);
  };
  // Nombre: hasta 100 bytes; con prefijo, hasta 155 más (cortado en una «/»).
  let nombreCampo = nombre, prefijo = "";
  if (Buffer.byteLength(nombre) > 100) {
    const corte = nombre.lastIndexOf("/", 155);
    if (corte > 0 && Buffer.byteLength(nombre.slice(corte + 1)) <= 100 && Buffer.byteLength(nombre.slice(0, corte)) <= 155) {
      prefijo = nombre.slice(0, corte);
      nombreCampo = nombre.slice(corte + 1);
    } else {
      nombreCampo = nombre.slice(0, 99); // el nombre completo va en el encabezado PAX
    }
  }
  escribir(nombreCampo, 0, 100);
  escribir(octal(0o644, 8), 100, 8);
  escribir(octal(0, 8), 108, 8);
  escribir(octal(0, 8), 116, 8);
  escribir(octal(tamano, 12), 124, 12);
  escribir(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12);
  h.fill(0x20, 148, 156); // la suma se calcula con el campo en blancos
  escribir(tipo, 156, 1);
  escribir("ustar\0", 257, 6);
  escribir("00", 263, 2);
  escribir(prefijo, 345, 155);
  let suma = 0;
  for (const b of h) suma += b;
  escribir(suma.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/** Registro PAX «path=…»: el largo se cuenta a sí mismo. */
function registroPax(clave: string, valor: string): Buffer {
  const cuerpo = ` ${clave}=${valor}\n`;
  let largo = Buffer.byteLength(cuerpo) + 1;
  while (String(largo).length + Buffer.byteLength(cuerpo) !== largo) largo = String(largo).length + Buffer.byteLength(cuerpo);
  return Buffer.from(`${largo}${cuerpo}`, "utf8");
}

const relleno = (tamano: number) => Buffer.alloc((BLOQUE - (tamano % BLOQUE)) % BLOQUE, 0);

/**
 * ¿Basta el encabezado clásico? Sólo con nombres ASCII que quepan: los campos ustar no
 * dicen en qué codificación van, y el tar de Windows los lee en la página de códigos
 * local («año» salía «a±o»). El registro PAX es UTF-8 por norma.
 */
function nombreCabe(nombre: string): boolean {
  if (!/^[\x20-\x7e]*$/.test(nombre)) return false;
  if (nombre.length <= 100) return true;
  const corte = nombre.lastIndexOf("/", 155);
  return corte > 0 && nombre.length - corte - 1 <= 100 && corte <= 155;
}

/** Flujo con el archivo TAR de las entradas, en el orden dado. */
export function flujoTar(entradas: readonly EntradaTar[]): Readable {
  return Readable.from((async function* () {
    for (const e of entradas) {
      const tamano = e.contenido ? e.contenido.length : (await stat(e.ruta!)).size;
      const mtime = e.mtime ?? new Date();
      const conPax = !nombreCabe(e.nombre);
      if (conPax) {
        const pax = registroPax("path", e.nombre);
        yield encabezado("PaxHeader/entrada", pax.length, mtime, "x");
        yield pax;
        yield relleno(pax.length);
      }
      // Con PAX, el campo clásico lleva una versión ASCII por si algún lector lo ignora.
      yield encabezado(conPax ? e.nombre.replace(/[^\x20-\x7e]/g, "_").slice(-100) : e.nombre, tamano, mtime);
      if (e.contenido) {
        yield e.contenido;
      } else {
        let leidos = 0;
        for await (const trozo of createReadStream(e.ruta!)) {
          const b = trozo as Buffer;
          // Si el archivo creció mientras se leía, se corta al tamaño anunciado.
          const queda = tamano - leidos;
          if (queda <= 0) break;
          const parte = b.length > queda ? b.subarray(0, queda) : b;
          leidos += parte.length;
          yield parte;
        }
        if (leidos < tamano) throw new Error(`${e.nombre} cambió de tamaño mientras se respaldaba`);
      }
      yield relleno(tamano);
    }
    yield Buffer.alloc(BLOQUE * 2, 0);
  })());
}

export interface MiembroTar {
  nombre: string;
  tamano: number;
  sha256: string;
  /** Sólo si se pidió capturarlo. */
  contenido?: Buffer;
}

/**
 * Recorre un TAR en flujo: nombre, tamaño y huella de cada miembro, y el contenido
 * de los que `capturar` pida (el manifiesto). Sirve para verificar un respaldo
 * recién hecho sin desempacarlo.
 */
export async function inspeccionarTar(entrada: AsyncIterable<Buffer | string>, capturar: (nombre: string) => boolean = () => false): Promise<MiembroTar[]> {
  const miembros: MiembroTar[] = [];
  let pendiente = Buffer.alloc(0);
  let actual: { nombre: string; tamano: number; faltan: number; hash: ReturnType<typeof createHash>; partes: Buffer[] | null; relleno: number } | null = null;
  let paxPath: string | null = null;
  let leyendoPax: { faltan: number; partes: Buffer[]; relleno: number } | null = null;
  let fin = false;

  for await (const trozo of entrada) {
    pendiente = Buffer.concat([pendiente, typeof trozo === "string" ? Buffer.from(trozo) : trozo]);
    while (!fin) {
      if (leyendoPax) {
        const n = Math.min(leyendoPax.faltan, pendiente.length);
        leyendoPax.partes.push(pendiente.subarray(0, n));
        pendiente = pendiente.subarray(n);
        leyendoPax.faltan -= n;
        if (leyendoPax.faltan > 0 || pendiente.length < leyendoPax.relleno) break;
        pendiente = pendiente.subarray(leyendoPax.relleno);
        const texto = Buffer.concat(leyendoPax.partes).toString("utf8");
        paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(texto)?.[1] ?? null;
        leyendoPax = null;
        continue;
      }
      if (actual) {
        const n = Math.min(actual.faltan, pendiente.length);
        const parte = pendiente.subarray(0, n);
        actual.hash.update(parte);
        actual.partes?.push(Buffer.from(parte));
        pendiente = pendiente.subarray(n);
        actual.faltan -= n;
        if (actual.faltan > 0) break;
        if (pendiente.length < actual.relleno) break;
        pendiente = pendiente.subarray(actual.relleno);
        miembros.push({
          nombre: actual.nombre, tamano: actual.tamano, sha256: actual.hash.digest("hex"),
          ...(actual.partes ? { contenido: Buffer.concat(actual.partes) } : {}),
        });
        actual = null;
        continue;
      }
      if (pendiente.length < BLOQUE) break;
      const h = pendiente.subarray(0, BLOQUE);
      pendiente = pendiente.subarray(BLOQUE);
      if (h.every((b) => b === 0)) { fin = true; break; }
      const texto = (desde: number, largo: number) => {
        const campo = h.subarray(desde, desde + largo);
        const fin = campo.indexOf(0);
        return campo.subarray(0, fin < 0 ? campo.length : fin).toString("utf8");
      };
      const tamano = parseInt(texto(124, 12).trim() || "0", 8);
      const tipo = texto(156, 1);
      const rell = (BLOQUE - (tamano % BLOQUE)) % BLOQUE;
      if (tipo === "x") { leyendoPax = { faltan: tamano, partes: [], relleno: rell }; continue; }
      const prefijo = texto(345, 155);
      const nombre = paxPath ?? (prefijo ? `${prefijo}/${texto(0, 100)}` : texto(0, 100));
      paxPath = null;
      actual = { nombre, tamano, faltan: tamano, hash: createHash("sha256"), partes: capturar(nombre) ? [] : null, relleno: rell };
      if (tamano === 0) {
        miembros.push({ nombre, tamano: 0, sha256: actual.hash.digest("hex"), ...(actual.partes ? { contenido: Buffer.alloc(0) } : {}) });
        actual = null;
      }
    }
    if (fin) break;
  }
  if (actual || leyendoPax) throw new Error("El archivo está incompleto: se cortó a mitad de un miembro.");
  return miembros;
}
