/**
 * El impuesto vecinal (impuesto personal) se cobra UNA VEZ, a inicios del año siguiente,
 * y sólo después de confirmarlo (pedido de Edbin, 2026-11-21). Antes se descontaba un
 * doceavo en cada planilla.
 *
 * Cómo funciona:
 *   · `VECINAL_COBRO` en ConfiguracionSistema: ANUAL (por omisión) o CADA_PLANILLA (el
 *     cálculo de antes). En ANUAL, la planilla no calcula el vecinal.
 *   · Para el año que se cierra, `propuestaVecinal` toma lo pagado a cada empleado en las
 *     planillas confirmadas, aprobadas o pagadas de ese año (y los meses importados para
 *     el ISR, si no hay planillas de ese mes) y le aplica la tabla del municipio.
 *   · Quien revisa puede cambiar cada monto y CONFIRMA. `confirmarVecinal` deja a cada
 *     empleado una deducción del tipo de sistema IMPUESTO-VECINAL, sólo para su planilla
 *     que contiene la fecha de cobro (la primera de enero, por omisión). Esa planilla la
 *     descuenta en la columna del vecinal, en cualquiera de los dos modos.
 */

import type { Prisma, PrismaClient, TipoPlanilla } from "@prisma/client";
import { calcularImpuestoVecinalAnual, type TramoVecinal } from "./calculos-hn";
import { CERO, money, type Money } from "./money";
import { periodoQueContiene, type TipoPlanillaPeriodo } from "./periodos-planilla";
import { ESTADOS_QUE_COBRAN } from "./elegibles";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_COBRO_VECINAL = "VECINAL_COBRO";
export type CobroVecinal = "ANUAL" | "CADA_PLANILLA";
export const CODIGO_VECINAL = "IMPUESTO-VECINAL";
/** Lo que distingue estas deducciones: «Impuesto vecinal 2026, confirmado». */
export const marcaVecinal = (anio: number) => `Impuesto vecinal ${anio}`;
const claveConfirmacion = (anio: number) => `VECINAL_CONFIRMADO_${anio}`;

export async function leerCobroVecinal(db: Db): Promise<CobroVecinal> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_COBRO_VECINAL }, select: { valor: true } });
  return fila?.valor === "CADA_PLANILLA" ? "CADA_PLANILLA" : "ANUAL";
}

export async function guardarCobroVecinal(db: Db, cobro: CobroVecinal): Promise<void> {
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_COBRO_VECINAL },
    update: { valor: cobro },
    create: { clave: CLAVE_COBRO_VECINAL, valor: cobro, descripcion: "Impuesto vecinal: ANUAL (una vez, a inicios del año siguiente, confirmado) o CADA_PLANILLA (un doceavo en cada planilla)" },
  });
}

/** El tipo de sistema donde va lo confirmado. De ley: no se asigna a mano ni se importa. */
export async function asegurarTipoVecinal(db: Db): Promise<string> {
  const t = await db.tipoDeduccionConfig.upsert({
    where: { codigo: CODIGO_VECINAL },
    update: {},
    create: {
      nombre: "Impuesto vecinal anual", codigo: CODIGO_VECINAL, tipo: "IMPUESTO", esLegal: true,
      descripcion: "Lo confirmado del impuesto vecinal del año; se descuenta una vez, en la planilla que contiene la fecha de cobro",
    },
    select: { id: true },
  });
  return t.id;
}

// ─── LA PROPUESTA ────────────────────────────────────────────────────────────

/** Lo pagado a un empleado en el año, por mes: de las planillas y, donde no hay, de lo importado. Pura. */
export function ingresosDelAnio(
  planillas: ReadonlyArray<{ mes: number; bruto: Money }>,
  importados: ReadonlyArray<{ mes: number; monto: Money }>
): { base: Money; meses: number } {
  const porMes = new Map<number, Money>();
  for (const p of planillas) porMes.set(p.mes, (porMes.get(p.mes) ?? CERO).plus(p.bruto));
  // Un mes importado vale sólo si no hay planillas de ese mes: no se suma dos veces.
  for (const i of importados) if (!porMes.has(i.mes)) porMes.set(i.mes, i.monto);
  let base = CERO;
  for (const m of porMes.values()) base = base.plus(m);
  return { base, meses: porMes.size };
}

export interface FilaVecinal {
  empleadoId: string;
  codigo: string;
  nombre: string;
  tipoPlanilla: TipoPlanilla;
  /** Meses del año con algo pagado en el sistema (o importado). */
  meses: number;
  base: string;
  impuesto: string;
  /** Lo confirmado antes para ese año, si lo hay. */
  confirmado: string | null;
  /** La planilla donde se descuenta. */
  periodo: { desde: string; hasta: string };
}

export interface PropuestaVecinal {
  anio: number;
  fechaCobro: string;
  filas: FilaVecinal[];
  confirmacion: { fechaCobro: string; confirmadoPor: string; confirmadoEn: string; empleados: number; total: string } | null;
}

const ESTADOS_PAGADOS = ["CALCULADA", "APROBADA", "PAGADA"] as const;

export async function propuestaVecinal(db: Db, anio: number, fechaCobro: string, tabla: TramoVecinal[]): Promise<PropuestaVecinal> {
  const desde = new Date(Date.UTC(anio, 0, 1));
  const hasta = new Date(Date.UTC(anio, 11, 31));
  const [empleados, lineas, importados, ya, conf] = await Promise.all([
    db.empleado.findMany({
      where: { estado: { in: [...ESTADOS_QUE_COBRAN] } },
      select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, tipoPlanilla: true },
      orderBy: { codigo: "asc" },
    }),
    db.planillaDetalle.findMany({
      where: { planilla: { estado: { in: [...ESTADOS_PAGADOS] }, fechaFin: { gte: desde, lte: hasta } } },
      select: { empleadoId: true, totalBruto: true, planilla: { select: { fechaFin: true } } },
    }),
    db.acumuladoIsr.findMany({ where: { anio }, select: { empleadoId: true, mes: true, sueldo: true, variables: true } }),
    db.deduccionEmpleado.findMany({
      where: { activo: true, tipoDeduccion: { codigo: CODIGO_VECINAL }, observacion: { startsWith: marcaVecinal(anio) } },
      select: { empleadoId: true, monto: true },
    }),
    db.configuracionSistema.findUnique({ where: { clave: claveConfirmacion(anio) }, select: { valor: true } }),
  ]);

  const deLineas = new Map<string, { mes: number; bruto: Money }[]>();
  for (const l of lineas) {
    const lista = deLineas.get(l.empleadoId) ?? [];
    lista.push({ mes: l.planilla.fechaFin.getUTCMonth() + 1, bruto: money(l.totalBruto) });
    deLineas.set(l.empleadoId, lista);
  }
  const deImportados = new Map<string, { mes: number; monto: Money }[]>();
  for (const i of importados) {
    const lista = deImportados.get(i.empleadoId) ?? [];
    lista.push({ mes: i.mes, monto: money(i.sueldo).plus(money(i.variables)) });
    deImportados.set(i.empleadoId, lista);
  }
  const confirmados = new Map(ya.map((d) => [d.empleadoId, money(d.monto).toFixed(2)]));

  const filas = empleados.map((e): FilaVecinal => {
    const { base, meses } = ingresosDelAnio(deLineas.get(e.id) ?? [], deImportados.get(e.id) ?? []);
    const p = periodoQueContiene(e.tipoPlanilla as TipoPlanillaPeriodo, fechaCobro);
    return {
      empleadoId: e.id, codigo: e.codigo,
      nombre: [e.primerNombre, e.segundoNombre, e.primerApellido, e.segundoApellido].filter(Boolean).join(" "),
      tipoPlanilla: e.tipoPlanilla, meses, base: base.toFixed(2),
      impuesto: calcularImpuestoVecinalAnual(base, tabla).toFixed(2),
      confirmado: confirmados.get(e.id) ?? null,
      periodo: { desde: p.desde, hasta: p.hasta },
    };
  });

  let confirmacion: PropuestaVecinal["confirmacion"] = null;
  if (conf) {
    try { confirmacion = JSON.parse(conf.valor); } catch { confirmacion = null; }
  }
  return { anio, fechaCobro, filas, confirmacion };
}

// ─── CONFIRMAR ───────────────────────────────────────────────────────────────

export class ErrorVecinal extends Error {}

/**
 * Deja lo confirmado: una deducción por empleado con monto, del tipo IMPUESTO-VECINAL,
 * sólo para su planilla que contiene la fecha de cobro. Reemplaza lo confirmado antes
 * para ese año. No se puede si la planilla de ese período ya está aprobada o pagada.
 */
export async function confirmarVecinal(
  tx: Prisma.TransactionClient,
  opciones: { anio: number; fechaCobro: string; montos: ReadonlyArray<{ empleadoId: string; monto: Money }>; usuario: string }
): Promise<{ empleados: number; total: Money }> {
  const tipoId = await asegurarTipoVecinal(tx);
  const empleados = await tx.empleado.findMany({
    where: { id: { in: opciones.montos.map((m) => m.empleadoId) } },
    select: { id: true, codigo: true, tipoPlanilla: true },
  });
  const porId = new Map(empleados.map((e) => [e.id, e]));

  // Una planilla cerrada del período de cobro ya no puede cambiar lo que descuenta.
  const periodos = new Map<string, { desde: string; hasta: string }>();
  for (const e of empleados) periodos.set(e.id, periodoQueContiene(e.tipoPlanilla as TipoPlanillaPeriodo, opciones.fechaCobro));
  const cerradas = await tx.planillaDetalle.findMany({
    where: {
      empleadoId: { in: empleados.map((e) => e.id) },
      planilla: { estado: { in: ["APROBADA", "PAGADA"] }, fechaInicio: { lte: new Date(`${opciones.fechaCobro}T00:00:00Z`) }, fechaFin: { gte: new Date(`${opciones.fechaCobro}T00:00:00Z`) } },
    },
    select: { empleado: { select: { codigo: true } } },
    take: 1,
  });
  if (cerradas.length) {
    throw new ErrorVecinal(`La planilla de la fecha de cobro ya está cerrada para ${cerradas[0].empleado.codigo}: elija otra fecha.`);
  }

  // Lo confirmado antes para ese año se reemplaza.
  await tx.deduccionEmpleado.deleteMany({
    where: { tipoDeduccionId: tipoId, observacion: { startsWith: marcaVecinal(opciones.anio) }, amortizaciones: { none: {} } },
  });
  let total = CERO;
  let cuantos = 0;
  for (const m of opciones.montos) {
    const e = porId.get(m.empleadoId);
    if (!e || m.monto.lessThanOrEqualTo(0)) continue;
    const p = periodos.get(e.id)!;
    await tx.deduccionEmpleado.create({
      data: {
        empleadoId: e.id, tipoDeduccionId: tipoId, monto: m.monto.toFixed(2),
        saldo: null, cuotasMeses: null,
        fechaInicio: new Date(`${p.desde}T00:00:00Z`), fechaFin: new Date(`${p.hasta}T00:00:00Z`),
        activo: true, observacion: `${marcaVecinal(opciones.anio)}, confirmado`,
      },
    });
    total = total.plus(m.monto);
    cuantos++;
  }
  const resumen = { fechaCobro: opciones.fechaCobro, confirmadoPor: opciones.usuario, confirmadoEn: new Date().toISOString(), empleados: cuantos, total: total.toFixed(2) };
  await tx.configuracionSistema.upsert({
    where: { clave: claveConfirmacion(opciones.anio) },
    update: { valor: JSON.stringify(resumen) },
    create: { clave: claveConfirmacion(opciones.anio), valor: JSON.stringify(resumen), descripcion: `Impuesto vecinal del ${opciones.anio}: lo confirmado y cuándo se descuenta` },
  });
  return { empleados: cuantos, total };
}

/** Quita lo confirmado de un año que todavía no se cobró. */
export async function quitarVecinal(tx: Prisma.TransactionClient, anio: number): Promise<number> {
  const borradas = await tx.deduccionEmpleado.deleteMany({
    where: { tipoDeduccion: { codigo: CODIGO_VECINAL }, observacion: { startsWith: marcaVecinal(anio) }, amortizaciones: { none: {} } },
  });
  await tx.configuracionSistema.deleteMany({ where: { clave: claveConfirmacion(anio) } });
  return borradas.count;
}
