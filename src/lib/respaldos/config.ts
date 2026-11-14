/**
 * Respaldos: configuración, destinos y programación. PURO (lo usan la pantalla y el
 * servidor). Las claves (red y nube, y la de cifrado) se guardan cifradas con
 * CIFRADO_KEY y nunca viajan de vuelta a la pantalla: sólo «tiene clave».
 */

import { z } from "zod";

export const CLAVE_RESPALDOS = "RESPALDOS_CONFIG";
/** Así empiezan los archivos de respaldo: la poda sólo toca los que empiezan así. */
export const PREFIJO_ARCHIVO = "g360-nomina_";
export const MAX_DESTINOS = 6;
export const MAX_CONSERVAR = 365;
/** Honduras no cambia de hora: UTC−6 todo el año. */
const DESFASE_HN_MS = -6 * 3_600_000;

export type TipoDestino = "LOCAL" | "RED" | "NUBE";
export type ProveedorS3 = "AWS" | "B2" | "WASABI" | "DO" | "R2" | "OTRO";

export const PROVEEDORES_S3: Record<ProveedorS3, { nombre: string; region: string; endpoint: (region: string) => string; estiloRuta: boolean; ayuda: string }> = {
  AWS: { nombre: "Amazon S3", region: "us-east-1", endpoint: (r) => `https://s3.${r}.amazonaws.com`, estiloRuta: false, ayuda: "IAM → usuario con permiso s3:PutObject, s3:ListBucket y s3:DeleteObject sobre el bucket." },
  B2: { nombre: "Backblaze B2", region: "us-west-004", endpoint: (r) => `https://s3.${r}.backblazeb2.com`, estiloRuta: true, ayuda: "App Keys → clave de aplicación con acceso de lectura y escritura al bucket. La región es la del endpoint del bucket." },
  WASABI: { nombre: "Wasabi", region: "us-east-1", endpoint: (r) => `https://s3.${r}.wasabisys.com`, estiloRuta: true, ayuda: "Access Keys → crear una clave; la región es la del bucket." },
  DO: { nombre: "DigitalOcean Spaces", region: "nyc3", endpoint: (r) => `https://${r}.digitaloceanspaces.com`, estiloRuta: true, ayuda: "API → Spaces Keys. El «bucket» es el nombre del Space." },
  R2: { nombre: "Cloudflare R2", region: "auto", endpoint: () => "https://<id-de-cuenta>.r2.cloudflarestorage.com", estiloRuta: true, ayuda: "R2 → Manage API Tokens → token de lectura y escritura. Reemplace <id-de-cuenta> en el endpoint." },
  OTRO: { nombre: "Otro compatible con S3 (MinIO…)", region: "us-east-1", endpoint: () => "https://", estiloRuta: true, ayuda: "Endpoint, región y claves que indique el proveedor." },
};

export interface DestinoLocal { id: string; nombre: string; activo: boolean; tipo: "LOCAL"; carpeta: string }
export interface DestinoRed { id: string; nombre: string; activo: boolean; tipo: "RED"; ruta: string; usuario: string | null; clave: string | null }
export interface DestinoNube {
  id: string; nombre: string; activo: boolean; tipo: "NUBE";
  proveedor: ProveedorS3; endpoint: string; region: string; bucket: string; prefijo: string;
  accessKeyId: string; secretAccessKey: string | null; estiloRuta: boolean;
}
export type Destino = DestinoLocal | DestinoRed | DestinoNube;

export interface ProgramacionRespaldo {
  activo: boolean;
  frecuencia: "DIARIA" | "SEMANAL";
  /** «HH:MM», hora de Honduras. */
  hora: string;
  /** 0 = domingo … 6 = sábado (SEMANAL). */
  diaSemana: number;
  /** Cuándo se encendió: lo programado antes no se recupera. */
  activadoEn: string | null;
}

export interface ConfigRespaldos {
  automatico: ProgramacionRespaldo;
  /** Cuántos respaldos se conservan en CADA destino. */
  conservar: number;
  incluirAdjuntos: boolean;
  cifrar: boolean;
  /** Cifrada con CIFRADO_KEY al guardar. */
  claveCifrado: string | null;
  destinos: Destino[];
}

export const CONFIG_POR_OMISION: ConfigRespaldos = {
  automatico: { activo: false, frecuencia: "DIARIA", hora: "01:30", diaSemana: 0, activadoEn: null },
  conservar: 14,
  incluirAdjuntos: true,
  cifrar: false,
  claveCifrado: null,
  destinos: [],
};

// ─── Validación de lo que manda la pantalla ──────────────────────────────────
// Una clave en `null` o ausente = «dejar la que estaba»; "" = quitarla.

const zId = z.string().trim().min(1).max(40);
const zNombre = z.string().trim().min(1, "Póngale un nombre").max(60);
const zClaveOpcional = z.string().max(500).nullable().optional();

export const ESQUEMA_RUTA_WINDOWS = /^[a-zA-Z]:[\\/]/;
export const ESQUEMA_UNC = /^\\\\[^\\/]+[\\/][^\\/]+/;

const zLocal = z.object({
  id: zId, nombre: zNombre, activo: z.boolean(), tipo: z.literal("LOCAL"),
  carpeta: z.string().trim().min(2).max(400).refine((c) => ESQUEMA_RUTA_WINDOWS.test(c) || c.startsWith("/"), "La carpeta debe ser una ruta completa, como D:\\Respaldos"),
});
const zRed = z.object({
  id: zId, nombre: zNombre, activo: z.boolean(), tipo: z.literal("RED"),
  ruta: z.string().trim().max(400).refine((c) => ESQUEMA_UNC.test(c), "La ruta de red se escribe \\\\servidor\\carpeta"),
  usuario: z.string().trim().max(120).nullable(),
  clave: zClaveOpcional,
});
const zNube = z.object({
  id: zId, nombre: zNombre, activo: z.boolean(), tipo: z.literal("NUBE"),
  proveedor: z.enum(["AWS", "B2", "WASABI", "DO", "R2", "OTRO"]),
  endpoint: z.string().trim().url("El endpoint debe ser una dirección https://").max(300).refine((u) => !u.includes("<"), "Complete el endpoint"),
  region: z.string().trim().min(1).max(40),
  bucket: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "Nombre de bucket inválido (minúsculas, números, puntos y guiones)"),
  prefijo: z.string().trim().max(200).regex(/^[^\\]*$/, "Use «/» en la carpeta, no «\\»").transform((p) => {
    const limpio = p.replace(/^\/+|\/+$/g, "");
    return limpio ? `${limpio}/` : "";
  }),
  accessKeyId: z.string().trim().min(3).max(200),
  secretAccessKey: zClaveOpcional,
  estiloRuta: z.boolean(),
});
export const esquemaDestino = z.discriminatedUnion("tipo", [zLocal, zRed, zNube]);

export const esquemaConfig = z.object({
  automatico: z.object({
    activo: z.boolean(),
    frecuencia: z.enum(["DIARIA", "SEMANAL"]),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida"),
    diaSemana: z.number().int().min(0).max(6),
  }),
  conservar: z.number().int().min(1).max(MAX_CONSERVAR),
  incluirAdjuntos: z.boolean(),
  cifrar: z.boolean(),
  claveCifrado: zClaveOpcional,
  destinos: z.array(esquemaDestino).max(MAX_DESTINOS),
});
export type ConfigEntrada = z.infer<typeof esquemaConfig>;

/** Lo guardado; lo que no se entienda cae a lo de omisión. */
export function normalizarConfig(guardado: unknown): ConfigRespaldos {
  let v = guardado;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  if (!v || typeof v !== "object") return structuredClone(CONFIG_POR_OMISION);
  const o = v as Partial<ConfigRespaldos>;
  return {
    ...CONFIG_POR_OMISION,
    ...o,
    automatico: { ...CONFIG_POR_OMISION.automatico, ...(o.automatico ?? {}) },
    destinos: Array.isArray(o.destinos) ? o.destinos : [],
  };
}

/** Lo que ve la pantalla: sin ninguna clave, sólo si la hay. */
export type DestinoPublico =
  | DestinoLocal
  | (Omit<DestinoRed, "clave"> & { tieneClave: boolean })
  | (Omit<DestinoNube, "secretAccessKey"> & { tieneClave: boolean });
export interface ConfigPublica extends Omit<ConfigRespaldos, "claveCifrado" | "destinos"> {
  tieneClaveCifrado: boolean;
  destinos: DestinoPublico[];
}

export function configPublica(c: ConfigRespaldos): ConfigPublica {
  const { claveCifrado, destinos, ...resto } = c;
  return {
    ...resto,
    tieneClaveCifrado: !!claveCifrado,
    destinos: destinos.map((d): DestinoPublico => {
      if (d.tipo === "RED") { const { clave, ...x } = d; return { ...x, tieneClave: !!clave }; }
      if (d.tipo === "NUBE") { const { secretAccessKey, ...x } = d; return { ...x, tieneClave: !!secretAccessKey }; }
      return d;
    }),
  };
}

/**
 * Los errores de fondo que el esquema no ve: la nube exige cifrado y su clave; una
 * clave de cifrado nueva debe ser larga. `anterior` dice qué claves ya estaban.
 */
export function erroresDeConfig(e: ConfigEntrada, anterior: ConfigRespaldos): string[] {
  const errores: string[] = [];
  const ids = new Set<string>();
  for (const d of e.destinos) {
    if (ids.has(d.id)) errores.push(`El destino «${d.nombre}» está repetido.`);
    ids.add(d.id);
    const previo = anterior.destinos.find((x) => x.id === d.id && x.tipo === d.tipo);
    if (d.tipo === "NUBE" && !d.secretAccessKey && !(previo && previo.tipo === "NUBE" && previo.secretAccessKey)) {
      errores.push(`Falta la clave secreta de «${d.nombre}».`);
    }
    if (d.tipo === "RED" && d.usuario && d.clave === "" ) errores.push(`«${d.nombre}» tiene usuario pero se quitó la contraseña.`);
  }
  const claveNueva = e.claveCifrado ?? null;
  const tendraClave = claveNueva !== null ? claveNueva !== "" : !!anterior.claveCifrado;
  if (e.cifrar && claveNueva && claveNueva.length < 12) errores.push("La contraseña de cifrado debe tener al menos 12 caracteres.");
  if (e.cifrar && !tendraClave) errores.push("Para cifrar hace falta la contraseña de cifrado.");
  if (e.destinos.some((d) => d.tipo === "NUBE" && d.activo) && !e.cifrar) {
    errores.push("Un respaldo que sale a la nube debe ir cifrado: active el cifrado.");
  }
  if (e.automatico.activo && !e.destinos.some((d) => d.activo)) errores.push("Para respaldar automáticamente hace falta al menos un destino activo.");
  return errores;
}

// ─── Programación ────────────────────────────────────────────────────────────

/** El momento programado más reciente que no esté en el futuro. */
export function ultimoProgramado(p: Pick<ProgramacionRespaldo, "frecuencia" | "hora" | "diaSemana">, ahora: Date): Date {
  const [hh, mm] = p.hora.split(":").map(Number);
  const local = new Date(ahora.getTime() + DESFASE_HN_MS); // reloj de Honduras en campos UTC
  const candidato = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm));
  if (p.frecuencia === "DIARIA") {
    if (candidato.getTime() > local.getTime()) candidato.setUTCDate(candidato.getUTCDate() - 1);
  } else {
    let atras = (candidato.getUTCDay() - p.diaSemana + 7) % 7;
    if (atras === 0 && candidato.getTime() > local.getTime()) atras = 7;
    candidato.setUTCDate(candidato.getUTCDate() - atras);
  }
  return new Date(candidato.getTime() - DESFASE_HN_MS);
}

/** El siguiente momento programado, para mostrarlo. */
export function proximoProgramado(p: Pick<ProgramacionRespaldo, "frecuencia" | "hora" | "diaSemana">, ahora: Date): Date {
  const ultimo = ultimoProgramado(p, ahora);
  return new Date(ultimo.getTime() + (p.frecuencia === "DIARIA" ? 1 : 7) * 86_400_000);
}

/**
 * ¿Toca un respaldo automático? Sí, si pasó una hora programada desde que se encendió
 * y desde el último automático. Si el equipo estuvo apagado a esa hora, se hace en
 * cuanto vuelve (una vez, no uno por cada día perdido).
 */
export function tocaRespaldo(p: ProgramacionRespaldo, ultimoAutomatico: Date | null, ahora: Date): boolean {
  if (!p.activo) return false;
  const programado = ultimoProgramado(p, ahora);
  if (p.activadoEn && programado.getTime() <= new Date(p.activadoEn).getTime()) return false;
  return !ultimoAutomatico || ultimoAutomatico.getTime() < programado.getTime();
}

export const REINTENTOS_AUTOMATICOS = 3;
export const ESPERA_REINTENTO_MS = 60 * 60_000;

/**
 * La decisión del cron, con lo ya intentado: toca si no hay respaldo bueno desde la
 * hora programada, con hasta 3 intentos y una hora entre uno y otro (si la red o la
 * nube están caídas, no se insiste cada 5 minutos).
 */
export function debeIntentar(
  p: ProgramacionRespaldo,
  intentos: ReadonlyArray<{ fecha: Date; estado: string }>,
  ahora: Date
): boolean {
  const buenos = intentos.filter((i) => i.estado === "OK" || i.estado === "PARCIAL").map((i) => i.fecha.getTime());
  const ultimoBueno = buenos.length ? new Date(Math.max(...buenos)) : null;
  if (!tocaRespaldo(p, ultimoBueno, ahora)) return false;
  const programado = ultimoProgramado(p, ahora).getTime();
  const desde = intentos.filter((i) => i.fecha.getTime() >= programado);
  if (desde.length >= REINTENTOS_AUTOMATICOS) return false;
  return !desde.some((i) => i.estado === "EN_CURSO" || ahora.getTime() - i.fecha.getTime() < ESPERA_REINTENTO_MS);
}

/** «g360-nomina_2026-11-13_0130_automatico.tar.gz(.enc)», con la hora de Honduras. */
export function nombreArchivo(fecha: Date, tipo: "MANUAL" | "AUTOMATICO", cifrado: boolean): string {
  const l = new Date(fecha.getTime() + DESFASE_HN_MS).toISOString();
  const marca = `${l.slice(0, 10)}_${l.slice(11, 13)}${l.slice(14, 16)}${l.slice(17, 19)}`;
  return `${PREFIJO_ARCHIVO}${marca}_${tipo.toLowerCase()}.tar.gz${cifrado ? ".enc" : ""}`;
}

export const esArchivoDeRespaldo = (nombre: string) => nombre.startsWith(PREFIJO_ARCHIVO) && /\.tar\.gz(\.enc)?$/.test(nombre);

/** Los que sobran al conservar `n`, del más viejo al más nuevo (el nombre lleva la fecha). */
export function aPodar(nombres: readonly string[], conservar: number): string[] {
  const propios = nombres.filter(esArchivoDeRespaldo).sort();
  return propios.slice(0, Math.max(0, propios.length - conservar));
}

/**
 * Los respaldos que siguen en una carpeta de red, según el historial (del más nuevo al más viejo):
 * cada envío correcto deja sólo los `conservar` más recientes. Así no hay que conectarse al
 * recurso compartido para pintar el historial.
 */
export function vigentesEnCarpeta(
  historial: readonly { archivo: string | null; destinos: unknown }[],
  destinoId: string,
  conservar: number,
): Set<string> {
  const quedan = new Set<string>();
  for (const h of historial) {
    if (quedan.size >= conservar) break;
    const llego = Array.isArray(h.destinos) && h.destinos.some((x) => x && typeof x === "object" && x.destinoId === destinoId && x.ok === true);
    if (llego && h.archivo) quedan.add(h.archivo);
  }
  return quedan;
}

/** La carpeta compartida de una ruta UNC: \\servidor\recurso. */
export function recursoUnc(ruta: string): string {
  const partes = ruta.replace(/\//g, "\\").replace(/^\\\\/, "").split("\\").filter(Boolean);
  return `\\\\${partes[0]}\\${partes[1]}`;
}
