/** Préstamos en autoservicio: lo que necesita la base. */

import type { PrismaClient, Prisma } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Tipo de deducción configurado para préstamos o anticipos (el primero activo). */
export async function tipoDeduccionPara(db: Db, tipo: "PRESTAMO" | "ADELANTO") {
  return db.tipoDeduccionConfig.findFirst({ where: { tipo, activo: true }, orderBy: { createdAt: "asc" } });
}
