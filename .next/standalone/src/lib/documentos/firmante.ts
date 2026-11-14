/**
 * Quién firma por el patrono y desde qué ciudad se emiten los documentos.
 *
 * Vive en `ConfiguracionSistema` (claves DOCUMENTOS_*) para no tocar el modelo
 * de la empresa: lo edita quien tiene `documentos.plantillas`.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export interface Firmante {
  nombre: string;
  cargo: string;
  identidad: string;
  ciudad: string;
}

export const CLAVES_FIRMANTE = {
  nombre: "DOCUMENTOS_FIRMANTE_NOMBRE",
  cargo: "DOCUMENTOS_FIRMANTE_CARGO",
  identidad: "DOCUMENTOS_FIRMANTE_IDENTIDAD",
  ciudad: "DOCUMENTOS_CIUDAD",
} as const;

const DESCRIPCION: Record<keyof Firmante, string> = {
  nombre: "Nombre de quien firma constancias, contratos y finiquitos por el patrono",
  cargo: "Cargo del firmante (p. ej. Gerente de Recursos Humanos)",
  identidad: "Identidad del representante del patrono, para el contrato de trabajo",
  ciudad: "Ciudad desde la que se emiten los documentos",
};

export async function leerFirmante(db: Db): Promise<Firmante> {
  const filas = await db.configuracionSistema.findMany({
    where: { clave: { in: Object.values(CLAVES_FIRMANTE) } },
    select: { clave: true, valor: true },
  });
  const v = (clave: string) => filas.find((f) => f.clave === clave)?.valor?.trim() ?? "";
  return {
    nombre: v(CLAVES_FIRMANTE.nombre),
    cargo: v(CLAVES_FIRMANTE.cargo) || "Recursos Humanos",
    identidad: v(CLAVES_FIRMANTE.identidad),
    ciudad: v(CLAVES_FIRMANTE.ciudad),
  };
}

export async function guardarFirmante(db: Db, f: Partial<Firmante>): Promise<void> {
  for (const k of Object.keys(CLAVES_FIRMANTE) as (keyof Firmante)[]) {
    if (f[k] === undefined) continue;
    const clave = CLAVES_FIRMANTE[k];
    await db.configuracionSistema.upsert({
      where: { clave },
      update: { valor: f[k] ?? "" },
      create: { clave, valor: f[k] ?? "", descripcion: DESCRIPCION[k] },
    });
  }
}
