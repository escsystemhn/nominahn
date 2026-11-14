import type { Prisma, PrismaClient, TipoEvaluacion } from "@prisma/client";
import { elegirAspectos, type AspectosEvaluacion } from "./aspectos";

type Db = PrismaClient | Prisma.TransactionClient;

const COMPETENCIA = { id: true, nombre: true, descripcion: true, activa: true, tipoEvaluacion: true } as const;

/** Aspectos que se evalúan al empleado en una evaluación de ese tipo (ver aspectos.ts). */
export async function aspectosDeEmpleado(db: Db, empleadoId: string, tipo: TipoEvaluacion): Promise<AspectosEvaluacion> {
  const empleado = await db.empleado.findUnique({ where: { id: empleadoId }, select: { puestoId: true } });
  const [delPuesto, generales] = await Promise.all([
    empleado?.puestoId
      ? db.puestoCompetencia.findMany({
          where: { puestoId: empleado.puestoId, activa: true },
          select: { peso: true, nivelRequerido: true, competencia: { select: COMPETENCIA } },
          orderBy: [{ peso: "desc" }, { competencia: { nombre: "asc" } }],
        })
      : Promise.resolve([]),
    db.competenciaDefinicion.findMany({
      where: { general: true, activa: true },
      select: { ...COMPETENCIA, peso: true },
      orderBy: { nombre: "asc" },
    }),
  ]);
  return elegirAspectos(tipo, delPuesto, generales);
}
