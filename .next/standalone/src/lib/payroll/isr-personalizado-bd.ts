/**
 * Cálculo personalizado del ISR contra la base: la configuración (qué método usa
 * la empresa y con qué deducciones) y el historial del año de cada empleado.
 *
 * La configuración vive en `ConfiguracionSistema`:
 *   ISR_MODO          AUTOMATICO (por omisión) | MANUAL
 *   ISR_METODO        ESTANDAR (por omisión) | PERSONALIZADO, el cálculo del modo automático
 *   ISR_PERSONALIZADO JSON con las deducciones (ver `ConfigIsrPersonalizado`)
 *
 * MANUAL: el sistema no calcula el ISR de nadie. Se retiene lo importado para el período
 * (columna del ISR en Deducciones → Importar → Montos del período), si no la retención
 * fija de la ficha y, si no hay ninguna, nada. Sirve mientras el sistema no tiene lo
 * pagado antes en el año: la planilla anterior ya trae calculada la retención.
 * La edita quien tiene `configuracion.parametros`, en Configuración → Parámetros de ley.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { money } from "./money";
import { CODIGO_ISR_FIJO } from "./deducciones";
import {
  CONFIG_ISR_PERSONALIZADO_DEFAULT,
  mesesDeTipo,
  type ConfigIsrPersonalizado,
  type MetodoIsr,
  type PeriodoPagadoIsr,
} from "./isr-personalizado";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_MODO_ISR = "ISR_MODO";
export const CLAVE_METODO_ISR = "ISR_METODO";
export const CLAVE_CONFIG_ISR = "ISR_PERSONALIZADO";

export const schemaConfigIsr = z.object({
  deduccionPorEdad: z
    .array(z.object({ desdeEdad: z.number().int().min(0).max(120), monto: z.number().min(0).max(10_000_000) }))
    .min(1)
    .max(10)
    .refine((t) => t.some((x) => x.desdeEdad === 0), { error: "Debe haber un tramo desde los 0 años" })
    .refine((t) => new Set(t.map((x) => x.desdeEdad)).size === t.length, { error: "Hay dos tramos con la misma edad" }),
  deducirIvm: z.boolean(),
  deducirRap: z.boolean(),
  deducirAfp: z.boolean(),
});

export type ModoIsr = "AUTOMATICO" | "MANUAL";

export const schemaMetodoIsr = z.object({
  // Opcional para quien guarde sin conocerlo: se queda en automático.
  modo: z.enum(["AUTOMATICO", "MANUAL"]).default("AUTOMATICO"),
  metodo: z.enum(["ESTANDAR", "PERSONALIZADO"]),
  personalizado: schemaConfigIsr,
});

export interface ConfigIsr {
  /** Quién pone la retención: el sistema (con `metodo`) o la persona, por período. */
  modo: ModoIsr;
  metodo: MetodoIsr;
  personalizado: ConfigIsrPersonalizado;
}

export async function leerConfigIsr(db: Db): Promise<ConfigIsr> {
  const filas = await db.configuracionSistema.findMany({
    where: { clave: { in: [CLAVE_MODO_ISR, CLAVE_METODO_ISR, CLAVE_CONFIG_ISR] } },
    select: { clave: true, valor: true },
  });
  const modo = filas.find((f) => f.clave === CLAVE_MODO_ISR)?.valor === "MANUAL" ? "MANUAL" : "AUTOMATICO";
  const metodo = filas.find((f) => f.clave === CLAVE_METODO_ISR)?.valor === "PERSONALIZADO" ? "PERSONALIZADO" : "ESTANDAR";
  let personalizado = CONFIG_ISR_PERSONALIZADO_DEFAULT;
  const guardada = filas.find((f) => f.clave === CLAVE_CONFIG_ISR)?.valor;
  if (guardada) {
    try {
      const p = schemaConfigIsr.safeParse(JSON.parse(guardada));
      if (p.success) personalizado = p.data;
    } catch {
      // Un valor corrupto no debe tumbar la planilla: se usan los valores de la hoja.
    }
  }
  return { modo, metodo, personalizado };
}

/**
 * El ISR manual se guarda como monto del período de la retención fija de ISR: ese tipo
 * tiene que existir. Lo crea la instalación (seed); una base vieja puede no tenerlo.
 */
export async function asegurarTipoIsrFijo(db: Db): Promise<void> {
  await db.tipoDeduccionConfig.upsert({
    where: { codigo: CODIGO_ISR_FIJO },
    update: {},
    create: {
      nombre: "Retención de ISR fija por período", codigo: CODIGO_ISR_FIJO, tipo: "IMPUESTO", esLegal: false,
      descripcion: "Reemplaza el ISR calculado por este monto en cada planilla (retención proyectada por el contador)",
    },
  });
}

/** ¿El ISR está en manual? Lo que importa al importar y al exportar el archivo del período. */
export async function isrEsManual(db: Db): Promise<boolean> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_MODO_ISR }, select: { valor: true } });
  return fila?.valor === "MANUAL";
}

export async function guardarConfigIsr(db: Db, c: ConfigIsr): Promise<void> {
  const fila = (clave: string, valor: string, descripcion: string) =>
    db.configuracionSistema.upsert({ where: { clave }, update: { valor }, create: { clave, valor, descripcion } });
  await fila(CLAVE_MODO_ISR, c.modo, "Retención del ISR: AUTOMATICO (la calcula el sistema) o MANUAL (la de cada período se importa o se fija en la ficha)");
  await fila(CLAVE_METODO_ISR, c.metodo, "Método de cálculo del ISR: ESTANDAR o PERSONALIZADO (proyección anual como la hoja de retención)");
  await fila(CLAVE_CONFIG_ISR, JSON.stringify(c.personalizado), "Deducciones del cálculo personalizado del ISR");
}

/** Estados de planilla cuyas líneas cuentan como pagadas en el año. */
const ESTADOS_PAGADOS = ["CALCULADA", "APROBADA", "PAGADA"] as const;

/**
 * Lo pagado y retenido en el año ANTES de una fecha, por empleado: las líneas de
 * planillas vigentes y los meses importados. Si un mes está importado, las
 * líneas de planilla de ese mes no se cuentan, para no sumarlo dos veces.
 */
export async function cargarHistorialIsr(
  db: Db,
  empleadoIds: string[],
  anio: number,
  antesDe: Date
): Promise<Map<string, PeriodoPagadoIsr[]>> {
  const historial = new Map<string, PeriodoPagadoIsr[]>(empleadoIds.map((id) => [id, []]));
  if (empleadoIds.length === 0) return historial;
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));

  const [importados, lineas] = await Promise.all([
    db.acumuladoIsr.findMany({ where: { empleadoId: { in: empleadoIds }, anio } }),
    db.planillaDetalle.findMany({
      where: {
        empleadoId: { in: empleadoIds },
        planilla: { estado: { in: [...ESTADOS_PAGADOS] }, fechaFin: { gte: inicioAnio, lt: antesDe } },
      },
      select: {
        empleadoId: true, salarioBase: true, ausencias: true, incapacidad: true,
        montoHorasExtra: true, bonificaciones: true, otrosIngresos: true,
        isr: true, rapEmpleado: true, afpEmpleado: true,
        planilla: { select: { tipo: true, fechaFin: true } },
      },
    }),
  ]);

  const mesesImportados = new Set(importados.map((a) => `${a.empleadoId}|${a.mes}`));
  for (const a of importados) {
    historial.get(a.empleadoId)?.push({ meses: 1, sueldo: a.sueldo, variables: a.variables, isrRetenido: a.isrRetenido });
  }
  for (const l of lineas) {
    if (mesesImportados.has(`${l.empleadoId}|${l.planilla.fechaFin.getUTCMonth() + 1}`)) continue;
    historial.get(l.empleadoId)?.push({
      meses: mesesDeTipo(l.planilla.tipo),
      // Lo efectivamente pagado: las ausencias y la incapacidad no se pagaron.
      sueldo: money(l.salarioBase).minus(l.ausencias).minus(l.incapacidad),
      variables: money(l.montoHorasExtra).plus(l.bonificaciones).plus(l.otrosIngresos),
      isrRetenido: l.isr,
      rap: l.rapEmpleado,
      afp: l.afpEmpleado,
    });
  }
  return historial;
}
