/**
 * Dónde vive la política de deducciones por asistencia: una clave de ConfiguracionSistema
 * con el JSON validado. Sin fila, rige `POLITICA_POR_OMISION`, que descuenta igual que la
 * planilla antes del motor. No necesita cambio de esquema.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { POLITICA_POR_OMISION, zPoliticaAsistencia, type PoliticaAsistencia } from "./politica";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_POLITICA_ASISTENCIA = "ASISTENCIA_POLITICA";

/** Lee la política guardada. Un JSON dañado no detiene la planilla: rige la de omisión. */
export async function leerPoliticaAsistencia(db: Db): Promise<{ politica: PoliticaAsistencia; guardada: boolean; actualizada: Date | null }> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_POLITICA_ASISTENCIA }, select: { valor: true, updatedAt: true } });
  if (!fila) return { politica: POLITICA_POR_OMISION, guardada: false, actualizada: null };
  try {
    return { politica: zPoliticaAsistencia.parse(JSON.parse(fila.valor)), guardada: true, actualizada: fila.updatedAt };
  } catch (e) {
    console.error("[asistencia] política guardada inválida; rige la de omisión:", e instanceof Error ? e.message : e);
    return { politica: POLITICA_POR_OMISION, guardada: false, actualizada: fila.updatedAt };
  }
}

export async function guardarPoliticaAsistencia(db: Db, politica: PoliticaAsistencia): Promise<void> {
  const valor = JSON.stringify(zPoliticaAsistencia.parse(politica));
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_POLITICA_ASISTENCIA },
    update: { valor },
    create: { clave: CLAVE_POLITICA_ASISTENCIA, valor, descripcion: "Política de deducciones por asistencia (Configuración → Asistencia)" },
  });
}
