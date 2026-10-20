import { describe, it, expect } from "vitest";
import { generarPartidaContable, CUENTAS, type DetalleParaPartida } from "@/lib/payroll/partida-contable";
import { money, sumar, aNumero as n } from "@/lib/payroll/money";

/**
 * Detalle internamente CONSISTENTE: el neto se deriva de bruto − deducciones.
 * Es la invariante que hace que el asiento cuadre; un detalle que la rompa debe
 * producir `cuadra: false` (ver el último bloque).
 */
function detalle(over: Partial<DetalleParaPartida> = {}): DetalleParaPartida {
  const d = {
    salarioBase: 15000, montoHorasExtra: 0, bonificaciones: 0, otrosIngresos: 0,
    ihssEmpleado: 750, rapEmpleado: 46.45, afpEmpleado: 0, isr: 0, impuestoVecinal: 15,
    cooperativa: 0, prestamos: 0, adelantos: 0, ausencias: 0, otrosDeducciones: 0,
    ihssEmpleador: 1011.77, rapEmpleador: 46.45, infop: 150, reservaLaboral: 600,
    ivmEmpleado: 297.58, ivmEmpleador: 416.61,
    provision13vo: 1250, provision14vo: 1250, provisionVacaciones: 821.92,
    salarioNeto: 0,
    ...over,
  } satisfies DetalleParaPartida;

  if (over.salarioNeto !== undefined) return d;

  const bruto = sumar(d.salarioBase, d.montoHorasExtra, d.bonificaciones, d.otrosIngresos);
  const ded = sumar(d.ihssEmpleado, d.rapEmpleado, d.afpEmpleado, d.isr, d.impuestoVecinal,
    d.cooperativa, d.prestamos, d.adelantos, d.ausencias, d.otrosDeducciones);
  return { ...d, salarioNeto: bruto.minus(ded) };
}

const lineaDe = (p: ReturnType<typeof generarPartidaContable>, cuenta: string) =>
  p.lineas.find((l) => l.cuenta === cuenta);

// ─── CUADRE EXACTO ───────────────────────────────────────────────────────────

describe("Partida contable — cuadre exacto (Debe = Haber al céntimo)", () => {
  it("cuadra con un solo empleado", () => {
    const p = generarPartidaContable([detalle()]);
    expect(p.cuadra).toBe(true);
    expect(n(p.diferencia)).toBe(0);
  });

  it("REGRESIÓN: cuadra EXACTO con 200 empleados y céntimos irregulares", () => {
    // El caso real: 200 empleados con importes que en float64 arrastran error al
    // acumularse. Con `number` + Math.round la diferencia se escondía bajo la
    // tolerancia `< 0.01`; en Decimal debe ser cero absoluto.
    //
    // Los importes se construyen con Decimal (no `12345.67 + i * 0.01`, que ya
    // saldría contaminado del float) para reproducir la forma real del dato:
    // las columnas de PlanillaDetalle son Decimal(12,2), siempre 2 decimales.
    const cent = (n: number) => money(n).div(100);
    const detalles = Array.from({ length: 200 }, (_, i) =>
      detalle({
        salarioBase: cent(1234567 + i),
        montoHorasExtra: cent(10),
        bonificaciones: cent(20),
        otrosIngresos: cent(7),
        isr: cent(33333 + (i % 7)),
        prestamos: cent(11111),
        ausencias: cent(5555),
      })
    );
    const p = generarPartidaContable(detalles);
    expect(p.diferencia.isZero()).toBe(true);
    expect(p.cuadra).toBe(true);
  });

  it("REGRESIÓN: 0.1 + 0.2 se suma exacto, no 0.30000000000000004", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // así se comporta el float que se eliminó
    const p = generarPartidaContable([
      detalle({ salarioBase: 0.1, montoHorasExtra: 0.2, ihssEmpleado: 0, rapEmpleado: 0,
        impuestoVecinal: 0, ihssEmpleador: 0, rapEmpleador: 0, infop: 0, reservaLaboral: 0,
        ivmEmpleado: 0, ivmEmpleador: 0, provision13vo: 0, provision14vo: 0,
        provisionVacaciones: 0 }),
    ]);
    expect(lineaDe(p, CUENTAS.sueldos.cuenta)!.debe.toFixed(2)).toBe("0.10");
    expect(lineaDe(p, CUENTAS.horasExtra.cuenta)!.debe.toFixed(2)).toBe("0.20");
    expect(lineaDe(p, CUENTAS.sueldosPorPagar.cuenta)!.haber.toFixed(2)).toBe("0.30");
    expect(p.cuadra).toBe(true);
  });

  it("cuadra también sin provisiones", () => {
    const p = generarPartidaContable([detalle(), detalle()], { incluirProvisiones: false });
    expect(p.cuadra).toBe(true);
    expect(lineaDe(p, CUENTAS.gasto13vo.cuenta)).toBeUndefined();
    expect(lineaDe(p, CUENTAS.provision13Pagar.cuenta)).toBeUndefined();
  });

  it("acepta los Decimal de Prisma sin conversión intermedia", () => {
    const p = generarPartidaContable([detalle({ salarioBase: money("15000.55") })]);
    expect(lineaDe(p, CUENTAS.sueldos.cuenta)!.debe.toFixed(2)).toBe("15000.55");
    expect(p.cuadra).toBe(true);
  });

  it("una partida sin detalles cuadra y no genera líneas", () => {
    const p = generarPartidaContable([]);
    expect(p.lineas).toHaveLength(0);
    expect(p.cuadra).toBe(true);
  });
});

// ─── IMPORTES NEGATIVOS ──────────────────────────────────────────────────────

describe("Importes negativos — se registran y se reportan, no se descartan", () => {
  // Config corrupta: la porción IVM patronal supera al total IHSS patronal, así
  // que el régimen EM (= IHSS − IVM) sale negativo. Antes ese `if (monto > 0)`
  // lo tiraba y el asiento quedaba descuadrado sin ninguna señal.
  const corrupto = () => detalle({ ihssEmpleador: 100, ivmEmpleador: 250 });

  it("REGRESIÓN: un rubro negativo ya no desaparece del asiento", () => {
    const p = generarPartidaContable([corrupto()]);
    expect(lineaDe(p, CUENTAS.patronalIhss.cuenta)).toBeDefined();
  });

  it("el asiento sigue cuadrando pese al importe negativo", () => {
    const p = generarPartidaContable([corrupto()]);
    expect(p.cuadra).toBe(true);
  });

  it("lo registra en el lado contrario por su valor absoluto", () => {
    // patronalIhss = 100 − 250 = −150 → se va al HABER por 150
    const l = lineaDe(generarPartidaContable([corrupto()]), CUENTAS.patronalIhss.cuenta)!;
    expect(n(l.debe)).toBe(0);
    expect(n(l.haber)).toBe(150);
  });

  it("lo reporta como anomalía con cuenta e importe", () => {
    const p = generarPartidaContable([corrupto()]);
    expect(p.anomalias).toHaveLength(1);
    expect(p.anomalias[0]).toContain(CUENTAS.patronalIhss.cuenta);
    expect(p.anomalias[0]).toContain("-150.00");
  });

  it("un asiento sano no reporta ninguna anomalía", () => {
    expect(generarPartidaContable([detalle(), detalle()]).anomalias).toEqual([]);
  });
});

// ─── LÍNEAS EN CERO ──────────────────────────────────────────────────────────

describe("Líneas en cero", () => {
  it("un rubro en cero no genera línea", () => {
    const p = generarPartidaContable([detalle({ bonificaciones: 0, cooperativa: 0 })]);
    expect(lineaDe(p, CUENTAS.bonificaciones.cuenta)).toBeUndefined();
    expect(lineaDe(p, CUENTAS.cooperativaPorPagar.cuenta)).toBeUndefined();
  });

  it("un rubro con importe sí la genera", () => {
    const p = generarPartidaContable([detalle({ bonificaciones: 500 })]);
    expect(n(lineaDe(p, CUENTAS.bonificaciones.cuenta)!.debe)).toBe(500);
  });
});

// ─── ESTRUCTURA DEL ASIENTO ──────────────────────────────────────────────────

describe("Estructura del asiento", () => {
  it("separa las cuentas EM e IVM y juntas suman el total IHSS", () => {
    const p = generarPartidaContable([detalle()]);
    const em = lineaDe(p, CUENTAS.ihssPorPagar.cuenta)!.haber;
    const ivm = lineaDe(p, CUENTAS.ivmPorPagar.cuenta)!.haber;
    // total empleado + patrono = 750 + 1011.77
    expect(n(em.plus(ivm))).toBeCloseTo(1761.77, 2);
  });

  it("el descuento por ausencia va al HABER, no reduce el gasto de sueldos", () => {
    const p = generarPartidaContable([detalle({ ausencias: 1000 })]);
    const l = lineaDe(p, CUENTAS.descuentoAusencias.cuenta)!;
    expect(n(l.haber)).toBe(1000);
    expect(n(l.debe)).toBe(0);
  });

  it("el neto a pagar es el único abono a Sueldos por Pagar", () => {
    const d = detalle();
    const p = generarPartidaContable([d]);
    expect(n(lineaDe(p, CUENTAS.sueldosPorPagar.cuenta)!.haber)).toBe(n(money(d.salarioNeto)));
  });
});

// ─── DETECCIÓN DE DATOS INCONSISTENTES ───────────────────────────────────────

describe("Sin tolerancia: un detalle incoherente ya no pasa por cuadrado", () => {
  it("REGRESIÓN: un descuadre de 1 céntimo se detecta (antes lo tapaba < 0.01)", () => {
    const d = detalle();
    // Neto alterado en exactamente un céntimo: el caso que la tolerancia ocultaba.
    const roto = { ...d, salarioNeto: money(d.salarioNeto).plus("0.01") };
    const p = generarPartidaContable([roto]);
    expect(p.cuadra).toBe(false);
    expect(p.diferencia.toFixed(2)).toBe("-0.01");
  });

  it("reporta la diferencia con signo para poder rastrearla", () => {
    const d = detalle();
    const roto = { ...d, salarioNeto: money(d.salarioNeto).minus("2.50") };
    const p = generarPartidaContable([roto]);
    expect(p.cuadra).toBe(false);
    expect(p.diferencia.toFixed(2)).toBe("2.50");
  });
});
