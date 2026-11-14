import { prisma } from "@/lib/prisma";
import { Prisma, TipoEvaluacion } from "@prisma/client";
import { money, redondear, type Money } from "@/lib/payroll/money";

/** Orden de prioridad: gana la evaluación mensual sobre la trimestral. */
export const TIPOS_BONO: TipoEvaluacion[] = ["DESEMPENO_MENSUAL", "COMPETENCIA_TRIMESTRAL"];

export interface BonoResuelto {
  bonoPorcentaje: number;
  /** Decimal exacto: se escribe en una columna Decimal(12,2) sin pasar por float. */
  bonoMonto: Money;
  evaluacionId: string;
}

/**
 * Resuelve el bono de TODOS los empleados de una planilla en dos consultas.
 *
 * POR QUÉ: la versión anterior se llamaba dentro del bucle de cálculo, una vez
 * por empleado y por tipo de evaluación (con `??` como fallback, o sea dos
 * veces), y cada llamada hacía hasta tres consultas. Con 200 empleados eran
 * hasta 1,200 viajes de ida y vuelta SECUENCIALES antes de abrir la
 * transacción: el cuello de botella del cálculo masivo.
 *
 * La tercera consulta —traer el empleado para leer su salario— era además pura
 * pérdida: el llamador ya lo tiene en memoria.
 */
export async function calcularBonosPorLote(
  empleados: { id: string; salarioBase: Prisma.Decimal }[],
  tipos: TipoEvaluacion[] = TIPOS_BONO
): Promise<Map<string, BonoResuelto>> {
  const resultado = new Map<string, BonoResuelto>();
  if (empleados.length === 0) return resultado;

  const ids = empleados.map((e) => e.id);

  const [evaluaciones, configs] = await Promise.all([
    prisma.evaluacion.findMany({
      where: {
        empleadoId: { in: ids },
        tipo: { in: tipos },
        estado: "FINALIZADA",
        bonoAplicado: false,
        calificacion: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, empleadoId: true, tipo: true, calificacion: true },
    }),
    prisma.bonusConfig.findMany({
      where: { tipoEvaluacion: { in: tipos }, activo: true },
      select: { tipoEvaluacion: true, calificacionMin: true, calificacionMax: true, bonoPorcentaje: true },
    }),
  ]);

  const salarios = new Map(empleados.map((e) => [e.id, e.salarioBase]));

  // Se recorre por prioridad de tipo y, dentro de cada tipo, de la evaluación
  // más reciente a la más antigua — el mismo criterio que tenía el `??`.
  const porPrioridad = [...evaluaciones].sort(
    (a, b) => tipos.indexOf(a.tipo) - tipos.indexOf(b.tipo)
  );

  for (const ev of porPrioridad) {
    if (resultado.has(ev.empleadoId)) continue;

    const cfg = configs.find(
      (c) =>
        c.tipoEvaluacion === ev.tipo &&
        money(c.calificacionMin).lessThanOrEqualTo(ev.calificacion) &&
        money(c.calificacionMax).greaterThanOrEqualTo(ev.calificacion)
    );
    if (!cfg) continue;

    const salario = salarios.get(ev.empleadoId);
    if (!salario) continue;

    resultado.set(ev.empleadoId, {
      bonoPorcentaje: Number(cfg.bonoPorcentaje),
      // Decimal, no `Number(salario) * pct`: era el único punto del módulo de
      // nómina que abandonaba la aritmética exacta antes de escribir dinero.
      bonoMonto: redondear(money(salario).times(money(cfg.bonoPorcentaje))),
      evaluacionId: ev.id,
    });
  }

  return resultado;
}

/**
 * Versión para un solo empleado. Se conserva para usos fuera del cálculo masivo
 * (una consulta puntual desde la ficha); el cálculo de planilla usa el lote.
 */
export async function calcularBonoEvaluacion(
  empleadoId: string,
  tipoEvaluacion: TipoEvaluacion
): Promise<BonoResuelto | null> {
  const empleado = await prisma.empleado.findUnique({
    where: { id: empleadoId },
    select: { id: true, salarioBase: true },
  });
  if (!empleado) return null;

  const bonos = await calcularBonosPorLote([empleado], [tipoEvaluacion]);
  return bonos.get(empleadoId) ?? null;
}

/**
 * El bono que corresponde a UNA calificación, sin marcar nada. Se usa al finalizar una
 * evaluación para dejar a la vista cuánto será el bono.
 *
 * POR QUÉ no se marca «aplicado» al finalizar: lo marca la planilla al confirmarse
 * (calculo-planilla-bd.ts), que es la que lo paga. Antes la ruta de estado lo marcaba
 * al finalizar y la planilla, que sólo toma los no aplicados, nunca lo pagaba.
 */
export async function bonoParaCalificacion(
  empleadoId: string,
  tipoEvaluacion: TipoEvaluacion,
  calificacion: number
): Promise<{ bonoPorcentaje: number; bonoMonto: Money } | null> {
  if (!(calificacion > 0)) return null;
  const [empleado, configs] = await Promise.all([
    prisma.empleado.findUnique({ where: { id: empleadoId }, select: { salarioBase: true } }),
    prisma.bonusConfig.findMany({
      where: { tipoEvaluacion, activo: true },
      select: { calificacionMin: true, calificacionMax: true, bonoPorcentaje: true },
    }),
  ]);
  if (!empleado) return null;
  const cfg = configs.find(
    (c) => money(c.calificacionMin).lessThanOrEqualTo(calificacion) && money(c.calificacionMax).greaterThanOrEqualTo(calificacion)
  );
  if (!cfg) return null;
  return {
    bonoPorcentaje: Number(cfg.bonoPorcentaje),
    bonoMonto: redondear(money(empleado.salarioBase).times(money(cfg.bonoPorcentaje))),
  };
}

/** Marca la evaluación como bono aplicado. */
export async function marcarBonoAplicado(
  evaluacionId: string,
  bonoMonto: Money,
  bonoPorcentaje: number
) {
  await prisma.evaluacion.update({
    where: { id: evaluacionId },
    data: { bonoAplicado: true, bonoMonto, bonoPorcentaje },
  });
}
