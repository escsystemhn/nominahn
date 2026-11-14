/**
 * Material de capacitación: qué archivos se aceptan, dónde viven y cómo se entregan.
 *
 * Decisión de Edbin (2026-11-14): en el disco del servidor, hasta 500 MB por archivo,
 * servidos por partes (Range) con enlaces firmados de vida corta, y siempre `inline`:
 * el visor no ofrece descargarlos. Ningún navegador puede impedir una captura de
 * pantalla; la marca de agua con el nombre y el DNI de quien mira la desanima.
 */
import { createHmac, timingSafeEqual } from "crypto";
import path from "path";
import { directorioUploads } from "@/lib/uploads";

/** 500 MB por omisión; MAX_MATERIAL_SIZE (bytes) lo cambia. */
export function maxBytesMaterial(): number {
  const n = Number.parseInt(process.env.MAX_MATERIAL_SIZE ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 500 * 1024 * 1024;
}

export type TipoMaterial = "MANUAL" | "VIDEO" | "DOCUMENTO";

export interface FormatoMaterial {
  ext: ".pdf" | ".mp4" | ".webm" | ".png" | ".jpg";
  mime: string;
  /** Lo que el visor sabe mostrar. */
  visor: "pdf" | "video" | "imagen";
}

/**
 * El formato por sus primeros bytes, no por la extensión ni por lo que diga el
 * navegador: un .exe renombrado a .pdf no pasa. Sólo lo que el visor puede mostrar
 * sin descargarlo: PDF, MP4, WebM, PNG y JPG. Word o PowerPoint: guárdelos como PDF.
 */
export function formatoPorFirma(b: Uint8Array): FormatoMaterial | null {
  const ascii = (desde: number, hasta: number) => String.fromCharCode(...b.subarray(desde, hasta));
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return { ext: ".pdf", mime: "application/pdf", visor: "pdf" };
  if (b.length >= 12 && ascii(4, 8) === "ftyp") return { ext: ".mp4", mime: "video/mp4", visor: "video" };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: ".webm", mime: "video/webm", visor: "video" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return { ext: ".png", mime: "image/png", visor: "imagen" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg", visor: "imagen" };
  return null;
}

/** El tipo que se sugiere si quien sube no lo elige. */
export const tipoSugerido = (f: FormatoMaterial): TipoMaterial => (f.visor === "video" ? "VIDEO" : f.visor === "pdf" ? "MANUAL" : "DOCUMENTO");

const RE_ARCHIVO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|mp4|webm|png|jpg)$/;

/** Ruta en disco. Sólo nombres UUID+extensión: un nombre con ruta no llega al disco. */
export function rutaMaterial(archivo: string): string {
  if (archivo !== path.basename(archivo) || !RE_ARCHIVO.test(archivo)) throw new Error("Nombre de material inválido");
  return path.join(directorioUploads(), "capacitaciones", archivo);
}

export const directorioMaterial = () => path.join(directorioUploads(), "capacitaciones");

// ─── Enlace firmado ──────────────────────────────────────────────────────────

/** Diez minutos: alcanza para abrir el visor; un video ya cargando sigue con su Range. */
export const VIDA_ENLACE_MS = 10 * 60 * 1000;

function secreto(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Falta AUTH_SECRET");
  return `material:${s}`;
}

const firma = (datos: string) => createHmac("sha256", secreto()).update(datos).digest("base64url");

/** Enlace para UN material y UN usuario, que vence. Copiado a otra sesión no sirve. */
export function firmarEnlace(materialId: string, usuarioId: string, ahora = Date.now()): string {
  const vence = ahora + VIDA_ENLACE_MS;
  return `${vence}.${firma(`${materialId}|${usuarioId}|${vence}`)}`;
}

export function enlaceValido(token: string | null, materialId: string, usuarioId: string, ahora = Date.now()): boolean {
  if (!token) return false;
  const [venceTxt, f] = token.split(".");
  const vence = Number(venceTxt);
  if (!Number.isFinite(vence) || vence < ahora || !f) return false;
  const esperada = Buffer.from(firma(`${materialId}|${usuarioId}|${vence}`));
  const dada = Buffer.from(f);
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}

// ─── Range ───────────────────────────────────────────────────────────────────

/**
 * Lee un encabezado `Range: bytes=a-b` (sólo un tramo, como piden los navegadores para
 * video y pdf.js para PDF grandes). null = sin Range (todo el archivo); "invalido" = 416.
 */
export function leerRange(encabezado: string | null, tamano: number): { inicio: number; fin: number } | null | "invalido" {
  if (!encabezado) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(encabezado.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalido";
  let inicio: number;
  let fin: number;
  if (m[1] === "") {
    // «los últimos N bytes»
    const n = Number(m[2]);
    inicio = Math.max(0, tamano - n);
    fin = tamano - 1;
  } else {
    inicio = Number(m[1]);
    fin = m[2] === "" ? tamano - 1 : Math.min(Number(m[2]), tamano - 1);
  }
  if (inicio >= tamano || inicio > fin) return "invalido";
  return { inicio, fin };
}

/** "Nombre Apellido · DNI 0801-1990-12345 · 14/11/2026" para la marca de agua. */
export function textoMarca(nombre: string, identidad: string | null, fecha: Date): string {
  const d = identidad?.replace(/\D/g, "") ?? "";
  const dni = d.length === 13 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : identidad;
  const dia = fecha.toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa", day: "2-digit", month: "2-digit", year: "numeric" });
  return [nombre, dni ? `DNI ${dni}` : null, dia].filter(Boolean).join(" · ");
}
