/**
 * Anticipos de prestaciones en la base: cuáles se rebajan, aplicarlos y liberarlos.
 * La aritmética está en ./anticipos.ts.
 */
import type { Prisma, PrismaClient, TipoAnticipoPrestacion } from "@prisma/client";
import type { Money } from "@/lib/payroll/money";

type Db = PrismaClient | Prisma.TransactionClient;

export const SELECT_ANTICIPO = {
  id: true,
  empleadoId: true,
  tipo: true,
  monto: true,
  fechaPago: true,
  anioDecimo: true,
  estado: true,
  liquidacionFinalId: true,
  liquidacionDecimoId: true,
} as const;

export type AnticipoLeido = Prisma.AnticipoPrestacionGetPayload<{ select: typeof SELECT_ANTICIPO }>;

export interface AnticiposDeLiquidacion {
  negociacion: AnticipoLeido[];
  adelanto13: AnticipoLeido[];
  adelanto14: AnticipoLeido[];
}

/**
 * Lo que una liquidación final puede rebajar: los anticipos VIGENTES del empleado y los
 * que ya se habían aplicado a un BORRADOR suyo anterior (al guardar el nuevo, pasan a él).
 * Los adelantos, sólo los del décimo en curso: el 13.º del año de salida y el 14.º cuya
 * ventana contiene la salida.
 */
export async function anticiposParaLiquidacion(
  db: Db,
  empleadoId: string,
  anios: { decimoTercero: number; decimoCuarto: number }
): Promise<AnticiposDeLiquidacion> {
  const filas = await db.anticipoPrestacion.findMany({
    where: {
      empleadoId,
      OR: [
        { estado: "VIGENTE" },
        { estado: "APLICADO", liquidacionFinal: { estado: "BORRADOR" } },
      ],
    },
    select: SELECT_ANTICIPO,
    orderBy: { fechaPago: "asc" },
  });
  return {
    negociacion: filas.filter((a) => a.tipo === "NEGOCIACION_PRESTACIONES"),
    adelanto13: filas.filter((a) => a.tipo === "ADELANTO_DECIMO_TERCERO" && a.anioDecimo === anios.decimoTercero),
    adelanto14: filas.filter((a) => a.tipo === "ADELANTO_DECIMO_CUARTO" && a.anioDecimo === anios.decimoCuarto),
  };
}

/**
 * Deja aplicados los anticipos que se tomaron en cuenta, con lo que se rebajó a cada uno
 * (puede ser 0: se consideraron y no había de dónde rebajar). Un anticipo considerado
 * queda cerrado con ese documento; se reabre al anularlo.
 */
export async function aplicarAnticipos(
  tx: Prisma.TransactionClient,
  considerados: readonly { id: string }[],
  partes: readonly { id: string; monto: Money }[],
  destino: { liquidacionFinalId: string } | { liquidacionDecimoId: string }
): Promise<void> {
  const porId = new Map(partes.map((p) => [p.id, p.monto]));
  for (const a of considerados) {
    await tx.anticipoPrestacion.update({
      where: { id: a.id },
      data: {
        estado: "APLICADO",
        montoAplicado: porId.get(a.id) ?? 0,
        liquidacionFinalId: "liquidacionFinalId" in destino ? destino.liquidacionFinalId : null,
        liquidacionDecimoId: "liquidacionDecimoId" in destino ? destino.liquidacionDecimoId : null,
      },
    });
  }
}

/** Devuelve a VIGENTES los anticipos de un documento que se anula o se reemplaza. */
export async function liberarAnticipos(
  tx: Prisma.TransactionClient,
  where: Prisma.AnticipoPrestacionWhereInput
): Promise<number> {
  const r = await tx.anticipoPrestacion.updateMany({
    where: { ...where, estado: "APLICADO" },
    data: { estado: "VIGENTE", montoAplicado: null, liquidacionFinalId: null, liquidacionDecimoId: null },
  });
  return r.count;
}

export const TIPOS_ADELANTO: TipoAnticipoPrestacion[] = ["ADELANTO_DECIMO_TERCERO", "ADELANTO_DECIMO_CUARTO"];
