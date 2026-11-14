/**
 * Límite de intentos de inicio de sesión.
 *
 * Antes el login no tenía ninguna fricción: se podían probar contraseñas sin
 * límite ni rastro. Este módulo bloquea una clave (email, o email+IP) tras
 * demasiados fallos dentro de una ventana, y la libera al acertar o al vencer
 * la ventana.
 *
 * LÓGICA PURA con reloj inyectable, para poder probarla sin esperar tiempo real.
 * El estado vive en memoria del proceso: en un despliegue de un solo servidor
 * (el caso de NominaHN) es suficiente. Si algún día se escala a varias
 * instancias, este contador debe mudarse a un almacén compartido (BD/Redis);
 * el rastro durable de los intentos ya queda en `AuditLog` de todos modos.
 */

export interface ConfigRateLimit {
  /** Fallos permitidos dentro de la ventana antes de bloquear. */
  maxIntentos: number;
  /** Duración de la ventana deslizante, en milisegundos. */
  ventanaMs: number;
}

export const CONFIG_DEFAULT: ConfigRateLimit = {
  maxIntentos: 5,
  ventanaMs: 15 * 60 * 1000, // 15 minutos
};

/**
 * Límite por IP del inicio de sesión, aparte del de cada correo.
 *
 * El límite por correo sólo frena a quien insiste con UNA cuenta: probar una
 * contraseña común contra muchos correos no lo tocaba nunca, y cada intento
 * escribía una fila en `AuditLog`. Con la base de 1 GB del plan Basic de
 * Seenode, eso es también una forma de llenarla. Es más holgado que el de
 * correo porque detrás de una IP puede estar toda una oficina.
 */
export const CONFIG_LOGIN_IP: ConfigRateLimit = {
  maxIntentos: 20,
  ventanaMs: 15 * 60 * 1000,
};

interface Registro {
  /** Marcas de tiempo de los fallos vigentes (dentro de la ventana). */
  fallos: number[];
  /** Ventana con la que se registró: la necesita el barrido para saber si caducó. */
  ventanaMs: number;
}

const registros = new Map<string, Registro>();

/**
 * Tope de claves en memoria antes de barrer las caducadas.
 *
 * Sin él, cada correo o IP distintos dejaban una entrada para siempre: alguien
 * probando correos inventados hacía crecer el Map sin límite, y en la instancia
 * de 0,5 GB de Seenode eso termina en el OOM killer.
 */
const MAX_CLAVES = 5000;

function barrerCaducadas(ahora: number): void {
  for (const [clave, reg] of registros) {
    if (vigentes(reg.fallos, ahora, reg.ventanaMs).length === 0) registros.delete(clave);
  }
}

/** Descarta los fallos que ya cayeron fuera de la ventana. */
function vigentes(fallos: number[], ahora: number, ventanaMs: number): number[] {
  const limite = ahora - ventanaMs;
  return fallos.filter((t) => t > limite);
}

export interface EstadoBloqueo {
  bloqueado: boolean;
  intentosRestantes: number;
  /** Si está bloqueado, cuándo se libera (epoch ms). */
  desbloqueaEn: number | null;
}

/** Estado actual de una clave sin registrar nada. */
export function estado(
  clave: string,
  ahora: number = Date.now(),
  cfg: ConfigRateLimit = CONFIG_DEFAULT
): EstadoBloqueo {
  const reg = registros.get(clave);
  const fallos = reg ? vigentes(reg.fallos, ahora, cfg.ventanaMs) : [];
  const bloqueado = fallos.length >= cfg.maxIntentos;
  return {
    bloqueado,
    intentosRestantes: Math.max(0, cfg.maxIntentos - fallos.length),
    desbloqueaEn: bloqueado ? Math.min(...fallos) + cfg.ventanaMs : null,
  };
}

export function estaBloqueado(
  clave: string,
  ahora: number = Date.now(),
  cfg: ConfigRateLimit = CONFIG_DEFAULT
): boolean {
  return estado(clave, ahora, cfg).bloqueado;
}

/** Registra un intento fallido y devuelve el estado resultante. */
export function registrarFallo(
  clave: string,
  ahora: number = Date.now(),
  cfg: ConfigRateLimit = CONFIG_DEFAULT
): EstadoBloqueo {
  const reg = registros.get(clave);
  const fallos = vigentes(reg ? reg.fallos : [], ahora, cfg.ventanaMs);
  fallos.push(ahora);
  if (!reg && registros.size >= MAX_CLAVES) barrerCaducadas(ahora);
  registros.set(clave, { fallos, ventanaMs: cfg.ventanaMs });
  return estado(clave, ahora, cfg);
}

/** Limpia el historial de una clave (tras un login correcto). */
export function limpiar(clave: string): void {
  registros.delete(clave);
}

/** Sólo para pruebas: vacía todo el estado en memoria. */
export function _reset(): void {
  registros.clear();
}

/** Sólo para pruebas: cuántas claves hay en memoria. */
export function _claves(): number {
  return registros.size;
}
