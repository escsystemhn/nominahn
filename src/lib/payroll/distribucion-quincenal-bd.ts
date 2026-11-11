import type { PrismaClient } from "@prisma/client";
import { CLAVE_DISTRIBUCION_QUINCENAL, normalizarDistribucion, type DistribucionQuincenal } from "./distribucion-quincenal";

type Db = Pick<PrismaClient, "configuracionSistema">;

export async function leerDistribucionQuincenal(db: Db): Promise<DistribucionQuincenal> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_DISTRIBUCION_QUINCENAL } });
  return normalizarDistribucion(fila?.valor ?? null);
}

export async function guardarDistribucionQuincenal(db: Db, d: DistribucionQuincenal): Promise<void> {
  const valor = JSON.stringify(d);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_DISTRIBUCION_QUINCENAL },
    update: { valor },
    create: {
      clave: CLAVE_DISTRIBUCION_QUINCENAL,
      valor,
      descripcion: "Planilla quincenal: IHSS, RAP e impuesto vecinal divididos en las dos quincenas o completos en la segunda.",
    },
  });
}
