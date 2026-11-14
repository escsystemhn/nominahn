/**
 * Parámetros de ley vigentes: IHSS (EM), IVM, RAP e INFOP —por porcentaje o
 * monto fijo— y las tablas del ISR y del impuesto vecinal.
 *
 * Sólo con `configuracion.parametros`, que por omisión tiene únicamente
 * SUPER_ADMIN: estos valores cambian lo que se descuenta a TODOS los empleados.
 *
 * Las tasas viajan como porcentaje (2.5), no como la fracción que guarda la
 * base (0.025): es lo que el administrador lee en la ley y lo que teclea.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { filasISRVigentes, filasVecinalVigentes } from "@/lib/payroll/parametros-bd";
import { TABLA_ISR_ANUAL_2026, TABLA_VECINAL_SPS } from "@/lib/payroll/calculos-hn";
import { CODIGOS_CONCEPTO_LEY, CONCEPTOS_LEY, fraccionAPorcentaje } from "@/lib/payroll/conceptos-ley";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const pct = (v: number | null) => (v === null ? null : fraccionAPorcentaje(v));

export async function GET() {
  const g = await requerirPermiso("configuracion.parametros");
  if (!g.ok) return g.response;

  const [configs, isr, vecinal, municipio, conIhssFijo] = await Promise.all([
    prisma.tipoDeduccionConfig.findMany({ where: { codigo: { in: [...CODIGOS_CONCEPTO_LEY] } } }),
    filasISRVigentes(),
    filasVecinalVigentes(),
    prisma.configuracionSistema.findUnique({ where: { clave: "MUNICIPIO_IMPUESTO_VECINAL" } }),
    prisma.empleado.count({ where: { ihssMontoFijo: { not: null }, estado: { not: "INACTIVO" } } }),
  ]);

  const conceptos = CODIGOS_CONCEPTO_LEY.map((codigo) => {
    const meta = CONCEPTOS_LEY[codigo];
    const c = configs.find((x) => x.codigo === codigo);
    // Sin fila en la base, o inactiva, el motor usa sus valores 2026: se
    // muestran ésos, que son los que de verdad se están aplicando.
    const vigente = c && c.activo ? c : null;
    return {
      codigo,
      nombre: meta.nombre,
      descripcion: meta.descripcion,
      tieneEmpleado: meta.tieneEmpleado,
      tieneTope: meta.tieneTope,
      tienePiso: meta.tienePiso,
      enBase: !!c,
      activo: c?.activo ?? false,
      modo: vigente?.modo ?? "PORCENTAJE",
      porcentajeEmpleado: meta.tieneEmpleado
        ? pct(num(vigente?.porcentaje) ?? meta.defecto.porcentajeEmpleado)
        : null,
      porcentajeEmpleador: pct(num(vigente?.porcentajeEmpleador) ?? meta.defecto.porcentajeEmpleador),
      topeMaximo: meta.tieneTope ? (num(vigente?.topeMaximo) ?? meta.defecto.topeMaximo) : null,
      topeMinimo: meta.tienePiso ? (num(vigente?.topeMinimo) ?? meta.defecto.topeMinimo) : null,
      // Los montos se conservan aunque el modo sea porcentaje, para que volver
      // a «monto fijo» no obligue a teclearlos otra vez.
      montoFijoEmpleado: meta.tieneEmpleado ? num(c?.montoFijo) : null,
      montoFijoEmpleador: num(c?.montoFijoEmpleador),
      actualizado: c?.updatedAt ?? null,
    };
  });

  const anioActual = new Date().getFullYear();

  return NextResponse.json({
    conceptos,
    isr: isr.filas.length > 0
      ? {
          anio: isr.anio,
          porDefecto: false,
          tramos: isr.filas.map((f) => ({
            desde: f.rangoDesde,
            hasta: f.rangoHasta,
            cuotaFija: f.cuotaFija,
            porcentaje: fraccionAPorcentaje(f.porcentaje),
            excedenteDesde: f.excedenteDesde,
          })),
        }
      : {
          anio: anioActual,
          porDefecto: true,
          tramos: TABLA_ISR_ANUAL_2026.map((t) => ({ ...t, porcentaje: fraccionAPorcentaje(t.porcentaje) })),
        },
    vecinal: vecinal.filas.length > 0
      ? {
          municipio: vecinal.municipio,
          anio: vecinal.anio,
          porDefecto: false,
          tramos: vecinal.filas.map((f) => ({ desde: f.rangoDesde, hasta: f.rangoHasta, porMillar: f.porMillar })),
        }
      : {
          municipio: municipio?.valor ?? "SAN_PEDRO_SULA",
          anio: anioActual,
          porDefecto: true,
          tramos: TABLA_VECINAL_SPS.map((t) => ({ ...t })),
        },
    empleadosConIhssFijo: conIhssFijo,
  });
}
