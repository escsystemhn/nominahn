/**
 * Configuración de la integración con SAP Business One, leída de la base y
 * con la contraseña descifrada. Una sola fila (`IntegracionSap`, id "default").
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { descifrar } from "@/lib/seguridad/cifrado";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ConfigSap {
  activo: boolean;
  urlBase: string;
  companyDb: string;
  usuario: string;
  password: string | null;
  modoEnvio: "MANUAL" | "AL_APROBAR" | "AL_PAGAR";
  incluirProvisiones: boolean;
  porCentroCosto: boolean;
  dimensionCentro: number;
  fechaContable: "PAGO" | "FIN_PERIODO";
  codigoTransaccion: string | null;
  serie: number | null;
  memoPlantilla: string;
  longitudes: { memo: number; lineMemo: number; referencia: number };
  /** SAP con varias sucursales: cada línea lleva BPLID. */
  usaSucursales: boolean;
  sapBplIdPorDefecto: number | null;
  catalogoOrigen: "LOCAL" | "SAP";
  /** Conexión de sólo lectura a la base de SAP; `null` si no se configuró. */
  baseDatos: {
    servidor: string;
    puerto: number;
    instancia: string | null;
    usuario: string;
    password: string | null;
    cifrar: boolean;
    confiarCertificado: boolean;
  } | null;
}

export class ConfigSapIncompleta extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ConfigSapIncompleta";
  }
}

/** `null` si nunca se configuró. Lanza si la contraseña no se puede descifrar. */
export async function cargarConfigSap(db: Db): Promise<ConfigSap | null> {
  const c = await db.integracionSap.findUnique({ where: { id: "default" } });
  if (!c) return null;
  let password: string | null = null;
  if (c.passwordCifrado) {
    try {
      password = descifrar(c.passwordCifrado);
    } catch {
      throw new ConfigSapIncompleta("No se pudo leer la contraseña de SAP guardada (¿cambió CIFRADO_KEY?). Vuelva a escribirla y guarde.");
    }
  }
  let passwordDb: string | null = null;
  if (c.dbPasswordCifrado) {
    try {
      passwordDb = descifrar(c.dbPasswordCifrado);
    } catch {
      throw new ConfigSapIncompleta("No se pudo leer la contraseña de la base de datos de SAP (¿cambió CIFRADO_KEY?). Vuelva a escribirla y guarde.");
    }
  }
  return {
    activo: c.activo,
    urlBase: c.urlBase,
    companyDb: c.companyDb,
    usuario: c.usuario,
    password,
    modoEnvio: c.modoEnvio,
    incluirProvisiones: c.incluirProvisiones,
    porCentroCosto: c.porCentroCosto,
    dimensionCentro: c.dimensionCentro,
    fechaContable: c.fechaContable === "FIN_PERIODO" ? "FIN_PERIODO" : "PAGO",
    codigoTransaccion: c.codigoTransaccion,
    serie: c.serie,
    memoPlantilla: c.memoPlantilla,
    longitudes: { memo: c.longitudMemo, lineMemo: c.longitudLineMemo, referencia: c.longitudReferencia },
    usaSucursales: c.usaSucursales,
    sapBplIdPorDefecto: c.sapBplIdPorDefecto,
    catalogoOrigen: c.catalogoOrigen === "SAP" ? "SAP" : "LOCAL",
    baseDatos: c.dbServidor && c.dbUsuario
      ? {
          servidor: c.dbServidor,
          puerto: c.dbPuerto,
          instancia: c.dbInstancia,
          usuario: c.dbUsuario,
          password: passwordDb,
          cifrar: c.dbCifrar,
          confiarCertificado: c.dbConfiarCertificado,
        }
      : null,
  };
}

/** Lo que hace falta para hablar con el Service Layer; lanza con el detalle si falta algo. */
export function exigirConexion(c: ConfigSap | null): asserts c is ConfigSap & { password: string } {
  if (!c) throw new ConfigSapIncompleta("La integración con SAP no está configurada.");
  const faltan: string[] = [];
  if (!c.urlBase) faltan.push("URL del Service Layer");
  if (!c.companyDb) faltan.push("base de datos de empresa");
  if (!c.usuario) faltan.push("usuario");
  if (!c.password) faltan.push("contraseña");
  if (faltan.length) throw new ConfigSapIncompleta(`Falta en la conexión con SAP: ${faltan.join(", ")}.`);
}
