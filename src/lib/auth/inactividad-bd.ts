/** Minutos de inactividad guardados en ConfiguracionSistema. */

import type { PrismaClient } from "@prisma/client";
import { CLAVE_INACTIVIDAD, normalizarMinutos } from "./inactividad";

type Db = Pick<PrismaClient, "configuracionSistema">;

export async function leerMinutosInactividad(db: Db): Promise<number> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_INACTIVIDAD }, select: { valor: true } });
  return normalizarMinutos(fila?.valor ?? null);
}

export async function guardarMinutosInactividad(db: Db, minutos: number): Promise<void> {
  const valor = String(minutos);
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_INACTIVIDAD },
    update: { valor },
    create: {
      clave: CLAVE_INACTIVIDAD,
      valor,
      descripcion: "Minutos sin actividad tras los que se cierra la sesión y hay que volver a ingresar.",
    },
  });
}
