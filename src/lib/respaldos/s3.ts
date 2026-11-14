/**
 * Cliente mínimo de almacenamiento compatible con S3 (Amazon S3, Backblaze B2,
 * Wasabi, DigitalOcean Spaces, Cloudflare R2, MinIO), con firma AWS Signature V4.
 *
 * Sin el SDK de AWS a propósito: son tres operaciones (subir, listar, borrar) y el
 * SDK pesa varios megas que irían en cada instalación. La firma se prueba contra el
 * ejemplo publicado por AWS (`s3.test.ts`).
 */

import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

export interface DestinoS3 {
  /** https://s3.us-west-004.backblazeb2.com, https://<cuenta>.r2.cloudflarestorage.com… */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true: endpoint/bucket/clave. false: bucket.endpoint/clave (Amazon). */
  estiloRuta: boolean;
}

const VACIO = createHash("sha256").update("").digest("hex");

/** RFC 3986, como la exige SigV4 (encodeURIComponent deja pasar !'()*). */
export function codificar(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const hmac = (clave: Buffer | string, texto: string) => createHmac("sha256", clave).update(texto, "utf8").digest();
const sha256 = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");

export function fechaAmz(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Encabezados firmados de una petición (SigV4, servicio «s3»). `headers` lleva lo que
 * se quiera firmar además de host, x-amz-date y x-amz-content-sha256.
 */
export function firmarS3(p: {
  metodo: string;
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  fecha: Date;
  headers?: Record<string, string>;
}): Record<string, string> {
  const amz = fechaAmz(p.fecha);
  const dia = amz.slice(0, 8);
  const todos: Record<string, string> = {
    ...Object.fromEntries(Object.entries(p.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: p.url.host,
    "x-amz-content-sha256": p.payloadHash,
    "x-amz-date": amz,
  };
  const nombres = Object.keys(todos).sort();
  const canonHeaders = nombres.map((k) => `${k}:${todos[k]}\n`).join("");
  const firmados = nombres.join(";");
  const consulta = [...p.url.searchParams.entries()]
    .map(([k, v]) => [codificar(k), codificar(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const ruta = p.url.pathname.split("/").map((s) => codificar(decodeURIComponent(s))).join("/") || "/";
  const canonica = [p.metodo, ruta, consulta, canonHeaders, firmados, p.payloadHash].join("\n");
  const alcance = `${dia}/${p.region}/s3/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", amz, alcance, sha256(canonica)].join("\n");
  const kFirma = hmac(hmac(hmac(hmac(`AWS4${p.secretAccessKey}`, dia), p.region), "s3"), "aws4_request");
  const firma = createHmac("sha256", kFirma).update(aFirmar, "utf8").digest("hex");
  return {
    ...todos,
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${alcance}, SignedHeaders=${firmados}, Signature=${firma}`,
  };
}

/** URL de un objeto (o del bucket, sin clave). */
export function urlS3(d: DestinoS3, clave = "", consulta: Record<string, string> = {}): URL {
  const base = new URL(d.endpoint);
  const ruta = clave.split("/").map(codificar).join("/");
  const url = d.estiloRuta
    ? new URL(`${base.protocol}//${base.host}/${codificar(d.bucket)}${clave ? `/${ruta}` : "/"}`)
    : new URL(`${base.protocol}//${d.bucket}.${base.host}/${ruta}`);
  for (const [k, v] of Object.entries(consulta)) url.searchParams.set(k, v);
  return url;
}

interface Respuesta { status: number; cuerpo: string }

function pedir(metodo: string, url: URL, headers: Record<string, string>, cuerpo?: { ruta: string; tamano: number }): Promise<Respuesta> {
  const cliente = url.protocol === "http:" ? http : https;
  return new Promise((resolver, rechazar) => {
    const req = cliente.request(url, { method: metodo, headers: cuerpo ? { ...headers, "content-length": String(cuerpo.tamano) } : headers, timeout: 600_000 }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (b: Buffer) => partes.push(b));
      res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo: Buffer.concat(partes).toString("utf8") }));
      res.on("error", rechazar);
    });
    req.on("timeout", () => req.destroy(new Error("El servicio no respondió a tiempo.")));
    req.on("error", rechazar);
    if (cuerpo) createReadStream(cuerpo.ruta).on("error", rechazar).pipe(req);
    else req.end();
  });
}

/** El mensaje del XML de error de S3, en palabras. */
export function errorS3(r: Respuesta): Error {
  const codigo = /<Code>([^<]*)<\/Code>/.exec(r.cuerpo)?.[1];
  const mensaje = /<Message>([^<]*)<\/Message>/.exec(r.cuerpo)?.[1];
  const explicacion: Record<string, string> = {
    InvalidAccessKeyId: "La clave de acceso no existe en este proveedor.",
    SignatureDoesNotMatch: "La clave secreta no corresponde a la clave de acceso.",
    NoSuchBucket: "El bucket no existe (revise el nombre y la región).",
    AccessDenied: "La clave no tiene permiso sobre este bucket.",
    AuthorizationHeaderMalformed: "La región no corresponde al bucket.",
    PermanentRedirect: "El bucket está en otra región: use su endpoint.",
  };
  return new Error(codigo ? `${explicacion[codigo] ?? codigo}${mensaje && !explicacion[codigo] ? `: ${mensaje}` : ""}` : `El servicio respondió ${r.status}.`);
}

async function hashArchivo(ruta: string): Promise<string> {
  const h = createHash("sha256");
  for await (const b of createReadStream(ruta)) h.update(b as Buffer);
  return h.digest("hex");
}

export async function subirObjeto(d: DestinoS3, clave: string, ruta: string): Promise<void> {
  const url = urlS3(d, clave);
  const { size } = await stat(ruta);
  const headers = firmarS3({
    metodo: "PUT", url, region: d.region, accessKeyId: d.accessKeyId, secretAccessKey: d.secretAccessKey,
    payloadHash: await hashArchivo(ruta), fecha: new Date(), headers: { "content-type": "application/octet-stream" },
  });
  const r = await pedir("PUT", url, headers, { ruta, tamano: size });
  if (r.status < 200 || r.status >= 300) throw errorS3(r);
}

export async function subirTexto(d: DestinoS3, clave: string, texto: string): Promise<void> {
  const url = urlS3(d, clave);
  const cuerpo = Buffer.from(texto, "utf8");
  const headers = firmarS3({ metodo: "PUT", url, region: d.region, accessKeyId: d.accessKeyId, secretAccessKey: d.secretAccessKey, payloadHash: createHash("sha256").update(cuerpo).digest("hex"), fecha: new Date() });
  const cliente = url.protocol === "http:" ? http : https;
  const r = await new Promise<Respuesta>((resolver, rechazar) => {
    const req = cliente.request(url, { method: "PUT", headers: { ...headers, "content-length": String(cuerpo.length) }, timeout: 60_000 }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (b: Buffer) => partes.push(b));
      res.on("end", () => resolver({ status: res.statusCode ?? 0, cuerpo: Buffer.concat(partes).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("El servicio no respondió a tiempo.")));
    req.on("error", rechazar);
    req.end(cuerpo);
  });
  if (r.status < 200 || r.status >= 300) throw errorS3(r);
}

export async function borrarObjeto(d: DestinoS3, clave: string): Promise<void> {
  const url = urlS3(d, clave);
  const headers = firmarS3({ metodo: "DELETE", url, region: d.region, accessKeyId: d.accessKeyId, secretAccessKey: d.secretAccessKey, payloadHash: VACIO, fecha: new Date() });
  const r = await pedir("DELETE", url, headers);
  if (r.status !== 204 && r.status !== 200) throw errorS3(r);
}

export interface ObjetoS3 { clave: string; tamano: number; fecha: Date }

/** Objetos cuyo nombre empieza por `prefijo` (ListObjectsV2, todas las páginas). */
export async function listarObjetos(d: DestinoS3, prefijo: string): Promise<ObjetoS3[]> {
  const salida: ObjetoS3[] = [];
  let continuar: string | null = null;
  do {
    const url = urlS3(d, "", { "list-type": "2", prefix: prefijo, ...(continuar ? { "continuation-token": continuar } : {}) });
    const headers = firmarS3({ metodo: "GET", url, region: d.region, accessKeyId: d.accessKeyId, secretAccessKey: d.secretAccessKey, payloadHash: VACIO, fecha: new Date() });
    const r = await pedir("GET", url, headers);
    if (r.status !== 200) throw errorS3(r);
    for (const m of r.cuerpo.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const clave = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1];
      if (!clave) continue;
      salida.push({
        clave: clave.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
        tamano: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0),
        fecha: new Date(/<LastModified>([^<]*)<\/LastModified>/.exec(m[1])?.[1] ?? 0),
      });
    }
    continuar = /<IsTruncated>true<\/IsTruncated>/.test(r.cuerpo) ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(r.cuerpo)?.[1] ?? null : null;
  } while (continuar);
  return salida;
}
