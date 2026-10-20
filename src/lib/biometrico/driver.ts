/**
 * Interfaz común a los relojes biométricos.
 *
 * POR QUÉ HAY DRIVERS Y NO UN SOLO CLIENTE. ZKTeco y Hikvision no comparten
 * nada:
 *
 *   ZKTeco    protocolo binario propietario sobre TCP/UDP 4370, vía `node-zklib`.
 *             `getAttendances()` devuelve `{ userSn, deviceUserId, recordTime, ip }`.
 *   Hikvision ISAPI: HTTP + JSON con autenticación Digest (MD5) en el puerto 80.
 *             `POST /ISAPI/AccessControl/AcsEvent?format=json`, paginado con
 *             `searchID` + `searchResultPosition` + `maxResults`.
 *
 * Todo lo que hay por encima de esta interfaz —normalizar, resolver el PIN,
 * poner en cuarentena, agregar el día— es idéntico para ambas. Ése es el grueso
 * del trabajo, y por eso está fuera de los drivers.
 *
 * TRAMPA A RESPETAR EN CUALQUIER IMPLEMENTACIÓN DE ZKTECO: `uid` es el índice
 * interno del registro en el equipo; el número que la persona teclea es `userId`
 * en `getUsers()` y `deviceUserId` en `getAttendances()`. Unir por el campo
 * equivocado no da error: mapea mal a los empleados y le paga las horas de uno a
 * otro. `pin` de aquí abajo es SIEMPRE el número que teclea la persona.
 */

import type { DispositivoBiometrico } from "@prisma/client";

/** Una marcación tal como la reporta el equipo, antes de normalizar. */
export interface EventoCrudo {
  /** Número que teclea la persona. Nunca el índice interno del equipo. */
  pin: string;
  /**
   * Hora de PARED que reporta el equipo, sin zona horaria.
   *
   * Se transporta descompuesta a propósito: construir un `Date` aquí lo ataría a
   * la zona del proceso, y la conversión correcta necesita el `offsetMinutos`
   * del dispositivo. La hace `normalizar.ts`, que sí lo tiene.
   */
  pared: {
    anio: number;
    /** 1-12, no el 0-11 de `Date`. */
    mes: number;
    dia: number;
    hora: number;
    minuto: number;
    segundo: number;
  };
  /** ENTRADA/SALIDA si el equipo lo informa. ZKTeco no lo hace. */
  tipo?: "ENTRADA" | "SALIDA";
  /** Modo de verificación (huella, rostro, tarjeta), si viene. */
  verificacion?: string;
  /** Registro original, para poder auditar sin volver a consultar el equipo. */
  crudo?: unknown;
}

/** Un usuario dado de alta en el equipo. Es la base de la conciliación de PINs. */
export interface UsuarioDispositivo {
  pin: string;
  nombre: string | null;
}

export interface Driver {
  readonly marca: string;

  /** ¿Responde el equipo? Para el botón de probar conexión. */
  probar(): Promise<{ ok: boolean; detalle: string }>;

  /**
   * Marcaciones ocurridas desde `desde` (exclusivo) hasta ahora.
   *
   * `desde` es la marca de agua alta del dispositivo: permite pedir sólo lo
   * nuevo. Un driver que no sepa filtrar en el equipo debe filtrar en memoria
   * antes de devolver — la idempotencia no depende de ello, pero el volumen sí.
   */
  leerEventos(desde: Date | null): Promise<EventoCrudo[]>;

  /**
   * Usuarios del equipo con su nombre.
   *
   * Es lo que permite que la conciliación inicial sea casi automática en vez de
   * teclear a mano la plantilla entera: ambas marcas exponen nombre además de
   * PIN (`getUsers()` en ZKTeco, `/ISAPI/AccessControl/UserInfo/Search` en
   * Hikvision).
   */
  leerUsuarios(): Promise<UsuarioDispositivo[]>;
}

/** Un driver aún no implementado, que falla diciendo QUÉ falta y no `undefined`. */
class DriverPendiente implements Driver {
  constructor(readonly marca: string, private readonly comoSeHace: string) {}

  private fallar(): never {
    throw new Error(`Driver ${this.marca} no implementado todavía. ${this.comoSeHace}`);
  }

  probar(): Promise<{ ok: boolean; detalle: string }> {
    return Promise.resolve({
      ok: false,
      detalle: `Driver ${this.marca} no implementado todavía.`,
    });
  }
  leerEventos(): Promise<EventoCrudo[]> {
    return this.fallar();
  }
  leerUsuarios(): Promise<UsuarioDispositivo[]> {
    return this.fallar();
  }
}

/**
 * Devuelve el driver que corresponde a la marca del dispositivo.
 *
 * Los concretos llegan en su fase: Hikvision primero, porque es HTTP con JSON,
 * se prueba con `curl` y no arrastra una dependencia binaria de terceros.
 */
export function driverPara(dispositivo: DispositivoBiometrico): Driver {
  switch (dispositivo.marca) {
    case "HIKVISION":
      return new DriverPendiente(
        "HIKVISION",
        "Requiere ISAPI sobre HTTP Digest contra /ISAPI/AccessControl/AcsEvent."
      );
    case "ZKTECO":
      return new DriverPendiente(
        "ZKTECO",
        "Requiere el paquete node-zklib y el modelo del equipo para fijar TCP o UDP."
      );
    default:
      throw new Error(`Marca de dispositivo desconocida: ${dispositivo.marca}`);
  }
}
