import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { aplicarCobros, devolverCobros, escribirLineas, type CalculoPlanilla } from "./calculo-planilla-bd";
import { money } from "./money";

const AMORTIZACION = { id: "d1", cuotasPagadas: 1, saldo: money(5000), desactivar: false, montoAplicado: money(1000) };

function calculo(over: Partial<CalculoPlanilla> = {}): CalculoPlanilla {
  return {
    detalles: [{ empleadoId: "e1", totalBruto: money(30000), totalDeducciones: money(2000), salarioNeto: money(28000) } as CalculoPlanilla["detalles"][number]],
    amortizaciones: [],
    bonos: [],
    totales: { totalBruto: money(30000), totalDeducciones: money(2000), totalNeto: money(28000), totalEmpleador: money(3000) },
    metodoIsr: "ESTANDAR",
    ...over,
  };
}

function falsoTx(opts: { pendientes?: object[]; conBono?: object[]; evaluacion?: object | null } = {}) {
  const orden: string[] = [];
  const espia = (nombre: string, valor?: unknown) => vi.fn(async () => { orden.push(nombre); return valor; });
  const tx = {
    $executeRaw: vi.fn(async () => { orden.push("sql"); return 1; }),
    planilla: { update: espia("planilla.update") },
    planillaDetalle: {
      deleteMany: espia("detalle.deleteMany"),
      createMany: espia("detalle.createMany"),
      findMany: espia("detalle.findMany", opts.conBono ?? []),
    },
    amortizacionPlanilla: {
      createMany: espia("amort.createMany"),
      findMany: espia("amort.findMany", opts.pendientes ?? []),
      updateMany: espia("amort.updateMany"),
      deleteMany: espia("amort.deleteMany"),
    },
    evaluacion: {
      findFirst: espia("eval.findFirst", opts.evaluacion ?? null),
      update: espia("eval.update"),
    },
  };
  return { tx, orden, comoTx: tx as unknown as Parameters<typeof escribirLineas>[0] };
}

describe("escribir las líneas", () => {
  it("reemplaza las anteriores y actualiza los totales", async () => {
    const { tx, orden, comoTx } = falsoTx();
    await escribirLineas(comoTx, "p1", calculo());
    expect(orden).toEqual(["detalle.deleteMany", "detalle.createMany", "planilla.update"]);
    expect(tx.planillaDetalle.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ empleadoId: "e1", planillaId: "p1" })] });
  });

  it("no cobra nada: un borrador no toca préstamos ni bonos", async () => {
    const { tx, comoTx } = falsoTx();
    await escribirLineas(comoTx, "p1", calculo({ amortizaciones: [AMORTIZACION], bonos: [{ evaluacionId: "ev", bonoMonto: money(100), bonoPorcentaje: 0.1 }] }));
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.amortizacionPlanilla.createMany).not.toHaveBeenCalled();
  });
});

describe("cobrar al confirmar", () => {
  it("amortiza y deja el registro para poder devolverlo", async () => {
    const { tx, comoTx } = falsoTx();
    await aplicarCobros(comoTx, "p1", calculo({ amortizaciones: [AMORTIZACION] }));
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.amortizacionPlanilla.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ planillaId: "p1", deduccionId: "d1", llevaSaldo: true, desactivo: false })],
    });
  });

  it("sin nada que cobrar no escribe", async () => {
    const { orden, comoTx } = falsoTx();
    await aplicarCobros(comoTx, "p1", calculo());
    expect(orden).toEqual([]);
  });
});

describe("devolver lo cobrado", () => {
  const PENDIENTE = { id: "a1", deduccionId: "d1", montoAplicado: money(1000), llevaSaldo: true, desactivo: false };

  it("al anular sella el registro, para no devolver dos veces", async () => {
    const { tx, comoTx } = falsoTx({ pendientes: [PENDIENTE] });
    expect(await devolverCobros(comoTx, "p1", { conservarRegistro: true })).toBe(1);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.amortizacionPlanilla.updateMany).toHaveBeenCalledOnce();
    expect(tx.amortizacionPlanilla.deleteMany).not.toHaveBeenCalled();
  });

  it("al volver a borrador borra el registro: se confirmará otra vez", async () => {
    const { tx, comoTx } = falsoTx({ pendientes: [PENDIENTE] });
    await devolverCobros(comoTx, "p1", { conservarRegistro: false });
    expect(tx.amortizacionPlanilla.deleteMany).toHaveBeenCalledWith({ where: { planillaId: "p1" } });
    expect(tx.amortizacionPlanilla.updateMany).not.toHaveBeenCalled();
  });

  it("REGRESIÓN: libera el bono, para que la planilla corregida lo vuelva a pagar", async () => {
    const { tx, comoTx } = falsoTx({ conBono: [{ empleadoId: "e1", bonificaciones: money(500) }], evaluacion: { id: "ev1" } });
    await devolverCobros(comoTx, "p1", { conservarRegistro: true });
    expect(tx.evaluacion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { empleadoId: "e1", bonoAplicado: true, bonoMonto: money(500) },
    }));
    expect(tx.evaluacion.update).toHaveBeenCalledWith({ where: { id: "ev1" }, data: { bonoAplicado: false, bonoMonto: null, bonoPorcentaje: null } });
  });

  it("sin evaluación que coincida no toca ninguna", async () => {
    const { tx, comoTx } = falsoTx({ conBono: [{ empleadoId: "e1", bonificaciones: money(500) }], evaluacion: null });
    await devolverCobros(comoTx, "p1", { conservarRegistro: true });
    expect(tx.evaluacion.update).not.toHaveBeenCalled();
  });

  it("sin cobros no ejecuta la reversión", async () => {
    const { tx, comoTx } = falsoTx();
    expect(await devolverCobros(comoTx, "p1", { conservarRegistro: true })).toBe(0);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
