/** Incapacidades: reglas guardadas y cadena de prórrogas (lado de la base). */

import type { PrismaClient, Prisma } from "@prisma/client";
import { normalizarReglas, type ReglasIncapacidad } from "./incapacidades";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_REGLAS = "INCAPACIDAD_REGLAS";

export async function leerReglas(db: Db): Promise<ReglasIncapacidad> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_REGLAS } });
  if (!fila) return normalizarReglas(null);
  try {
    return normalizarReglas(JSON.parse(fila.valor));
  } catch {
    return normalizarReglas(null);
  }
}

export async function guardarReglas(db: Db, reglas: ReglasIncapacidad): Promise<void> {
  const valor = JSON.stringify(reglas);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_REGLAS },
    update: { valor },
    create: { clave: CLAVE_REGLAS, valor, descripcion: "Reglas de incapacidad: días a cargo del patrono, % de subsidio del IHSS y % de complemento patronal por tipo" },
  });
}

/** Días del patrono ya consumidos por la cadena de la que esta será prórroga. */
export async function diasPatronoConsumidos(db: Db, prorrogaDeId: string | null | undefined): Promise<number> {
  let total = 0;
  let id = prorrogaDeId ?? null;
  const vistos = new Set<string>();
  while (id && !vistos.has(id)) {
    vistos.add(id);
    const inc = await db.incapacidad.findUnique({ where: { id }, select: { diasPatrono: true, prorrogaDeId: true, anulada: true } });
    if (!inc) break;
    if (!inc.anulada) total += inc.diasPatrono;
    id = inc.prorrogaDeId;
  }
  return total;
}
