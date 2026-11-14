/** Lectura de los logos de sucursal para los documentos que los imprimen. */

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export interface LogoDocumento {
  png: Buffer;
  ancho: number;
  alto: number;
}

/**
 * Los logos de varias sucursales de una vez. Una planilla con cientos de personas
 * tiene pocas sucursales: no se consulta el logo por cada comprobante.
 */
export async function logosDeSucursales(db: Db, sucursalIds: Iterable<string>): Promise<Map<string, LogoDocumento>> {
  const ids = [...new Set(sucursalIds)];
  if (ids.length === 0) return new Map();
  const filas = await db.logoSucursal.findMany({ where: { sucursalId: { in: ids } } });
  return new Map(filas.map((l) => [l.sucursalId, { png: Buffer.from(l.png), ancho: l.ancho, alto: l.alto }]));
}

/** El logo tal como lo trae un `select` anidado en la sucursal de un empleado. */
export function logoParaDocumento(l: { png: Uint8Array; ancho: number; alto: number } | null | undefined): LogoDocumento | null {
  return l ? { png: Buffer.from(l.png), ancho: l.ancho, alto: l.alto } : null;
}

export function pngComoDataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
