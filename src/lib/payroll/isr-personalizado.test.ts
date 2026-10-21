import { describe, it, expect } from "vitest";
import {
  calcularIsrPersonalizado,
  gastosMedicosPorEdad,
  indicePeriodoDelAnio,
  mesesDeTipo,
  CONFIG_ISR_PERSONALIZADO_DEFAULT as CONFIG,
  type EntradaIsrPersonalizado,
  type PeriodoPagadoIsr,
} from "./isr-personalizado";
import { calcularPlanilla, TABLA_ISR_ANUAL_2026 } from "./calculos-hn";

// Datos INVENTADOS. Los valores esperados se calculan a mano, como lo hace la
// hoja «Retención en la fuente», no con el motor.
const IVM_MENSUAL = 11903.13 * 0.025; // 297.57825
const tabla2026 = (renta: number) =>
  renta <= 228324.32 ? 0
    : renta <= 348154.10 ? (renta - 228324.32) * 0.15
      : renta <= 809660.75 ? (348154.10 - 228324.32) * 0.15 + (renta - 348154.10) * 0.2
        : (348154.10 - 228324.32) * 0.15 + (809660.75 - 348154.10) * 0.2 + (renta - 809660.75) * 0.25;

const COMISIONES = [6500, 6300, 5900, 6700, 6000, 5400];
const RETENIDO = [125, 100, 70, 95, 340];
const meses = (n: number, f: (i: number) => Partial<PeriodoPagadoIsr> = () => ({})): PeriodoPagadoIsr[] =>
  Array.from({ length: n }, (_, i) => ({ meses: 1, sueldo: 18000, variables: COMISIONES[i], isrRetenido: RETENIDO[i], ...f(i) }));

const base = (cambios: Partial<EntradaIsrPersonalizado> = {}): EntradaIsrPersonalizado => ({
  periodosAnio: 12, indicePeriodo: 6, historial: meses(5),
  actual: { sueldo: 18000, variables: 5400 }, salarioMensual: 18000, proyectar: true, edad: 30,
  ivmTope: 11903.13, ivmEmpleado: 0.025, tabla: TABLA_ISR_ANUAL_2026, config: CONFIG, ...cambios,
});

describe("cálculo personalizado del ISR (hoja «Retención en la fuente»)", () => {
  it("junio: proyección con lo pagado, promedio de comisiones y lo ya retenido entre 7", () => {
    const ingreso = 18000 * 6 + 18000 * 6 + (36800 / 6) * 12; // 289,600
    const deducciones = 40000 + IVM_MENSUAL * 12;
    const esperado = (tabla2026(ingreso - deducciones) - 730) / 7; // 275.10
    const { retencion, detalle } = calcularIsrPersonalizado(base());
    expect(Number(retencion)).toBeCloseTo(esperado, 2);
    expect(Number(retencion)).toBe(275.1);
    expect(detalle.ingresoAnual).toBe(289600);
    expect(detalle.deducciones).toBeCloseTo(deducciones, 2);
    expect(detalle.periodosRestantes).toBe(7);
  });

  it("si ya se retuvo más que el ISR del año, no retiene (nunca devuelve)", () => {
    const { retencion } = calcularIsrPersonalizado(base({ historial: meses(5, () => ({ isrRetenido: 2000 })) }));
    expect(Number(retencion)).toBe(0);
  });

  it("en diciembre usa la suma real de las comisiones, no el promedio", () => {
    const historial = meses(11, (i) => ({ variables: i === 0 ? 50000 : 1000, isrRetenido: 0 }));
    const { detalle } = calcularIsrPersonalizado(base({ indicePeriodo: 12, historial, actual: { sueldo: 18000, variables: 1000 } }));
    expect(detalle.ingresoAnual).toBe(18000 * 12 + 50000 + 1000 * 11);
    expect(detalle.periodosRestantes).toBe(1);
  });

  it("quien ingresó a mitad de año promedia sólo los meses que tiene, como el PROMEDIO de la hoja", () => {
    const historial = meses(2, () => ({ variables: 3000, isrRetenido: 0 }));
    const { detalle } = calcularIsrPersonalizado(base({ indicePeriodo: 6, historial, actual: { sueldo: 18000, variables: 6000 } }));
    // 3 meses con registro: (3000 + 3000 + 6000) / 3 × 12 = 48,000; sueldos: 3 pagados + 6 proyectados.
    expect(detalle.ingresoAnual).toBe(18000 * 9 + 48000);
    expect(detalle.ivm).toBeCloseTo(IVM_MENSUAL * 9, 2);
  });

  it("gastos médicos según la edad, con los montos de la fórmula de la hoja", () => {
    expect(gastosMedicosPorEdad(59, CONFIG.deduccionPorEdad)).toBe(40000);
    expect(gastosMedicosPorEdad(60, CONFIG.deduccionPorEdad)).toBe(70000);
    expect(gastosMedicosPorEdad(64, CONFIG.deduccionPorEdad)).toBe(70000);
    expect(gastosMedicosPorEdad(65, CONFIG.deduccionPorEdad)).toBe(460000);
    expect(calcularIsrPersonalizado(base({ edad: 62 })).detalle.gastosMedicos).toBe(70000);
  });

  it("si la persona se va en este período, no proyecta sueldo ni comisiones", () => {
    const { detalle } = calcularIsrPersonalizado(base({ proyectar: false }));
    expect(detalle.ingresoAnual).toBe(18000 * 6 + 36800);
  });

  it("RAP y AFP se restan sólo si la configuración lo pide", () => {
    const conAfp = { ...base(), actual: { sueldo: 18000, variables: 5400, afp: 500 }, historial: meses(5, () => ({ afp: 500 })) };
    expect(calcularIsrPersonalizado(conAfp).detalle.afp).toBe(500 * 12);
    expect(calcularIsrPersonalizado({ ...conAfp, config: { ...CONFIG, deducirAfp: false } }).detalle.afp).toBe(0);
    const conRap = { ...base({ rapMensual: 92.84 }), config: { ...CONFIG, deducirRap: true }, historial: meses(5, () => ({ rap: 92.84 })) };
    conRap.actual = { ...conRap.actual, rap: 92.84 };
    expect(calcularIsrPersonalizado(conRap).detalle.rap).toBeCloseTo(92.84 * 12, 2);
  });

  it("período del año según la fecha de fin: mes, quincena o semana", () => {
    expect(indicePeriodoDelAnio("MENSUAL", new Date("2026-06-30T00:00:00Z"))).toEqual({ periodosAnio: 12, indice: 6 });
    expect(indicePeriodoDelAnio("QUINCENAL", new Date("2026-06-15T00:00:00Z"))).toEqual({ periodosAnio: 24, indice: 11 });
    expect(indicePeriodoDelAnio("QUINCENAL", new Date("2026-06-30T00:00:00Z"))).toEqual({ periodosAnio: 24, indice: 12 });
    expect(indicePeriodoDelAnio("SEMANAL", new Date("2026-01-07T00:00:00Z"))).toEqual({ periodosAnio: 52, indice: 1 });
    expect(indicePeriodoDelAnio("SEMANAL", new Date("2026-12-31T00:00:00Z")).indice).toBe(52);
    expect(mesesDeTipo("QUINCENAL")).toBe(0.5);
  });

  it("en quincenal, la misma lógica por período: lo que falta se reparte entre las quincenas que quedan", () => {
    const historial = Array.from({ length: 10 }, () => ({ meses: 0.5, sueldo: 9000, variables: 3000, isrRetenido: 40 }));
    const { detalle } = calcularIsrPersonalizado(base({ periodosAnio: 24, indicePeriodo: 11, historial, actual: { sueldo: 9000, variables: 3000 } }));
    expect(detalle.ingresoAnual).toBe(9000 * 11 + 18000 * 6.5 + 72000);
    expect(detalle.periodosRestantes).toBe(14);
  });
});

describe("la planilla con el ISR de otro método", () => {
  const entrada = {
    salarioMensual: 18000, tipoPlanilla: "MENSUAL" as const, diasPagables: 30, diasMes: 30, horasExtra: 0,
    bonificaciones: 5400, otrosIngresos: 0, diasAusentes: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 2,
  };

  it("usa ese ISR y rehace los totales con él", () => {
    const estandar = calcularPlanilla(entrada);
    const otro = calcularPlanilla({ ...entrada, isrDelPeriodo: 275.1 });
    expect(Number(otro.isr)).toBe(275.1);
    expect(Number(otro.totalDeducciones)).toBeCloseTo(Number(estandar.totalDeducciones) - Number(estandar.isr) + 275.1, 2);
    expect(Number(otro.salarioNeto)).toBeCloseTo(Number(otro.totalBruto) - Number(otro.totalDeducciones), 2);
  });

  it("sin él, el método estándar no cambia", () => {
    expect(calcularPlanilla({ ...entrada, isrDelPeriodo: null }).isr).toEqual(calcularPlanilla(entrada).isr);
  });
});
