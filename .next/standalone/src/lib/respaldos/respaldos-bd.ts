/**
 * Respaldos: configuración guardada, ejecución e historial. SERVIDOR.
 *
 * Un respaldo es UN archivo `.tar.gz` (cifrado opcional, `.enc`, formato OpenSSL):
 *   manifiesto.json          qué es, de cuándo, huellas y cómo restaurarlo
 *   base/g360-nomina.dump    pg_dump en formato custom (se restaura con pg_restore)
 *   adjuntos/…               los documentos subidos (UPLOAD_DIR)
 * Se arma en una carpeta temporal, se verifica leyéndolo de vuelta y recién entonces
 * se copia a cada destino. La carpeta temporal se borra siempre.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cifrar, descifrar } from "@/lib/seguridad/cifrado";
import { VERSION } from "@/lib/inicio-sesion";
import {
  CLAVE_RESPALDOS,
  debeIntentar,
  nombreArchivo,
  normalizarConfig,
  type ConfigEntrada,
  type ConfigRespaldos,
  type Destino,
} from "./config";
import { cifradorOpenssl, descifradorOpenssl } from "./cifrado-openssl";
import { enviarADestino, type ResultadoDestino } from "./destinos";
import { flujoTar, inspeccionarTar, type EntradaTar } from "./tar";

type Db = Pick<PrismaClient, "configuracionSistema">;

export class ErrorRespaldo extends Error {}

// ─── Configuración ───────────────────────────────────────────────────────────

export async function leerConfigRespaldos(db: Db = prisma): Promise<ConfigRespaldos> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_RESPALDOS } });
  return normalizarConfig(fila?.valor ?? null);
}

/**
 * Guarda lo que manda la pantalla. Una clave nueva se cifra; `null` o ausente deja
 * la que había; "" la quita. Encender el automático anota desde cuándo.
 */
export async function guardarConfigRespaldos(e: ConfigEntrada, anterior: ConfigRespaldos, db: Db = prisma): Promise<ConfigRespaldos> {
  const clave = (nueva: string | null | undefined, vieja: string | null) =>
    nueva === undefined || nueva === null ? vieja : nueva === "" ? null : cifrar(nueva);
  const destinos: Destino[] = e.destinos.map((d) => {
    const previo = anterior.destinos.find((x) => x.id === d.id && x.tipo === d.tipo);
    if (d.tipo === "RED") return { ...d, usuario: d.usuario || null, clave: d.usuario ? clave(d.clave, previo?.tipo === "RED" ? previo.clave : null) : null };
    if (d.tipo === "NUBE") return { ...d, secretAccessKey: clave(d.secretAccessKey, previo?.tipo === "NUBE" ? previo.secretAccessKey : null) };
    return d;
  });
  const config: ConfigRespaldos = {
    automatico: {
      ...e.automatico,
      activadoEn: e.automatico.activo ? (anterior.automatico.activo && anterior.automatico.activadoEn ? anterior.automatico.activadoEn : new Date().toISOString()) : null,
    },
    conservar: e.conservar,
    incluirAdjuntos: e.incluirAdjuntos,
    cifrar: e.cifrar,
    // Se conserva aunque se apague el cifrado: volver a encenderlo no obliga a escribirla de nuevo.
    claveCifrado: clave(e.claveCifrado, anterior.claveCifrado),
    destinos,
  };
  const valor = JSON.stringify(config);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_RESPALDOS },
    update: { valor },
    create: { clave: CLAVE_RESPALDOS, valor, descripcion: "Respaldos: destinos, horario y claves (cifradas)." },
  });
  return config;
}

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

export interface Postgres { pgDump: string; pgRestore: string; version: string }

let cache: { valor: Postgres | { error: string }; hasta: number } | null = null;

/**
 * Dónde están pg_dump y pg_restore: PG_BIN_DIR (lo escribe el instalador), la
 * carpeta pgsql de la instalación de Windows, las instalaciones habituales de
 * PostgreSQL o el PATH. Deben ser de la misma versión mayor que el servidor o más nueva.
 */
export function ubicarPostgres(): Postgres | { error: string } {
  if (cache && cache.hasta > Date.now()) return cache.valor;
  const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);
  const carpetas = [
    process.env.PG_BIN_DIR,
    resolve(process.cwd(), "..", "pgsql", "bin"),
    resolve(process.cwd(), "pgsql", "bin"),
    ...["18", "17", "16"].map((v) => (process.platform === "win32" ? `C:\\Program Files\\PostgreSQL\\${v}\\bin` : `/usr/lib/postgresql/${v}/bin`)),
  ].filter((c): c is string => !!c);
  const candidatos = [...carpetas.map((c) => ({ dump: join(c, exe("pg_dump")), restore: join(c, exe("pg_restore")) })), { dump: "pg_dump", restore: "pg_restore" }];
  let valor: Postgres | { error: string } = { error: "No se encontró pg_dump. En la instalación de Windows viene incluido; en otro servidor instale el cliente de PostgreSQL o indique PG_BIN_DIR." };
  for (const c of candidatos) {
    if (c.dump !== "pg_dump" && !existsSync(c.dump)) continue;
    const r = spawnSync(c.dump, ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    if (r.status === 0) { valor = { pgDump: c.dump, pgRestore: c.restore, version: r.stdout.trim() }; break; }
  }
  cache = { valor, hasta: Date.now() + 60_000 };
  return valor;
}

function correr(exe: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ codigo: number; salida: string }> {
  return new Promise((resolver) => {
    const p = spawn(exe, args, { env, windowsHide: true });
    let salida = "";
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on("data", (b: Buffer) => { if (salida.length < 200_000) salida += b.toString(); });
    p.stderr.on("data", (b: Buffer) => { if (salida.length < 200_000) salida += b.toString(); });
    p.on("error", (e) => { clearTimeout(t); resolver({ codigo: -1, salida: e.message }); });
    p.on("close", (codigo) => { clearTimeout(t); resolver({ codigo: codigo ?? -1, salida }); });
  });
}

/** Conexión de DATABASE_URL para pg_dump: la clave va por PGPASSWORD, no en la línea de comandos. */
function conexion(): { args: string[]; env: NodeJS.ProcessEnv; base: string } {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const base = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const ssl = url.searchParams.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  return { args: ["-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username), "-d", base], env, base };
}

// ─── Ejecución ───────────────────────────────────────────────────────────────

async function sha256De(ruta: string): Promise<string> {
  const h = createHash("sha256");
  for await (const b of createReadStream(ruta)) h.update(b as Buffer);
  return h.digest("hex");
}

/** Todos los archivos bajo `raiz`, con su ruta relativa en «/». */
async function archivosBajo(raiz: string): Promise<Array<{ ruta: string; relativa: string; bytes: number }>> {
  const salida: Array<{ ruta: string; relativa: string; bytes: number }> = [];
  async function recorrer(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) await recorrer(ruta);
      else if (e.isFile()) salida.push({ ruta, relativa: relative(raiz, ruta).split(sep).join("/"), bytes: (await stat(ruta)).size });
    }
  }
  if (existsSync(raiz)) await recorrer(raiz);
  return salida;
}

export interface ResultadoRespaldo {
  id: string;
  estado: "OK" | "PARCIAL" | "ERROR";
  archivo: string | null;
  tamano: number | null;
  destinos: ResultadoDestino[];
  error: string | null;
}

/**
 * Hace un respaldo y lo copia a los destinos activos. Uno a la vez: si hay otro en
 * curso (de menos de 2 horas), se rechaza.
 */
export async function crearRespaldo(tipo: "MANUAL" | "AUTOMATICO", usuario: { id?: string; email?: string } = {}): Promise<ResultadoRespaldo> {
  const config = await leerConfigRespaldos();
  const destinos = config.destinos.filter((d) => d.activo);
  if (destinos.length === 0) throw new ErrorRespaldo("No hay ningún destino activo: agregue uno (disco local, red o nube).");
  const pg = ubicarPostgres();
  if ("error" in pg) throw new ErrorRespaldo(pg.error);
  if (config.cifrar && !config.claveCifrado) throw new ErrorRespaldo("El cifrado está activo pero falta su contraseña.");

  const fila = await prisma.$transaction(async (tx) => {
    const enCurso = await tx.respaldo.findFirst({ where: { estado: "EN_CURSO", createdAt: { gte: new Date(Date.now() - 2 * 3_600_000) } }, select: { id: true } });
    if (enCurso) throw new ErrorRespaldo("Ya hay un respaldo en curso. Espere a que termine.");
    return tx.respaldo.create({ data: { tipo, estado: "EN_CURSO", cifrado: config.cifrar, incluyeAdjuntos: config.incluirAdjuntos, usuarioId: usuario.id ?? null } });
  }, { isolationLevel: "Serializable" });

  const inicio = Date.now();
  const tmp = await mkdtemp(join(tmpdir(), "g360-respaldo-"));
  let resultado: ResultadoRespaldo = { id: fila.id, estado: "ERROR", archivo: null, tamano: null, destinos: [], error: null };
  try {
    // 1. La base, con pg_dump, comprobada con pg_restore --list.
    const dump = join(tmp, "g360-nomina.dump");
    const c = conexion();
    const r = await correr(pg.pgDump, [...c.args, "-Fc", "-f", dump], c.env, 1_800_000);
    if (r.codigo !== 0) throw new ErrorRespaldo(`pg_dump falló: ${r.salida.trim().split(/\r?\n/).slice(-2).join(" ")}`);
    const lista = await correr(pg.pgRestore, ["--list", dump], c.env, 300_000);
    if (lista.codigo !== 0) throw new ErrorRespaldo("El volcado de la base no se pudo leer con pg_restore: no se envía.");
    const dumpSha = await sha256De(dump);
    const dumpBytes = (await stat(dump)).size;

    // 2. Adjuntos y manifiesto.
    const adjuntos = config.incluirAdjuntos && process.env.UPLOAD_DIR ? await archivosBajo(resolve(process.env.UPLOAD_DIR)) : [];
    const [empleados, planillas] = await Promise.all([prisma.empleado.count(), prisma.planilla.count()]);
    const creado = new Date();
    const manifiesto = {
      producto: "Gestión360 Nómina",
      version: VERSION,
      creado: creado.toISOString(),
      tipo,
      base: { nombre: c.base, archivo: "base/g360-nomina.dump", bytes: dumpBytes, sha256: dumpSha, pgDump: pg.version, objetos: lista.salida.split(/\r?\n/).filter((l) => l && !l.startsWith(";")).length },
      adjuntos: { archivos: adjuntos.length, bytes: adjuntos.reduce((a, x) => a + x.bytes, 0) },
      conteos: { empleados, planillas },
      cifrado: config.cifrar ? "openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256" : null,
      restaurar: [
        ...(config.cifrar ? ["openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in RESPALDO.tar.gz.enc -out RESPALDO.tar.gz"] : []),
        "tar -xzf RESPALDO.tar.gz",
        "pg_restore -h HOST -p PUERTO -U USUARIO -d BASE --clean --if-exists base/g360-nomina.dump",
      ],
    };
    const entradas: EntradaTar[] = [
      { nombre: "manifiesto.json", contenido: Buffer.from(JSON.stringify(manifiesto, null, 2)) },
      { nombre: "base/g360-nomina.dump", ruta: dump },
      ...adjuntos.map((a) => ({ nombre: `adjuntos/${a.relativa}`, ruta: a.ruta })),
    ];

    // 3. El archivo: tar → gzip → (cifrado).
    const nombre = nombreArchivo(creado, tipo, config.cifrar);
    const archivo = join(tmp, nombre);
    const clave = config.cifrar ? descifrar(config.claveCifrado!) : null;
    if (clave) await pipeline(flujoTar(entradas), createGzip(), cifradorOpenssl(clave), createWriteStream(archivo));
    else await pipeline(flujoTar(entradas), createGzip(), createWriteStream(archivo));

    // 4. Se lee de vuelta antes de mandarlo a ningún lado.
    const leer = clave ? createReadStream(archivo).pipe(descifradorOpenssl(clave)).pipe(createGunzip()) : createReadStream(archivo).pipe(createGunzip());
    const miembros = await inspeccionarTar(leer);
    const enArchivo = miembros.find((m) => m.nombre === "base/g360-nomina.dump");
    if (!enArchivo || enArchivo.sha256 !== dumpSha || miembros.length !== entradas.length) {
      throw new ErrorRespaldo("El archivo de respaldo no coincide con lo que se metió en él: no se envía.");
    }
    const tamano = (await stat(archivo)).size;
    const sha256 = await sha256De(archivo);

    // 5. A cada destino, uno tras otro.
    const enviados: ResultadoDestino[] = [];
    for (const d of destinos) enviados.push(await enviarADestino(d, archivo, nombre, config.conservar));
    const buenos = enviados.filter((x) => x.ok).length;
    const estado = buenos === enviados.length ? "OK" : buenos > 0 ? "PARCIAL" : "ERROR";
    resultado = { id: fila.id, estado, archivo: nombre, tamano, destinos: enviados, error: estado === "OK" ? null : enviados.filter((x) => !x.ok).map((x) => `${x.nombre}: ${x.error}`).join(" · ") };
    await prisma.respaldo.update({
      where: { id: fila.id },
      data: { estado, archivo: nombre, tamano: BigInt(tamano), sha256, destinos: enviados as unknown as Prisma.InputJsonValue, error: resultado.error, duracionMs: Date.now() - inicio, terminadoAt: new Date() },
    });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    resultado = { ...resultado, estado: "ERROR", error: mensaje };
    await prisma.respaldo.update({ where: { id: fila.id }, data: { estado: "ERROR", error: mensaje, duracionMs: Date.now() - inicio, terminadoAt: new Date() } });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  await audit({
    accion: "CREATE", tabla: "Respaldo", registroId: fila.id, usuarioId: usuario.id, usuarioEmail: usuario.email,
    valorNuevo: { tipo, estado: resultado.estado, archivo: resultado.archivo, tamano: resultado.tamano, destinos: resultado.destinos.map((d) => ({ nombre: d.nombre, ok: d.ok, error: d.error })) },
  });
  return resultado;
}

/** El cron: hace el automático si toca. */
export async function respaldoProgramado(ahora = new Date()): Promise<{ hecho: boolean; resultado?: ResultadoRespaldo; motivo?: string }> {
  const config = await leerConfigRespaldos();
  if (!config.automatico.activo) return { hecho: false, motivo: "El respaldo automático está apagado." };
  const intentos = await prisma.respaldo.findMany({
    where: { tipo: "AUTOMATICO", createdAt: { gte: new Date(ahora.getTime() - 8 * 86_400_000) } },
    select: { createdAt: true, estado: true },
  });
  if (!debeIntentar(config.automatico, intentos.map((i) => ({ fecha: i.createdAt, estado: i.estado })), ahora)) {
    return { hecho: false, motivo: "No toca todavía." };
  }
  return { hecho: true, resultado: await crearRespaldo("AUTOMATICO", { email: "respaldo automático" }) };
}
