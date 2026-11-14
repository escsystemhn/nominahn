/**
 * Cliente HTTP del Service Layer de SAP Business One (OData, /b1s/v1/).
 *
 * Reglas que importan:
 *   · UNA sesión por instancia, reutilizada hasta poco antes de su caducidad.
 *     Cada Login consume un cupo de licencia: no se hace login por petición.
 *   · Las cookies B1SESSION y ROUTEID viajan en cada llamada. ROUTEID es
 *     obligatoria cuando el Service Layer está detrás de balanceador.
 *   · Ante HTTP 401 (sesión caducada) se hace UN login nuevo y se repite la
 *     petición una sola vez.
 *   · Tiempo máximo por petición. Un servidor que no responde no puede dejar
 *     colgado el worker ni la pantalla.
 *   · Certificado propio del servidor: NODE_EXTRA_CA_CERTS en el servicio.
 *     Nunca se desactiva la verificación TLS.
 *   · Las listas largas vienen PAGINADAS (20 por página por omisión): se pide
 *     una página mayor con `Prefer: odata.maxpagesize` y se sigue el
 *     `@odata.nextLink` hasta el final.
 *
 * `fetchImpl` se inyecta para poder probar el cliente sin red.
 */

import { ErrorServiceLayer, errorDeRed, errorDeRespuesta } from "./errores";
import type { CuentaSapCompleta } from "./catalogo-sap";

export interface ConfigServiceLayer {
  /** https://servidor:50000/b1s/v1/ (con o sin barra final). */
  urlBase: string;
  companyDb: string;
  usuario: string;
  password: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RespuestaLogin {
  SessionId: string;
  Version: string;
  SessionTimeout: number;
}

export interface CuentaSap {
  Code: string;
  Name: string;
  FormatCode?: string | null;
  /** tYES = cuenta activa (recibe asientos); tNO = cuenta de título. */
  ActiveAccount?: string | null;
}

export interface SucursalSap {
  BPLID: number;
  BPLName: string;
  Disabled?: string | null;
}

export interface AsientoCreado {
  JdtNum: number;
  Number: number;
}

export interface LongitudesSap {
  memo: number;
  lineMemo: number;
  referencia: number;
}

interface Respuesta {
  status: number;
  headers: Headers;
  cuerpo: unknown;
}

interface PaginaOData<T> {
  value?: T[];
  "@odata.nextLink"?: string;
  "odata.nextLink"?: string;
}

const MINUTO = 60_000;
/** Tope de filas al paginar una lista completa: un plan de cuentas no pasa de aquí. */
const MAX_FILAS_LISTA = 50_000;

/** Escapa una cadena para un literal OData ('a''b'). */
export function literalOData(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

export class ServiceLayer {
  private sesion: { cookie: string; expira: number; version: string } | null = null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: ConfigServiceLayer) {
    this.timeoutMs = cfg.timeoutMs ?? 20_000;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  get versionSap(): string | null {
    return this.sesion?.version ?? null;
  }

  private get base(): string {
    return this.cfg.urlBase.endsWith("/") ? this.cfg.urlBase : `${this.cfg.urlBase}/`;
  }

  private url(ruta: string): string {
    return this.base + ruta.replace(/^\//, "");
  }

  private async http(ruta: string, init: { method?: string; body?: unknown; conSesion: boolean; accept?: string; headers?: Record<string, string> }): Promise<Respuesta> {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: init.accept ?? "application/json", ...(init.headers ?? {}) };
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      if (init.conSesion && this.sesion) headers.Cookie = this.sesion.cookie;

      let res: Response;
      try {
        res = await this.fetchImpl(this.url(ruta), {
          method: init.method ?? "GET",
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: control.signal,
          // Las credenciales nunca se cachean ni se siguen a otro origen.
          redirect: "manual",
          cache: "no-store",
        });
      } catch (e) {
        throw errorDeRed(e);
      }

      const tipo = res.headers.get("content-type") ?? "";
      let cuerpo: unknown = null;
      if (res.status !== 204) {
        const texto = await res.text();
        if (tipo.includes("json")) {
          try {
            cuerpo = texto ? JSON.parse(texto) : null;
          } catch {
            cuerpo = texto;
          }
        } else {
          cuerpo = texto;
        }
      }
      if (!res.ok) throw errorDeRespuesta(res.status, cuerpo);
      return { status: res.status, headers: res.headers, cuerpo };
    } finally {
      clearTimeout(temporizador);
    }
  }

  /** Inicia sesión y guarda las cookies. Devuelve versión y tiempo de sesión. */
  async login(): Promise<RespuestaLogin> {
    const r = await this.http("Login", {
      method: "POST",
      body: { CompanyDB: this.cfg.companyDb, UserName: this.cfg.usuario, Password: this.cfg.password },
      conSesion: false,
    });
    const datos = r.cuerpo as Partial<RespuestaLogin>;
    const cookies = leerCookies(r.headers);
    const cookie = ["B1SESSION", "ROUTEID"]
      .map((n) => (cookies[n] ? `${n}=${cookies[n]}` : null))
      .filter(Boolean)
      .join("; ");
    if (!cookie && !datos.SessionId) {
      throw new ErrorServiceLayer({ http: r.status, codigo: "SIN_SESION", mensaje: "El Service Layer no devolvió sesión", transitorio: false });
    }
    const minutos = Number(datos.SessionTimeout) > 0 ? Number(datos.SessionTimeout) : 30;
    this.sesion = {
      cookie: cookie || `B1SESSION=${datos.SessionId}`,
      expira: Date.now() + Math.max(1, minutos - 2) * MINUTO,
      version: String(datos.Version ?? ""),
    };
    return { SessionId: String(datos.SessionId ?? ""), Version: String(datos.Version ?? ""), SessionTimeout: minutos };
  }

  /** Llamada con sesión: entra si hace falta y repite una vez si la sesión caducó. */
  async llamar<T>(ruta: string, init: { method?: string; body?: unknown; accept?: string; headers?: Record<string, string> } = {}): Promise<T> {
    if (!this.sesion || Date.now() >= this.sesion.expira) await this.login();
    try {
      return (await this.http(ruta, { ...init, conSesion: true })).cuerpo as T;
    } catch (e) {
      if (e instanceof ErrorServiceLayer && e.http === 401) {
        this.sesion = null;
        await this.login();
        return (await this.http(ruta, { ...init, conSesion: true })).cuerpo as T;
      }
      throw e;
    }
  }

  async logout(): Promise<void> {
    if (!this.sesion) return;
    try {
      await this.http("Logout", { method: "POST", conSesion: true });
    } catch {
      // Cerrar sesión es cortesía con la licencia; un fallo aquí no es un error del envío.
    } finally {
      this.sesion = null;
    }
  }

  /** Recorre todas las páginas de una lista OData. */
  private async listar<T>(rutaInicial: string, porPagina: number): Promise<T[]> {
    const out: T[] = [];
    let ruta: string | null = rutaInicial;
    while (ruta) {
      const pagina: PaginaOData<T> = await this.llamar<PaginaOData<T>>(ruta, { headers: { Prefer: `odata.maxpagesize=${porPagina}` } });
      out.push(...(pagina?.value ?? []));
      if (out.length > MAX_FILAS_LISTA) {
        throw new ErrorServiceLayer({ http: 0, codigo: "LISTA_DEMASIADO_LARGA", mensaje: `La lista supera ${MAX_FILAS_LISTA} filas`, transitorio: false });
      }
      ruta = rutaRelativa(pagina?.["@odata.nextLink"] ?? pagina?.["odata.nextLink"] ?? null, this.base);
    }
    return out;
  }

  // ─── Operaciones ────────────────────────────────────────────────────────────

  crearAsiento<P extends object>(payload: P): Promise<AsientoCreado> {
    return this.llamar<AsientoCreado>("JournalEntries", { method: "POST", body: payload });
  }

  /** Asientos ya registrados con esta Reference2: la llave de reconciliación. */
  async buscarAsientosPorReferencia2(referencia: string): Promise<AsientoCreado[]> {
    const r = await this.llamar<{ value?: AsientoCreado[] }>(
      `JournalEntries?$select=JdtNum,Number,Reference2&$filter=Reference2 eq ${encodeURIComponent(literalOData(referencia))}`
    );
    return r?.value ?? [];
  }

  /** Cuenta por código interno (AcctCode) o por código visible (FormatCode). */
  async obtenerCuenta(codigo: string): Promise<CuentaSap | null> {
    const lit = encodeURIComponent(literalOData(codigo));
    const r = await this.llamar<{ value?: CuentaSap[] }>(
      `ChartOfAccounts?$select=Code,Name,FormatCode,ActiveAccount&$filter=Code eq ${lit} or FormatCode eq ${lit}&$top=2`
    );
    const lista = r?.value ?? [];
    return lista.find((c) => c.Code === codigo) ?? lista[0] ?? null;
  }

  /** Búsqueda por prefijo de código (interno o visible), para el selector del mapeo. */
  async buscarCuentas(prefijo: string, top = 20): Promise<CuentaSap[]> {
    const lit = encodeURIComponent(literalOData(prefijo));
    const r = await this.llamar<{ value?: CuentaSap[] }>(
      `ChartOfAccounts?$select=Code,Name,FormatCode,ActiveAccount&$filter=startswith(Code,${lit}) or startswith(FormatCode,${lit})&$orderby=Code&$top=${top}`
    );
    return r?.value ?? [];
  }

  /**
   * Plan de cuentas COMPLETO, para importarlo. Se piden sólo los campos que
   * hacen falta; si este servidor no reconoce alguno (versiones antiguas), se
   * vuelve a pedir sin `$select`.
   */
  async listarPlanCuentas(porPagina = 500): Promise<CuentaSapCompleta[]> {
    const campos = "$select=Code,Name,FormatCode,ActiveAccount,FatherAccountKey,AccountLevel,AccountType,FrozenFor";
    try {
      return await this.listar<CuentaSapCompleta>(`ChartOfAccounts?${campos}&$orderby=Code`, porPagina);
    } catch (e) {
      if (e instanceof ErrorServiceLayer && e.http === 400) {
        return this.listar<CuentaSapCompleta>("ChartOfAccounts?$orderby=Code", porPagina);
      }
      throw e;
    }
  }

  /** Sucursales (BusinessPlaces) de la empresa en SAP, si usa varias. */
  async listarSucursales(): Promise<SucursalSap[]> {
    return this.listar<SucursalSap>("BusinessPlaces?$select=BPLID,BPLName,Disabled&$orderby=BPLID", 200);
  }

  /**
   * Longitudes de Memo, LineMemo y Reference según el $metadata de ESTE
   * servidor, para truncar antes de enviar en vez de recibir el error.
   */
  async leerLongitudes(): Promise<LongitudesSap> {
    const xml = await this.llamar<string>("$metadata", { accept: "application/xml" });
    return longitudesDesdeMetadata(typeof xml === "string" ? xml : "");
  }

  /** Comprobación de conexión: entra, lee una cuenta y sale. */
  async probar(): Promise<{ version: string; sessionTimeout: number; cuentas: boolean; longitudes: LongitudesSap }> {
    const login = await this.login();
    try {
      const r = await this.llamar<{ value?: CuentaSap[] }>("ChartOfAccounts?$select=Code&$top=1");
      let longitudes: LongitudesSap = { memo: 50, lineMemo: 50, referencia: 100 };
      try {
        longitudes = await this.leerLongitudes();
      } catch {
        // Sin $metadata se trabaja con los límites conocidos de B1.
      }
      return { version: login.Version, sessionTimeout: login.SessionTimeout, cuentas: Array.isArray(r?.value), longitudes };
    } finally {
      await this.logout();
    }
  }
}

// ─── Ayudas puras ─────────────────────────────────────────────────────────────

/** Cookies de la respuesta de Login como mapa nombre → valor. */
export function leerCookies(headers: Headers): Record<string, string> {
  const lista: string[] =
    typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_]+=)/);
  const out: Record<string, string> = {};
  for (const c of lista) {
    const par = c.split(";")[0]?.trim();
    const i = par?.indexOf("=") ?? -1;
    if (i > 0) out[par.slice(0, i)] = par.slice(i + 1);
  }
  return out;
}

/**
 * El `nextLink` de B1 puede venir relativo (`ChartOfAccounts?$skip=20`) o
 * absoluto (`https://…/b1s/v1/ChartOfAccounts?$skip=20`). Se devuelve siempre
 * relativo a la base, y `null` si no hay más páginas.
 */
export function rutaRelativa(link: string | null | undefined, base: string): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) {
    if (link.startsWith(base)) return link.slice(base.length);
    const i = link.indexOf("/b1s/");
    if (i >= 0) {
      const trasVersion = link.indexOf("/", i + 5);
      return trasVersion >= 0 ? link.slice(trasVersion + 1) : null;
    }
    return null;
  }
  return link.replace(/^\//, "");
}

/** MaxLength de Memo, LineMemo y Reference en el $metadata; valores de B1 si faltan. */
export function longitudesDesdeMetadata(xml: string): LongitudesSap {
  const bloque = (nombre: string) => {
    const m = new RegExp(`<EntityType\\s+Name="${nombre}"[\\s\\S]*?</EntityType>`, "i").exec(xml);
    return m ? m[0] : "";
  };
  const longitud = (bloqueXml: string, propiedad: string, porDefecto: number) => {
    const m = new RegExp(`<Property\\s+Name="${propiedad}"[^>]*MaxLength="(\\d+)"`, "i").exec(bloqueXml);
    return m ? Number(m[1]) : porDefecto;
  };
  const asiento = bloque("JournalEntry");
  const linea = bloque("JournalEntryLine");
  return {
    memo: longitud(asiento, "Memo", 50),
    lineMemo: longitud(linea, "LineMemo", 50),
    referencia: Math.min(longitud(asiento, "Reference", 100), longitud(asiento, "Reference2", 100)),
  };
}
