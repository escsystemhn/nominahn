/**
 * Parámetros legales vigentes, leídos de la base.
 *
 * POR QUÉ UN SOLO CARGADOR. La planilla, el reporte «Planilla IHSS», el reporte
 * «Planilla RAP» y los décimos armaban cada uno sus parámetros con su propia
 * copia de consultas. Al añadir el modo «monto fijo», cualquier copia que no se
 * actualizara haría que un reporte presentado al IHSS o al RAP dijera otra cifra
 * que la descontada en planilla. Aquí se leen UNA vez y de una sola forma.
 *
 * Lo que no esté configurado cae a los valores 2026 del motor (`calculos-hn.ts`).
 */

import { prisma } from "@/lib/prisma";
import { construirParametros, type MontosFijos, type ParametrosLegales } from "./calculos-hn";

type Config = {
  modo: "PORCENTAJE" | "MONTO_FIJO";
  porcentaje: unknown;
  porcentajeEmpleador: unknown;
  montoFijo: unknown;
  montoFijoEmpleador: unknown;
  topeMaximo: unknown;
  topeMinimo: unknown;
} | null;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Montos fijos de un concepto, o `null` si va por porcentaje. */
function fijosDe(c: Config): { empleado: number; empleador: number } | null {
  if (!c || c.modo !== "MONTO_FIJO") return null;
  return { empleado: num(c.montoFijo) ?? 0, empleador: num(c.montoFijoEmpleador) ?? 0 };
}

/** Tabla ISR del año activo más reciente. */
export async function filasISRVigentes() {
  const anio = await prisma.tablasISR.findFirst({
    where: { activa: true },
    orderBy: { anio: "desc" },
    select: { anio: true },
  });
  if (!anio) return { anio: null as number | null, filas: [] };
  const filas = await prisma.tablasISR.findMany({
    where: { anio: anio.anio, activa: true },
    orderBy: { rangoDesde: "asc" },
  });
  return {
    anio: anio.anio,
    filas: filas.map((f) => ({
      rangoDesde: Number(f.rangoDesde),
      rangoHasta: f.rangoHasta === null ? null : Number(f.rangoHasta),
      cuotaFija: Number(f.cuotaFija),
      porcentaje: Number(f.porcentaje),
      excedenteDesde: Number(f.excedenteDesde),
    })),
  };
}

/**
 * Tabla del impuesto vecinal del municipio donde opera la empresa. Es progresiva
 * por tramos y la aprueba cada municipalidad en su Plan de Arbitrios anual
 * (Art. 77 Ley de Municipalidades).
 */
export async function filasVecinalVigentes() {
  const municipio = await prisma.configuracionSistema.findUnique({
    where: { clave: "MUNICIPIO_IMPUESTO_VECINAL" },
  });
  const cabecera = await prisma.tablaImpuestoVecinal.findFirst({
    where: { activa: true, ...(municipio ? { municipio: municipio.valor } : {}) },
    orderBy: { anio: "desc" },
    select: { municipio: true, anio: true },
  });
  if (!cabecera) {
    return { municipio: municipio?.valor ?? null, anio: null as number | null, filas: [] };
  }
  const filas = await prisma.tablaImpuestoVecinal.findMany({
    where: { municipio: cabecera.municipio, anio: cabecera.anio, activa: true },
    orderBy: { rangoDesde: "asc" },
  });
  return {
    municipio: cabecera.municipio,
    anio: cabecera.anio,
    filas: filas.map((f) => ({
      rangoDesde: Number(f.rangoDesde),
      rangoHasta: f.rangoHasta === null ? null : Number(f.rangoHasta),
      porMillar: Number(f.porMillar),
    })),
  };
}

export async function cargarParametrosLegales(): Promise<ParametrosLegales> {
  const [isr, vecinal, ihss, ivm, rap, reserva, infop, jornada] = await Promise.all([
    filasISRVigentes(),
    filasVecinalVigentes(),
    prisma.tipoDeduccionConfig.findFirst({ where: { codigo: "IHSS", activo: true } }),
    prisma.tipoDeduccionConfig.findFirst({ where: { codigo: "IVM", activo: true } }),
    prisma.tipoDeduccionConfig.findFirst({ where: { codigo: "RAP", activo: true } }),
    prisma.tipoDeduccionConfig.findFirst({ where: { codigo: "RESERVA_LABORAL", activo: true } }),
    prisma.tipoDeduccionConfig.findFirst({ where: { codigo: "INFOP", activo: true } }),
    prisma.configuracionSistema.findUnique({ where: { clave: "JORNADA_HORAS" } }),
  ]);

  const jornadaHoras = jornada ? Number(jornada.valor) : null;
  const infopFijo = fijosDe(infop);
  const reservaFijo = fijosDe(reserva);

  const fijos: Partial<MontosFijos> = {
    ihss: fijosDe(ihss),
    ivm: fijosDe(ivm),
    rap: fijosDe(rap),
    infop: infopFijo ? { empleador: infopFijo.empleador } : null,
    reservaLaboral: reservaFijo ? { empleador: reservaFijo.empleador } : null,
  };

  return construirParametros({
    filasISR: isr.filas,
    filasVecinal: vecinal.filas,
    ihssEmpleado: num(ihss?.porcentaje),
    ihssEmpleador: num(ihss?.porcentajeEmpleador),
    ihssTope: num(ihss?.topeMaximo),
    ivmEmpleado: num(ivm?.porcentaje),
    ivmEmpleador: num(ivm?.porcentajeEmpleador),
    ivmTope: num(ivm?.topeMaximo),
    rapEmpleado: num(rap?.porcentaje),
    rapEmpleador: num(rap?.porcentajeEmpleador),
    rapPiso: num(rap?.topeMinimo),
    rapTope: num(rap?.topeMaximo),
    infopEmpleador: num(infop?.porcentajeEmpleador),
    reservaLaboralEmpleador: num(reserva?.porcentajeEmpleador),
    reservaLaboralTope: num(reserva?.topeMaximo),
    jornadaHoras: Number.isFinite(jornadaHoras) && jornadaHoras! > 0 ? jornadaHoras : null,
    fijos,
  });
}
