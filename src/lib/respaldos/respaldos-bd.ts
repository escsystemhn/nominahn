/**
 * Respaldos: configuración guardada, ejecución e historial. SERVIDOR.
 *
 * Un respaldo es UN archivo `.tar.gz` (cifrado opcional, `.enc`, formato OpenSSL):
 *   manifiesto.json          qué es, de cuándo, huellas y cómo restaurarlo
 *   base/g360-nomina.dump    pg_dump en formato custom (se restaura con pg_restore)
 *   adjuntos/…               los documentos subidos (UPLOAD_DIR)
 * Se arma en una carpeta temporal, se verifica leyéndolo de vuelta y recién entonces
 * se copia a cada destino. La carpeta temporal se borra siempre.
 *
 * 2026-11-25 (auditoría): la carpeta temporal va en el disco de los datos
 * (`RESPALDOS_TMP` o `RESPALDOS_DIR`), con el espacio revisado antes; «Respaldar ahora»
 * corre en segundo plano (la pantalla consulta su estado); un respaldo que quedó «en
 * curso» por un corte se marca como interrumpido; y un fallo avisa por correo.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, statfs } from "node:fs/promises";
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
import { alertarResultado } from "./alertas";
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
    retencion: e.retencion,
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

/** Un respaldo «en curso» de hace más de esto quedó cortado (se reinició el servidor o se fue la luz). */
const VIGENCIA_EN_CURSO_MS = 3 * 3_600_000;

/** Marca como interrumpidos los que quedaron «en curso» de un corte. */
export async function limpiarHuerfanos(): Promise<number> {
  const r = await prisma.respaldo.updateMany({
    where: { estado: "EN_CURSO", createdAt: { lt: new Date(Date.now() - VIGENCIA_EN_CURSO_MS) } },
    data: { estado: "ERROR", error: "Se interrumpió: el servidor se reinició o se apagó mientras respaldaba.", terminadoAt: new Date() },
  });
  return r.count;
}

/**
 * Dónde se arma el respaldo: en el disco de los datos y no en el TEMP del sistema, que
 * suele ser el disco más chico. `RESPALDOS_TMP` manda; si no, `RESPALDOS_DIR\.tmp`.
 */
async function carpetaDeTrabajo(): Promise<string> {
  const base = process.env.RESPALDOS_TMP || (process.env.RESPALDOS_DIR ? join(process.env.RESPALDOS_DIR, ".tmp") : tmpdir());
  await mkdir(base, { recursive: true });
  return base;
}

const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

/** Hace falta lugar para el volcado y para el archivo final: el doble de la base, más los adjuntos. */
async function revisarEspacio(carpeta: string, adjuntosBytes: number): Promise<void> {
  const filas = await prisma.$queryRaw<Array<{ tamano: bigint }>>`SELECT pg_database_size(current_database()) AS tamano`;
  const base = Number(filas[0]?.tamano ?? 0);
  const necesita = base * 2 + adjuntosBytes * 2 + 64 * 1024 ** 2;
  const libre = await statfs(carpeta).then((x) => x.bavail * x.bsize).catch(() => null);
  if (libre !== null && libre < necesita) {
    throw new ErrorRespaldo(`No hay espacio para armar el respaldo en ${carpeta}: hace falta unos ${gb(necesita)} y quedan ${gb(libre)}. Libere espacio o indique RESPALDOS_TMP en otro disco.`);
  }
}

export interface ResultadoRespaldo {
  id: string;
  estado: "OK" | "PARCIAL" | "ERROR";
  archivo: string | null;
  tamano: number | null;
  destinos: ResultadoDestino[];
  error: string | null;
}

/** Los respaldos que siguen corriendo en este proceso (que el recolector no los suelte). */
const enMarcha = new Set<Promise<unknown>>();

/**
 * Empieza un respaldo y devuelve su número sin esperarlo: «Respaldar ahora» responde de
 * inmediato y la pantalla consulta el estado. Uno a la vez: si hay otro en curso, se rechaza.
 */
export async function iniciarRespaldo(tipo: "MANUAL" | "AUTOMATICO", usuario: { id?: string; email?: string } = {}): Promise<{ id: string; terminado: Promise<ResultadoRespaldo> }> {
  await limpiarHuerfanos();
  const config = await leerConfigRespaldos();
  const destinos = config.destinos.filter((d) => d.activo);
  if (destinos.length === 0) throw new ErrorRespaldo("No hay ningún destino activo: agregue uno (disco local, extraíble, red o nube).");
  const pg = ubicarPostgres();
  if ("error" in pg) throw new ErrorRespaldo(pg.error);
  if (config.cifrar && !config.claveCifrado) throw new ErrorRespaldo("El cifrado está activo pero falta su contraseña.");

  const fila = await prisma.$transaction(async (tx) => {
    const enCurso = await tx.respaldo.findFirst({ where: { estado: "EN_CURSO", createdAt: { gte: new Date(Date.now() - VIGENCIA_EN_CURSO_MS) } }, select: { id: true } });
    if (enCurso) throw new ErrorRespaldo("Ya hay un respaldo en curso. Espere a que termine.");
    return tx.respaldo.create({ data: { tipo, estado: "EN_CURSO", cifrado: config.cifrar, incluyeAdjuntos: config.incluirAdjuntos, usuarioId: usuario.id ?? null } });
  }, { isolationLevel: "Serializable" });

  const terminado = ejecutarRespaldo(fila.id, tipo, config, pg, usuario);
  enMarcha.add(terminado);
  void terminado.finally(() => enMarcha.delete(terminado));
  return { id: fila.id, terminado };
}

/** Hace el respaldo y espera a que termine (el automático). */
export async function crearRespaldo(tipo: "MANUAL" | "AUTOMATICO", usuario: { id?: string; email?: string } = {}): Promise<ResultadoRespaldo> {
  return (await iniciarRespaldo(tipo, usuario)).terminado;
}

async function ejecutarRespaldo(
  id: string, tipo: "MANUAL" | "AUTOMATICO", config: ConfigRespaldos, pg: Postgres, usuario: { id?: string; email?: string },
): Promise<ResultadoRespaldo> {
  const fila = { id };
  const destinos = config.destinos.filter((d) => d.activo);
  const inicio = Date.now();
  let resultado: ResultadoRespaldo = { id: fila.id, estado: "ERROR", archivo: null, tamano: null, destinos: [], error: null };
  let tmp: string | null = null;
  try {
    const trabajo = await carpetaDeTrabajo();
    const adjuntosPrevios = config.incluirAdjuntos && process.env.UPLOAD_DIR ? await archivosBajo(resolve(process.env.UPLOAD_DIR)) : [];
    await revisarEspacio(trabajo, adjuntosPrevios.reduce((a, x) => a + x.bytes, 0));
    tmp = await mkdtemp(join(trabajo, "g360-respaldo-"));
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
    const adjuntos = adjuntosPrevios;
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
      // En la instalación de Windows lo hace todo, con un respaldo previo: g360 restaurar --archivo RESPALDO.
      restaurar: [
        ...(config.cifrar ? ["openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -in RESPALDO.tar.gz.enc -out RESPALDO.tar.gz"] : []),
        "tar -xzf RESPALDO.tar.gz",
        // Sin dueños ni permisos: en otro servidor el rol original puede no existir.
        "createdb -h HOST -p PUERTO -U SUPERUSUARIO -O ROL_DE_LA_APP BASE_NUEVA",
        "pg_restore -h HOST -p PUERTO -U ROL_DE_LA_APP -d BASE_NUEVA --no-owner --no-privileges --exit-on-error base/g360-nomina.dump",
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

    // 5. A cada destino, uno tras otro; cada copia se verifica con la huella del original.
    const enviados: ResultadoDestino[] = [];
    for (const d of destinos) enviados.push(await enviarADestino(d, archivo, nombre, sha256, config.retencion));
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
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }

  await alertarResultado({ estado: resultado.estado, error: resultado.error, archivo: resultado.archivo, tipo });
  await audit({
    accion: "CREATE", tabla: "Respaldo", registroId: fila.id, usuarioId: usuario.id, usuarioEmail: usuario.email,
    valorNuevo: { tipo, estado: resultado.estado, archivo: resultado.archivo, tamano: resultado.tamano, destinos: resultado.destinos.map((d) => ({ nombre: d.nombre, ok: d.ok, error: d.error })) },
  });
  return resultado;
}

/** El cron: hace el automático si toca. */
export async function respaldoProgramado(ahora = new Date()): Promise<{ hecho: boolean; resultado?: ResultadoRespaldo; motivo?: string }> {
  await limpiarHuerfanos();
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
