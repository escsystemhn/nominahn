/**
 * Estado de la licencia de la edición instalable: evaluación, licenciada o bloqueada.
 *
 * Lo consulta el proxy en cada petición (con caché de un minuto) y lo muestran el
 * aviso del panel y la pantalla /licencia. Fuera de la edición instalable
 * devuelve «libre» sin leer nada.
 *
 * ORDEN DE DECISIÓN
 *   1. Un archivo de activación de SDL válido para este equipo → licenciada. Si el
 *      archivo pide revalidarse en línea (`refresh_before`) y no se puede, se
 *      bloquea; si SDL dice que la licencia fue retirada, se borra el archivo.
 *   2. Si no hay licencia, la evaluación: el inicio más antiguo entre el registro
 *      de Windows, el archivo de ProgramData y la base de datos (ver ancla.ts).
 *      Un registro alterado o de otro equipo bloquea.
 *   3. Día 31 → bloqueada. Los datos no se tocan: activar una licencia los devuelve.
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import { EDICION_INSTALABLE, SDL_URL, SDL_PRODUCTO, VERSION_APP, clavesSdl } from "./edicion";
import { identidadEquipo, leerRegistro, RUTA_REGISTRO, type IdentidadEquipo } from "./equipo";
import { calcularEvaluacion, fechaLarga, type Evaluacion } from "./evaluacion";
import { firmarAncla, leerAncla, combinarAnclas, type LecturaAncla } from "./ancla";
import {
  verificarArchivoActivacion,
  llamarSdl,
  normalizarLlave,
  ERRORES_QUE_BLOQUEAN,
  MENSAJE_ERROR_ARCHIVO,
  type ClaimsActivacion,
} from "./sdl";

export const CLAVE_BD_EVALUACION = "SISTEMA_EVALUACION";
export const CLAVE_BD_ACTIVACION = "SISTEMA_ACTIVACION";
const ARCHIVO_EVALUACION = "evaluacion.dat";
const ARCHIVO_ACTIVACION = "activacion.json";

const VIGENCIA_CACHE_MS = 60_000;
/** La mayor fecha vista se reescribe como mucho cada 10 minutos, no en cada petición. */
const AVANCE_MINIMO_MS = 10 * 60_000;
const UN_DIA_MS = 86_400_000;

export type MotivoBloqueo =
  | "evaluacion_vencida"
  | "evaluacion_alterada"
  | "otro_equipo"
  | "requiere_validacion"
  | "licencia_retirada"
  | "sin_identidad";

export interface LicenciaVigente {
  cliente: string;
  edicion: string | null;
  tipo: string | null;
  /** ISO o null si es perpetua. */
  venceEn: string | null;
  /** ISO o null si se activó sin conexión. */
  refrescarAntes: string | null;
  enLinea: boolean;
}

export type EstadoLicencia =
  | { modo: "libre" }
  /** La base no respondió: no se puede decidir y no se bloquea por un hipo. */
  | { modo: "indeterminado" }
  | { modo: "evaluacion"; codigoEquipo: string; evaluacion: Evaluacion }
  | { modo: "licenciada"; codigoEquipo: string; licencia: LicenciaVigente }
  | {
      modo: "bloqueada";
      codigoEquipo: string | null;
      motivo: MotivoBloqueo;
      mensaje: string;
      evaluacion?: Evaluacion;
    };

interface ActivacionGuardada {
  archivo: string;
  /** Sólo si se activó en línea: hace falta para revalidar con SDL. */
  llave?: string;
}

const g = globalThis as unknown as {
  __g360Licencia?: { estado: EstadoLicencia; hasta: number };
  __g360UltimaValidacion?: number;
  __g360ValidandoEnFondo?: boolean;
  __g360MensajeRetiro?: string;
};

// ─── Almacenes ───────────────────────────────────────────────────────────────

function dirLicencia(): string | null {
  return process.env.LICENCIA_DIR || null;
}

/*
 * `turbopackIgnore`: la carpeta llega por LICENCIA_DIR en tiempo de ejecución.
 * Sin la marca, Turbopack no puede acotar la ruta y copia el proyecto ENTERO
 * (src, docs, deploy…) dentro del standalone que va en el instalador.
 */
function rutaLicencia(dir: string, nombre: string): string {
  return path.join(/*turbopackIgnore: true*/ dir, nombre);
}

async function leerArchivo(nombre: string): Promise<string | null> {
  const dir = dirLicencia();
  if (!dir) return null;
  try {
    return (await fs.readFile(/*turbopackIgnore: true*/ rutaLicencia(dir, nombre), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function escribirArchivo(nombre: string, contenido: string | null): Promise<void> {
  const dir = dirLicencia();
  if (!dir) return;
  try {
    if (contenido === null) {
      await fs.rm(/*turbopackIgnore: true*/ rutaLicencia(dir, nombre), { force: true });
      return;
    }
    await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ rutaLicencia(dir, nombre), contenido, "utf8");
  } catch (e) {
    console.error(`[licencia] no se pudo escribir ${nombre}:`, e instanceof Error ? e.message : e);
  }
}

async function leerBd(clave: string): Promise<string | null> {
  const fila = await prisma.configuracionSistema.findUnique({ where: { clave }, select: { valor: true } });
  return fila?.valor?.trim() || null;
}

async function escribirBd(clave: string, valor: string | null, descripcion: string): Promise<void> {
  try {
    if (valor === null) {
      await prisma.configuracionSistema.deleteMany({ where: { clave } });
      return;
    }
    await prisma.configuracionSistema.upsert({
      where: { clave },
      update: { valor },
      create: { clave, valor, descripcion },
    });
  } catch (e) {
    console.error(`[licencia] no se pudo guardar ${clave}:`, e instanceof Error ? e.message : e);
  }
}

// ─── Activación ──────────────────────────────────────────────────────────────

function parsearActivacion(texto: string | null): ActivacionGuardada | null {
  if (!texto) return null;
  try {
    const o = JSON.parse(texto);
    return typeof o?.archivo === "string" ? { archivo: o.archivo, llave: typeof o.llave === "string" ? o.llave : undefined } : null;
  } catch {
    return null;
  }
}

async function leerActivacion(): Promise<ActivacionGuardada[]> {
  const [archivo, bd] = await Promise.all([leerArchivo(ARCHIVO_ACTIVACION), leerBd(CLAVE_BD_ACTIVACION)]);
  return [parsearActivacion(archivo), parsearActivacion(bd)].filter((a): a is ActivacionGuardada => a !== null);
}

async function guardarActivacion(a: ActivacionGuardada | null): Promise<void> {
  const texto = a ? JSON.stringify(a) : null;
  await Promise.all([
    escribirArchivo(ARCHIVO_ACTIVACION, texto),
    escribirBd(CLAVE_BD_ACTIVACION, texto, "Activación de la licencia (archivo firmado por SDL). No editar."),
  ]);
}

function verificar(archivo: string, equipo: IdentidadEquipo, ahora: number) {
  return verificarArchivoActivacion(archivo, {
    claves: clavesSdl(),
    producto: SDL_PRODUCTO,
    codigoEquipo: equipo.codigo,
    ahora,
  });
}

function aVigente(c: ClaimsActivacion): LicenciaVigente {
  return {
    cliente: c.customer,
    edicion: c.edition_name ?? c.edition ?? null,
    tipo: c.license_type ?? null,
    venceEn: c.expires_at,
    refrescarAntes: c.refresh_before,
    enLinea: c.refresh_before !== null,
  };
}

type ResultadoRevalidacion =
  | { tipo: "renovada"; claims: ClaimsActivacion }
  | { tipo: "sin_red" }
  | { tipo: "retirada"; mensaje: string };

async function revalidar(a: ActivacionGuardada, equipo: IdentidadEquipo): Promise<ResultadoRevalidacion> {
  if (!a.llave || !SDL_URL) return { tipo: "sin_red" };
  const r = await llamarSdl(SDL_URL, "/validate", {
    license_key: a.llave,
    fingerprint: equipo.codigo,
    app_version: VERSION_APP,
    product: SDL_PRODUCTO,
  });
  g.__g360UltimaValidacion = Date.now();
  if (r.ok) {
    const v = verificar(r.activation_file, equipo, Date.now());
    if (!v.ok) return { tipo: "sin_red" };
    await guardarActivacion({ archivo: r.activation_file, llave: a.llave });
    return { tipo: "renovada", claims: v.claims };
  }
  if (!r.red && ERRORES_QUE_BLOQUEAN.has(r.error)) {
    await guardarActivacion(null);
    return { tipo: "retirada", mensaje: r.message ?? "La licencia fue retirada por el proveedor." };
  }
  return { tipo: "sin_red" };
}

// ─── Evaluación ──────────────────────────────────────────────────────────────

interface FuenteAncla {
  origen: "registro" | "archivo" | "bd";
  token: string | null;
}

async function leerAnclas(): Promise<FuenteAncla[]> {
  const [registro, archivo, bd] = await Promise.all([
    leerRegistro(RUTA_REGISTRO, "Evaluacion"),
    leerArchivo(ARCHIVO_EVALUACION),
    leerBd(CLAVE_BD_EVALUACION),
  ]);
  return [
    { origen: "registro", token: registro },
    { origen: "archivo", token: archivo },
    { origen: "bd", token: bd },
  ];
}

async function guardarAncla(token: string, faltantes: Set<FuenteAncla["origen"]>, forzar: boolean): Promise<void> {
  // El registro de Windows lo escribe sólo el instalador (corre como administrador;
  // la cuenta del servicio no puede ni debe tocar HKLM).
  const tareas: Promise<void>[] = [];
  if (forzar || faltantes.has("archivo")) tareas.push(escribirArchivo(ARCHIVO_EVALUACION, token));
  if (forzar || faltantes.has("bd")) {
    tareas.push(escribirBd(CLAVE_BD_EVALUACION, token, "Registro de la evaluación de 30 días. No editar: alterarlo bloquea el sistema."));
  }
  await Promise.all(tareas);
}

const MENSAJES: Record<Exclude<MotivoBloqueo, "evaluacion_vencida" | "licencia_retirada">, string> = {
  evaluacion_alterada:
    "El registro de la evaluación fue modificado o está dañado. Sus datos siguen guardados; para continuar, active una licencia.",
  otro_equipo:
    "El registro de la evaluación pertenece a otro equipo. Sus datos siguen guardados; para continuar, active una licencia.",
  requiere_validacion:
    "La licencia debe confirmarse en línea con ESC System y no se pudo contactar al servidor de licencias. Revise la conexión a internet del servidor.",
  sin_identidad: "No se pudo leer la identificación de este equipo en el registro de Windows.",
};

// ─── Cálculo ─────────────────────────────────────────────────────────────────

async function calcular(): Promise<EstadoLicencia> {
  let equipo: IdentidadEquipo;
  try {
    equipo = await identidadEquipo();
  } catch {
    return { modo: "bloqueada", codigoEquipo: null, motivo: "sin_identidad", mensaje: MENSAJES.sin_identidad };
  }

  let fuentes: FuenteAncla[];
  let activaciones: ActivacionGuardada[];
  try {
    [fuentes, activaciones] = await Promise.all([leerAnclas(), leerActivacion()]);
  } catch {
    return { modo: "indeterminado" };
  }

  const lecturas = new Map<FuenteAncla["origen"], LecturaAncla>();
  for (const f of fuentes) if (f.token) lecturas.set(f.origen, leerAncla(f.token, equipo.machineGuid));
  const anclas = combinarAnclas([...lecturas.values()]);

  const ahora = Date.now();
  const mayorVistoPrevio = anclas.estado === "valida" ? anclas.mayorVisto.getTime() : 0;
  const efectivo = Math.max(ahora, mayorVistoPrevio);

  // La mayor fecha vista avanza con o sin licencia: también protege su vencimiento.
  if (anclas.estado === "valida") {
    const faltantes = new Set<FuenteAncla["origen"]>(
      (["archivo", "bd"] as const).filter((o) => lecturas.get(o)?.estado !== "valida")
    );
    const avanza = ahora - mayorVistoPrevio >= AVANCE_MINIMO_MS;
    if (avanza || faltantes.size > 0) {
      const token = firmarAncla(
        { inicio: anclas.inicio.toISOString(), mayorVisto: new Date(efectivo).toISOString() },
        equipo.machineGuid
      );
      await guardarAncla(token, faltantes, avanza);
    }
  }

  // 1. Licencia.
  let licenciaVencida = false;
  for (const a of activaciones) {
    const v = verificar(a.archivo, equipo, efectivo);
    if (!v.ok) {
      if (v.error === "vencida") licenciaVencida = true;
      continue;
    }
    const refrescar = v.claims.refresh_before ? Date.parse(v.claims.refresh_before) : null;
    if (refrescar !== null && ahora >= refrescar) {
      const r = await revalidar(a, equipo);
      if (r.tipo === "renovada") return { modo: "licenciada", codigoEquipo: equipo.codigo, licencia: aVigente(r.claims) };
      if (r.tipo === "sin_red") {
        return { modo: "bloqueada", codigoEquipo: equipo.codigo, motivo: "requiere_validacion", mensaje: MENSAJES.requiere_validacion };
      }
      g.__g360MensajeRetiro = r.mensaje;
      break;
    }
    if (refrescar !== null) {
      const cerca = refrescar - ahora < 7 * UN_DIA_MS;
      const hace = ahora - (g.__g360UltimaValidacion ?? 0);
      if ((cerca || hace >= UN_DIA_MS) && !g.__g360ValidandoEnFondo) {
        g.__g360ValidandoEnFondo = true;
        void revalidar(a, equipo)
          .then((r) => {
            if (r.tipo === "retirada") {
              g.__g360MensajeRetiro = r.mensaje;
              invalidarCacheLicencia();
            }
          })
          .finally(() => (g.__g360ValidandoEnFondo = false));
      }
    }
    return { modo: "licenciada", codigoEquipo: equipo.codigo, licencia: aVigente(v.claims) };
  }

  // 2. Evaluación.
  if (anclas.estado === "otro_equipo" || anclas.estado === "alterada") {
    const motivo = anclas.estado === "otro_equipo" ? "otro_equipo" : "evaluacion_alterada";
    return { modo: "bloqueada", codigoEquipo: equipo.codigo, motivo, mensaje: MENSAJES[motivo] };
  }

  let inicio: Date;
  if (anclas.estado === "sin_registro") {
    // Sólo pasa si alguien borró los tres registros: el instalador siempre deja
    // el de Windows y el de ProgramData. Se empieza a contar desde ahora.
    inicio = new Date(ahora);
    const token = firmarAncla({ inicio: inicio.toISOString(), mayorVisto: inicio.toISOString() }, equipo.machineGuid);
    await guardarAncla(token, new Set(["archivo", "bd"]), true);
  } else {
    inicio = anclas.inicio;
  }

  const evaluacion = calcularEvaluacion(inicio, new Date(ahora), new Date(mayorVistoPrevio));
  if (!evaluacion.vencida) return { modo: "evaluacion", codigoEquipo: equipo.codigo, evaluacion };

  if (g.__g360MensajeRetiro) {
    return { modo: "bloqueada", codigoEquipo: equipo.codigo, motivo: "licencia_retirada", mensaje: g.__g360MensajeRetiro, evaluacion };
  }
  return {
    modo: "bloqueada",
    codigoEquipo: equipo.codigo,
    motivo: "evaluacion_vencida",
    mensaje: licenciaVencida
      ? "La licencia de este equipo venció. Sus datos siguen guardados; renueve la licencia para seguir usándolos."
      : `La evaluación de 30 días terminó ${fechaLarga(evaluacion.ultimoDia)}. Sus datos siguen guardados; active una licencia para seguir usándolos.`,
    evaluacion,
  };
}

// ─── API del módulo ──────────────────────────────────────────────────────────

export async function estadoLicencia(): Promise<EstadoLicencia> {
  if (!EDICION_INSTALABLE) return { modo: "libre" };

  const cache = g.__g360Licencia;
  if (cache && Date.now() < cache.hasta) return cache.estado;

  const estado = await calcular();
  if (estado.modo !== "indeterminado") g.__g360Licencia = { estado, hasta: Date.now() + VIGENCIA_CACHE_MS };
  return estado;
}

export function invalidarCacheLicencia(): void {
  g.__g360Licencia = undefined;
}

export type ResultadoActivacion = { ok: true; estado: EstadoLicencia } | { ok: false; mensaje: string };

async function concluirActivacion(a: ActivacionGuardada): Promise<ResultadoActivacion> {
  await guardarActivacion(a);
  g.__g360MensajeRetiro = undefined;
  g.__g360UltimaValidacion = Date.now();
  invalidarCacheLicencia();
  return { ok: true, estado: await estadoLicencia() };
}

/** Activación sin conexión: el texto `SDL1.…` del archivo .lic que emite SDL. */
export async function activarConArchivo(texto: string): Promise<ResultadoActivacion> {
  if (!EDICION_INSTALABLE) return { ok: false, mensaje: "Esta edición no usa licencia." };
  const equipo = await identidadEquipo();
  const archivo = texto.trim();
  const v = verificar(archivo, equipo, Date.now());
  if (!v.ok) return { ok: false, mensaje: MENSAJE_ERROR_ARCHIVO[v.error] };
  return concluirActivacion({ archivo });
}

/** Activación en línea: la llave se canjea en SDL por un archivo firmado para este equipo. */
export async function activarConLlave(llaveEscrita: string): Promise<ResultadoActivacion> {
  if (!EDICION_INSTALABLE) return { ok: false, mensaje: "Esta edición no usa licencia." };
  if (!SDL_URL) {
    return { ok: false, mensaje: "Este instalador no tiene configurado el servidor de licencias. Use la activación con archivo." };
  }
  const llave = normalizarLlave(llaveEscrita);
  if (!llave) return { ok: false, mensaje: "La llave está mal escrita. Revise cada carácter (no lleva 0, O, 1, I ni L)." };

  const equipo = await identidadEquipo();
  const r = await llamarSdl(SDL_URL, "/activate", {
    license_key: llave,
    fingerprint: equipo.codigo,
    machine_name: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    app_version: VERSION_APP,
    product: SDL_PRODUCTO,
  });
  if (!r.ok) return { ok: false, mensaje: r.message ?? "El servidor de licencias rechazó la llave." };

  const v = verificar(r.activation_file, equipo, Date.now());
  if (!v.ok) return { ok: false, mensaje: MENSAJE_ERROR_ARCHIVO[v.error] };
  return concluirActivacion({ archivo: r.activation_file, llave });
}

/** Lo que puede ver cualquiera con sesión. Nunca la llave ni el archivo. */
export function hayServidorDeLicencias(): boolean {
  return SDL_URL !== "";
}
