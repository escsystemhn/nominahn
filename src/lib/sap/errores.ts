/**
 * Errores del Service Layer de SAP Business One, clasificados y traducidos.
 *
 * El Service Layer responde los errores de negocio como error OData:
 *   { "error": { "code": -5002, "message": { "lang": "en-us", "value": "…" } } }
 * y los de sesión como HTTP 401. Aquí se decide dos cosas que el resto del
 * módulo necesita: si vale la pena REINTENTAR (red, sesión, 5xx) o si hace
 * falta una persona (período cerrado, cuenta inactiva, dimensión obligatoria),
 * y qué decirle al contador en español en vez del mensaje crudo.
 *
 * Puro: sin red ni base, para poder probarlo.
 */

export interface DatosErrorSL {
  http: number;
  codigo: string;
  mensaje: string;
  transitorio: boolean;
}

export class ErrorServiceLayer extends Error {
  http: number;
  codigo: string;
  transitorio: boolean;

  constructor(d: DatosErrorSL) {
    super(d.mensaje);
    this.name = "ErrorServiceLayer";
    this.http = d.http;
    this.codigo = d.codigo;
    this.transitorio = d.transitorio;
  }
}

/** Códigos de red de Node que indican que el servidor no se alcanzó. */
const CODIGOS_RED = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "ABORT_ERR"]);

/** Un fallo al conectar (sin respuesta HTTP). */
export function errorDeRed(e: unknown): ErrorServiceLayer {
  const err = e as { code?: string; name?: string; message?: string; cause?: { code?: string } };
  const codigo = err?.cause?.code ?? err?.code ?? (err?.name === "AbortError" ? "TIMEOUT" : "RED");
  return new ErrorServiceLayer({
    http: 0,
    codigo,
    mensaje: err?.message ?? "No se pudo conectar con el Service Layer",
    transitorio: true,
  });
}

/** Un error devuelto por el Service Layer con código HTTP. */
export function errorDeRespuesta(http: number, cuerpo: unknown): ErrorServiceLayer {
  let codigo = String(http);
  let mensaje = `HTTP ${http}`;
  const c = cuerpo as { error?: { code?: number | string; message?: { value?: string } | string } } | null;
  if (c && typeof c === "object" && c.error) {
    if (c.error.code !== undefined) codigo = String(c.error.code);
    const m = c.error.message;
    mensaje = typeof m === "string" ? m : (m?.value ?? mensaje);
  } else if (typeof cuerpo === "string" && cuerpo.trim()) {
    mensaje = cuerpo.trim().slice(0, 300);
  }
  const transitorio = http === 401 || http === 408 || http === 429 || http === 502 || http === 503 || http === 504 || http >= 500;
  return new ErrorServiceLayer({ http, codigo, mensaje, transitorio });
}

const CODIGOS_RED_CHECK = (codigo: string) => CODIGOS_RED.has(codigo) || codigo === "RED" || codigo === "TIMEOUT";

export interface ContextoTraduccion {
  host?: string;
  usuario?: string;
  fecha?: string;
}

/**
 * Texto para el contador. Los mensajes del Service Layer varían por versión;
 * se reconoce por patrón y, si nada encaja, se devuelve el original con el
 * código, que es lo que el consultor de B1 va a pedir.
 */
export function traducir(e: ErrorServiceLayer, ctx: ContextoTraduccion = {}): string {
  const m = e.message.toLowerCase();

  if (e.http === 0 && CODIGOS_RED_CHECK(e.codigo)) {
    return `No se alcanza el Service Layer${ctx.host ? ` en ${ctx.host}` : ""}. Revise la red o la VPN y que el servicio esté encendido.`;
  }
  if (e.http === 401) {
    if (/login|password|user|credential|invalid company|company db/i.test(m) && !/session/.test(m)) {
      return `SAP rechazó las credenciales${ctx.usuario ? ` del usuario ${ctx.usuario}` : ""} o la base de datos de empresa. Revise la conexión.`;
    }
    return "La sesión con SAP caducó; se vuelve a conectar.";
  }
  if (e.http === 403 || /no authorization|not authorized|unauthorized/.test(m)) {
    return `El usuario${ctx.usuario ? ` ${ctx.usuario}` : ""} no tiene autorización en SAP para esta operación (asientos de diario o plan de cuentas).`;
  }
  if (/posting period|period is locked|period.*closed|closed period|date deviates from permissible range|not within.*posting period/.test(m)) {
    return `El período contable de SAP está cerrado${ctx.fecha ? ` para el ${ctx.fecha}` : ""}. Pida al contador abrirlo en SAP o cambie la fecha contable del envío.`;
  }
  if (/account.*(not active|inactive)|inactive account/.test(m)) {
    return "Una cuenta del mapeo está inactiva o es de título en SAP. Corrija el mapeo contable.";
  }
  if (/account.*(does not exist|not found|invalid)|invalid.*account|no matching records found/.test(m)) {
    return "Una cuenta del mapeo no existe en SAP o es de título. Corrija el mapeo contable.";
  }
  if (/dimension|profit center|cost center|distribution rule|costing code/.test(m)) {
    return "SAP exige centro de costo (centro de beneficio) en alguna cuenta del asiento y la línea no lo trae, o el código no existe. Revise el reparto por centro de costo y los códigos en SAP.";
  }
  if (/branch|business place|bplid|bpl_id/.test(m)) {
    return "SAP exige la sucursal (branch) en cada línea del asiento, o la indicada no existe. Active «SAP tiene varias sucursales» y asigne a cada sucursal su equivalente en SAP.";
  }
  if (/not balanced|balance|debit.*credit/.test(m)) {
    return "SAP reporta que el asiento no cuadra. Revise la partida de la planilla.";
  }
  if (/license|licence|indirect access/.test(m)) {
    return "SAP rechaza la conexión por licencia (acceso indirecto). Contacte al partner de SAP.";
  }
  if (/memo|reference|exceed|too long|string or binary data would be truncated/.test(m)) {
    return "Un texto del asiento supera la longitud permitida por SAP. Acorte la plantilla del memo o las referencias.";
  }
  if (e.http >= 500 || e.http === 429 || e.http === 408) {
    return `SAP no respondió correctamente (HTTP ${e.http}); se reintenta más tarde.`;
  }
  return `SAP devolvió un error (${e.codigo}): ${e.message}`;
}
