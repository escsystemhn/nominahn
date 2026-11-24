/**
 * Conector Hikvision por ISAPI (2026-11-24): HTTP + JSON con autenticación Digest.
 *
 * Lo verificado contra el equipo de Edbin (AC-FEW, firmware V3.3.4, 192.168.30.70:80):
 * `/ISAPI/System/deviceInfo` responde 401 con `WWW-Authenticate: Digest qop="auth"`.
 * Lo que viene de fuentes públicas (foros de integradores; la documentación completa de
 * Hikvision está tras un acuerdo de confidencialidad):
 *
 *   - Marcas: `POST /ISAPI/AccessControl/AcsEvent?format=json` con `AcsEventCond`
 *     (`searchID`, `searchResultPosition`, `maxResults`, `major` 5 = control de acceso,
 *     `startTime`/`endTime` ISO CON zona; sin las fechas, el equipo responde «Invalid
 *     Content»). Mientras falten páginas, `responseStatusStrg` es "MORE".
 *   - `maxResults` tiene tope por equipo (se han visto 10 y 30): se lee de
 *     `/ISAPI/AccessControl/AcsEvent/capabilities` y, si no se puede, se usa 10.
 *   - Los códigos `minor` cambian según el equipo (75 = rostro en varios). Por eso no se
 *     filtra por una lista fija: se toma todo evento de control de acceso que traiga
 *     número de empleado —quien no fue identificado no lo trae— y se guarda el registro
 *     original para revisar, con la primera sincronización real, qué códigos usa.
 *
 * NUNCA se reintenta con credenciales que el equipo rechazó: Hikvision bloquea la
 * conexión tras varios intentos fallidos.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Driver, EventoCrudo, UsuarioDispositivo } from "./driver";

export interface ConfigHikvision {
  ip: string;
  puerto: number;
  usuario: string | null;
  password: string | null;
  /** Minutos respecto a UTC del reloj del equipo (Honduras: −360). */
  offsetMinutos: number;
  /** Espera máxima por petición. */
  tiempoMs?: number;
  /** Días hacia atrás en la primera sincronización, sin marca de agua. */
  diasIniciales?: number;
}

// ─── Digest (RFC 2617 / 7616) ─────────────────────────────────────────────────

export interface Desafio {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  stale?: boolean;
}

/** Lee la cabecera `WWW-Authenticate: Digest …`. `null` si no es Digest. */
export function leerDesafio(cabecera: string | null): Desafio | null {
  if (!cabecera || !/^\s*Digest\s/i.test(cabecera)) return null;
  const campos: Record<string, string> = {};
  for (const m of cabecera.replace(/^\s*Digest\s+/i, "").matchAll(/([a-zA-Z]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/g)) {
    campos[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  if (!campos.realm || !campos.nonce) return null;
  return {
    realm: campos.realm,
    nonce: campos.nonce,
    qop: campos.qop,
    opaque: campos.opaque,
    algorithm: campos.algorithm,
    stale: campos.stale?.toLowerCase() === "true",
  };
}

const hash = (algoritmo: string, texto: string) =>
  createHash(/^sha-?256/i.test(algoritmo) ? "sha256" : "md5").update(texto).digest("hex");

/** El valor de la cabecera `Authorization` para una petición. */
export function autorizacionDigest(p: {
  usuario: string; password: string; metodo: string; uri: string; desafio: Desafio; nc: number; cnonce: string;
}): string {
  const algoritmo = p.desafio.algorithm ?? "MD5";
  const ha1Base = hash(algoritmo, `${p.usuario}:${p.desafio.realm}:${p.password}`);
  const ha1 = /-sess$/i.test(algoritmo) ? hash(algoritmo, `${ha1Base}:${p.desafio.nonce}:${p.cnonce}`) : ha1Base;
  const ha2 = hash(algoritmo, `${p.metodo}:${p.uri}`);
  // Con varias opciones de qop, «auth» (sin integridad del cuerpo) es la que soportan todos.
  const qop = p.desafio.qop?.split(",").map((s) => s.trim()).find((q) => q === "auth");
  const nc = p.nc.toString(16).padStart(8, "0");
  const respuesta = qop
    ? hash(algoritmo, `${ha1}:${p.desafio.nonce}:${nc}:${p.cnonce}:${qop}:${ha2}`)
    : hash(algoritmo, `${ha1}:${p.desafio.nonce}:${ha2}`);
  const partes = [
    `username="${p.usuario}"`, `realm="${p.desafio.realm}"`, `nonce="${p.desafio.nonce}"`, `uri="${p.uri}"`,
    `response="${respuesta}"`,
    ...(p.desafio.algorithm ? [`algorithm=${p.desafio.algorithm}`] : []),
    ...(p.desafio.opaque !== undefined ? [`opaque="${p.desafio.opaque}"`] : []),
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${p.cnonce}"`] : []),
  ];
  return `Digest ${partes.join(", ")}`;
}

// ─── Fechas ───────────────────────────────────────────────────────────────────

const dos = (n: number) => String(n).padStart(2, "0");

/** Un instante como hora de pared del equipo, con su zona: «2026-11-24T08:00:00-06:00». */
export function fechaIsapi(instante: Date, offsetMinutos: number): string {
  const pared = new Date(instante.getTime() + offsetMinutos * 60_000);
  const signo = offsetMinutos < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutos);
  return `${pared.getUTCFullYear()}-${dos(pared.getUTCMonth() + 1)}-${dos(pared.getUTCDate())}T${dos(pared.getUTCHours())}:${dos(pared.getUTCMinutes())}:${dos(pared.getUTCSeconds())}${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

/** La hora de pared de un evento («2026-11-24T08:01:02-06:00»): la zona la aplica `normalizar.ts`. */
export function paredDe(time: unknown): EventoCrudo["pared"] | null {
  const m = typeof time === "string" ? time.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/) : null;
  if (!m) return null;
  return { anio: +m[1], mes: +m[2], dia: +m[3], hora: +m[4], minuto: +m[5], segundo: +m[6] };
}

// ─── Eventos ──────────────────────────────────────────────────────────────────

const ESTADO_ASISTENCIA: Record<string, EventoCrudo["tipo"]> = { checkIn: "ENTRADA", checkOut: "SALIDA" };

/**
 * Un registro de `AcsEvent.InfoList` como marca, o `null` si no es de una persona
 * identificada: sin número de empleado no se sabe de quién es (rostro desconocido,
 * tarjeta no registrada, puerta abierta, alarma).
 */
export function eventoDe(r: Record<string, unknown>): EventoCrudo | null {
  if (Number(r.major) !== 5) return null;
  const pin = String(r.employeeNoString ?? r.employeeNo ?? "").trim();
  if (!pin || pin === "0") return null;
  const pared = paredDe(r.time);
  if (!pared) return null;
  const tipo = typeof r.attendanceStatus === "string" ? ESTADO_ASISTENCIA[r.attendanceStatus] : undefined;
  const modo = typeof r.currentVerifyMode === "string" ? r.currentVerifyMode : null;
  return {
    pin,
    pared,
    ...(tipo ? { tipo } : {}),
    verificacion: modo ? `${modo} (minor ${r.minor})` : `minor ${r.minor}`,
    crudo: r,
  };
}

// ─── El conector ──────────────────────────────────────────────────────────────

/** Un error del equipo o de la red, ya en palabras para quien lo lee. */
export class ErrorHikvision extends Error {}

const DIA = 86_400_000;
const PAGINAS_MAXIMAS = 3000;

export class DriverHikvision implements Driver {
  readonly marca = "HIKVISION";
  private desafio: Desafio | null = null;
  private nc = 0;
  /** Ya entró con estas credenciales: un 401 después es un nonce vencido, no una contraseña mala. */
  private aceptado = false;
  private capacidad: number | null = null;

  constructor(private readonly c: ConfigHikvision) {}

  private get base() {
    return `http://${this.c.ip}:${this.c.puerto}`;
  }

  /** Una petición con Digest. Reintenta UNA vez sólo si el nonce venció (`stale`), nunca por contraseña. */
  private async pedir(metodo: "GET" | "POST", uri: string, cuerpo?: unknown): Promise<{ status: number; texto: string }> {
    const { usuario, password } = this.c;
    if (!usuario || !password) throw new ErrorHikvision("Falta el usuario o la contraseña del equipo: agréguelos en «Editar».");
    const enviar = async () => {
      const headers: Record<string, string> = { Accept: "application/json, text/xml" };
      if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
      if (this.desafio) {
        headers.Authorization = autorizacionDigest({
          usuario, password, metodo, uri, desafio: this.desafio, nc: ++this.nc, cnonce: randomBytes(8).toString("hex"),
        });
      }
      try {
        const r = await fetch(`${this.base}${uri}`, {
          method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(this.c.tiempoMs ?? 10_000), cache: "no-store",
        });
        return { r, texto: await r.text() };
      } catch (e) {
        throw new ErrorHikvision(this.errorDeRed(e));
      }
    };

    let { r, texto } = await enviar();
    if (r.status === 401) {
      const nuevo = leerDesafio(r.headers.get("www-authenticate"));
      if (!nuevo) throw new ErrorHikvision(`El equipo pidió una autenticación que no es Digest (${r.headers.get("www-authenticate") ?? "sin cabecera"}).`);
      // Se responde al desafío UNA vez: la primera petición, o un nonce vencido (el equipo
      // lo marca `stale`, o ya había aceptado estas credenciales y algunos no lo marcan).
      if (this.desafio !== null && !nuevo.stale && !this.aceptado) throw new ErrorHikvision(this.rechazo(texto));
      this.desafio = nuevo;
      this.nc = 0;
      ({ r, texto } = await enviar());
      if (r.status === 401) {
        this.desafio = null;
        this.aceptado = false;
        throw new ErrorHikvision(this.rechazo(texto));
      }
    }
    this.aceptado = true;
    return { status: r.status, texto };
  }

  private rechazo(texto: string) {
    const bloqueo = /lock/i.test(texto) ? " El equipo indica que bloqueó el acceso por intentos fallidos: espere a que se desbloquee." : "";
    return "El reloj rechazó el usuario o la contraseña. Corríjalos en «Editar» antes de volver a intentar: tras varios intentos fallidos, Hikvision bloquea la conexión por un rato." + bloqueo;
  }

  private errorDeRed(e: unknown): string {
    const destino = `${this.c.ip}:${this.c.puerto}`;
    const causa = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { name?: string })?.name ?? "";
    if (causa === "TimeoutError" || causa === "AbortError" || causa === "UND_ERR_CONNECT_TIMEOUT") return `El reloj (${destino}) no contestó a tiempo: revise que esté encendido, en la misma red y con esa dirección IP.`;
    if (causa === "ECONNREFUSED") return `El reloj (${destino}) rechazó la conexión: revise el puerto (Hikvision usa 80 por HTTP).`;
    if (causa === "EHOSTUNREACH" || causa === "ENETUNREACH") return `No se llega a ${destino} desde el servidor: está en otra red o la dirección no existe.`;
    return `No se pudo conectar con el reloj (${destino}): ${e instanceof Error ? e.message : String(e)}.`;
  }

  /** El error que devuelve ISAPI («notSupport», «badParameters»…), en una frase. */
  private errorIsapi(status: number, texto: string, que: string): ErrorHikvision {
    let detalle = "";
    try {
      const j = JSON.parse(texto) as Record<string, unknown>;
      detalle = [j.statusString, j.subStatusCode, j.errorMsg].filter(Boolean).join(", ");
    } catch {
      detalle = texto.match(/<subStatusCode>([^<]*)<\/subStatusCode>/)?.[1] ?? "";
    }
    if (status === 403) return new ErrorHikvision(`El usuario del reloj no tiene permiso para ${que}.${detalle ? ` (${detalle})` : ""}`);
    if (status === 404 || /notSupport/i.test(detalle)) return new ErrorHikvision(`Este reloj no ofrece ${que} por ISAPI.${detalle ? ` (${detalle})` : ""}`);
    return new ErrorHikvision(`El reloj respondió ${status} al pedir ${que}${detalle ? `: ${detalle}` : ""}.`);
  }

  /** Cuántos eventos entrega por consulta, según el propio equipo (10 si no lo dice). */
  private async maxResultados(): Promise<number> {
    if (this.capacidad) return this.capacidad;
    let max = 10;
    try {
      const r = await this.pedir("GET", "/ISAPI/AccessControl/AcsEvent/capabilities?format=json");
      if (r.status === 200) {
        const j = JSON.parse(r.texto) as { AcsEvent?: { AcsEventCond?: { maxResults?: { "@max"?: number } } } };
        const tope = Number(j.AcsEvent?.AcsEventCond?.maxResults?.["@max"]);
        if (Number.isFinite(tope) && tope >= 1) max = Math.min(tope, 30);
      }
    } catch (e) {
      // Las credenciales malas no se disimulan: es lo primero que hay que corregir.
      if (e instanceof ErrorHikvision && /contraseña/.test(e.message)) throw e;
    }
    this.capacidad = max;
    return max;
  }

  async probar(): Promise<{ ok: boolean; detalle: string }> {
    try {
      const info = await this.pedir("GET", "/ISAPI/System/deviceInfo");
      if (info.status !== 200) throw this.errorIsapi(info.status, info.texto, "sus datos");
      const campo = (n: string) => info.texto.match(new RegExp(`<${n}>([^<]*)</${n}>`))?.[1]?.trim() || info.texto.match(new RegExp(`"${n}"\\s*:\\s*"([^"]*)"`))?.[1];
      const equipo = [campo("model"), campo("serialNumber") && `serie ${campo("serialNumber")}`, campo("firmwareVersion") && `firmware ${campo("firmwareVersion")}`]
        .filter(Boolean).join(", ");
      const cap = await this.pedir("GET", "/ISAPI/AccessControl/AcsEvent/capabilities?format=json");
      if (cap.status !== 200) {
        const e = this.errorIsapi(cap.status, cap.texto, "el historial de marcas");
        return { ok: false, detalle: `Conecta y acepta el usuario (${equipo || "sin datos del equipo"}), pero: ${e.message}` };
      }
      const max = await this.maxResultados();
      return { ok: true, detalle: `Conectado con ${equipo || "el equipo"}. Usuario y contraseña aceptados; puede leer el historial de marcas (hasta ${max} por consulta).` };
    } catch (e) {
      return { ok: false, detalle: e instanceof Error ? e.message : String(e) };
    }
  }

  async leerEventos(desde: Date | null): Promise<EventoCrudo[]> {
    const max = await this.maxResultados();
    const ahora = Date.now();
    // Un minuto antes de la marca de agua: la del mismo segundo no se pierde (la base no la duplica).
    const inicio = desde ? new Date(desde.getTime() - 60_000) : new Date(ahora - (this.c.diasIniciales ?? 31) * DIA);
    const cond = {
      searchID: randomBytes(8).toString("hex"),
      maxResults: max,
      major: 5,
      // 0 = todos los tipos de evento de control de acceso: cuáles son marcas lo decide `eventoDe`.
      minor: 0,
      startTime: fechaIsapi(inicio, this.c.offsetMinutos),
      endTime: fechaIsapi(new Date(ahora + DIA), this.c.offsetMinutos),
    };

    const eventos: EventoCrudo[] = [];
    let posicion = 0;
    for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
      const r = await this.pedir("POST", "/ISAPI/AccessControl/AcsEvent?format=json", { AcsEventCond: { ...cond, searchResultPosition: posicion } });
      if (r.status !== 200) throw this.errorIsapi(r.status, r.texto, "el historial de marcas");
      const j = JSON.parse(r.texto) as { AcsEvent?: { responseStatusStrg?: string; numOfMatches?: number; InfoList?: Array<Record<string, unknown>> } };
      const lista = j.AcsEvent?.InfoList ?? [];
      for (const x of lista) {
        const e = eventoDe(x);
        if (e) eventos.push(e);
      }
      posicion += lista.length;
      if (j.AcsEvent?.responseStatusStrg !== "MORE" || lista.length === 0) return eventos;
    }
    throw new ErrorHikvision(`El reloj tiene más de ${PAGINAS_MAXIMAS * max} eventos en ese rango: se leyeron ${eventos.length} marcas y se detuvo. Sincronice de nuevo para seguir.`);
  }

  async leerUsuarios(): Promise<UsuarioDispositivo[]> {
    const usuarios: UsuarioDispositivo[] = [];
    const searchID = randomBytes(8).toString("hex");
    let posicion = 0;
    for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
      const r = await this.pedir("POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", {
        UserInfoSearchCond: { searchID, searchResultPosition: posicion, maxResults: 30 },
      });
      if (r.status !== 200) throw this.errorIsapi(r.status, r.texto, "la lista de usuarios");
      const j = JSON.parse(r.texto) as { UserInfoSearch?: { responseStatusStrg?: string; UserInfo?: Array<{ employeeNo?: string; name?: string }> } };
      const lista = j.UserInfoSearch?.UserInfo ?? [];
      for (const u of lista) if (u.employeeNo) usuarios.push({ pin: String(u.employeeNo), nombre: u.name?.trim() || null });
      posicion += lista.length;
      if (j.UserInfoSearch?.responseStatusStrg !== "MORE" || lista.length === 0) break;
    }
    return usuarios;
  }
}
