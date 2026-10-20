/**
 * Liquidación del 13.º y 14.º mes.
 *
 * El sistema sólo tenía la PROVISIÓN mensual: no había forma de consultar el
 * acumulado de un empleado ni de emitir el pago de junio o diciembre.
 */

import { describe, it, expect } from "vitest";
import {
  calcularDecimo,
  liquidarDecimo,
  aplicarFiscalidadDecimo,
  ventanaDevengo,
  mesDePago,
  salarioPromedioPonderado,
  DIAS_ANIO_COMERCIAL,
  SALARIOS_MINIMOS_EXENTOS,
} from "@/lib/payroll/decimos";
import { aNumero as n } from "@/lib/payroll/money";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Salario mínimo de referencia usado en las pruebas de exención. */
const SAL_MIN = 11903.13;

describe("ventana de devengo", () => {
  it("el décimo tercero devenga sobre el año natural y se paga en diciembre", () => {
    const v = ventanaDevengo("DECIMO_TERCERO", 2026);
    expect(v.desde.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(v.hasta.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(mesDePago("DECIMO_TERCERO")).toBe(11); // diciembre
  });

  it("el décimo cuarto devenga de julio a junio y se paga en junio", () => {
    const v = ventanaDevengo("DECIMO_CUARTO", 2026);
    expect(v.desde.toISOString().slice(0, 10)).toBe("2025-07-01");
    expect(v.hasta.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(mesDePago("DECIMO_CUARTO")).toBe(5); // junio
  });
});

describe("calcularDecimo — devengo", () => {
  it("un año completo de servicio devenga un mes de salario", () => {
    const r = calcularDecimo({
      tipo: "DECIMO_TERCERO",
      anio: 2026,
      fechaIngreso: d("2020-03-15"),
      salarioPromedio: 18000,
    });
    expect(r.diasComputados).toBe(DIAS_ANIO_COMERCIAL);
    expect(n(r.montoDevengado)).toBeCloseTo(18000, 2);
    expect(r.esProporcional).toBe(false);
  });

  it("quien ingresa a mitad de año devenga el proporcional", () => {
    // Del 1 de julio al 31 de diciembre = 184 días.
    const r = calcularDecimo({
      tipo: "DECIMO_TERCERO",
      anio: 2026,
      fechaIngreso: d("2026-07-01"),
      salarioPromedio: 12000,
    });
    expect(r.diasComputados).toBe(184);
    expect(n(r.montoDevengado)).toBeCloseTo(12000 * 184 / 360, 2);
    expect(r.esProporcional).toBe(true);
  });

  it("quien causa baja a mitad de año devenga sólo hasta su salida", () => {
    // Del 1 de enero al 31 de marzo = 90 días.
    const r = calcularDecimo({
      tipo: "DECIMO_TERCERO",
      anio: 2026,
      fechaIngreso: d("2018-01-01"),
      fechaSalida: d("2026-03-31"),
      salarioPromedio: 24000,
    });
    expect(r.diasComputados).toBe(90);
    expect(n(r.montoDevengado)).toBeCloseTo(24000 / 4, 2);
    expect(r.esProporcional).toBe(true);
  });

  it("nunca devenga más de un mes de salario", () => {
    // Un año de 365 días se acota al año comercial de 360.
    const r = calcularDecimo({
      tipo: "DECIMO_TERCERO",
      anio: 2026,
      fechaIngreso: d("2015-01-01"),
      salarioPromedio: 30000,
    });
    expect(r.diasComputados).toBe(DIAS_ANIO_COMERCIAL);
    expect(n(r.montoDevengado)).toBeCloseTo(30000, 2);
  });

  it("quien ingresa después de la ventana no devenga nada", () => {
    const r = calcularDecimo({
      tipo: "DECIMO_TERCERO",
      anio: 2026,
      fechaIngreso: d("2027-02-01"),
      salarioPromedio: 20000,
    });
    expect(r.diasComputados).toBe(0);
    expect(n(r.montoDevengado)).toBe(0);
  });

  it("el corte permite proyectar el acumulado a una fecha intermedia", () => {
    // Al 30 de junio se lleva devengado medio año.
    const r = calcularDecimo({
      tipo: "DECIMO_TERCERO",
      anio: 2026,
      fechaIngreso: d("2015-01-01"),
      salarioPromedio: 24000,
      hasta: d("2026-06-30"),
    });
    expect(r.diasComputados).toBe(181); // 1 ene a 30 jun, inclusivo
    expect(n(r.montoDevengado)).toBeCloseTo(24000 * 181 / 360, 2);
  });

  it("el décimo cuarto computa sobre su propia ventana de julio a junio", () => {
    // Ingreso el 1 de enero de 2026: sólo devenga de enero a junio (181 días).
    const r = calcularDecimo({
      tipo: "DECIMO_CUARTO",
      anio: 2026,
      fechaIngreso: d("2026-01-01"),
      salarioPromedio: 18000,
    });
    expect(r.diasComputados).toBe(181);
    expect(r.periodoDesde.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(r.periodoHasta.toISOString().slice(0, 10)).toBe("2026-06-30");
  });
});

describe("fiscalidad del décimo — exención del Art. 11 Ley del ISR", () => {
  it("el techo exento es de diez salarios mínimos", () => {
    const f = aplicarFiscalidadDecimo({ montoDevengado: 5000, salarioMinimo: SAL_MIN });
    expect(n(f.techoExento)).toBeCloseTo(SAL_MIN * SALARIOS_MINIMOS_EXENTOS, 2);
  });

  it("un décimo por debajo del techo no tributa", () => {
    const f = aplicarFiscalidadDecimo({
      montoDevengado: 40000, salarioMinimo: SAL_MIN, rentaOrdinariaAnual: 600000,
    });
    expect(n(f.montoGravado)).toBe(0);
    expect(n(f.isrRetenido)).toBe(0);
    expect(n(f.montoNeto)).toBeCloseTo(40000, 2);
  });

  it("sólo el excedente sobre el techo tributa", () => {
    const techo = SAL_MIN * SALARIOS_MINIMOS_EXENTOS; // 119,031.30
    const f = aplicarFiscalidadDecimo({
      montoDevengado: techo + 50000,
      salarioMinimo: SAL_MIN,
      rentaOrdinariaAnual: 900000,
    });
    expect(n(f.montoExento)).toBeCloseTo(techo, 2);
    expect(n(f.montoGravado)).toBeCloseTo(50000, 2);
    expect(n(f.isrRetenido)).toBeGreaterThan(0);
  });

  it("el techo es CONJUNTO: lo que consumió un décimo no lo tiene el otro", () => {
    const techo = SAL_MIN * SALARIOS_MINIMOS_EXENTOS;
    const f = aplicarFiscalidadDecimo({
      montoDevengado: 80000,
      salarioMinimo: SAL_MIN,
      exentoYaUsado: techo - 30000, // el 14.º ya consumió casi todo
      rentaOrdinariaAnual: 900000,
    });
    expect(n(f.montoExento)).toBeCloseTo(30000, 2);
    expect(n(f.montoGravado)).toBeCloseTo(50000, 2);
  });

  it("un techo ya agotado deja el décimo entero gravado", () => {
    const techo = SAL_MIN * SALARIOS_MINIMOS_EXENTOS;
    const f = aplicarFiscalidadDecimo({
      montoDevengado: 25000,
      salarioMinimo: SAL_MIN,
      exentoYaUsado: techo,
      rentaOrdinariaAnual: 900000,
    });
    expect(n(f.montoExento)).toBe(0);
    expect(n(f.montoGravado)).toBeCloseTo(25000, 2);
  });

  it("el excedente tributa al tramo marginal del trabajador, no de forma aislada", () => {
    const techo = SAL_MIN * SALARIOS_MINIMOS_EXENTOS;
    const excedente = 40000;
    // Mismo excedente, dos rentas ordinarias distintas: quien está en un tramo
    // más alto retiene más. Calcularlo aislado daría lo mismo en ambos casos.
    const rentaBaja = aplicarFiscalidadDecimo({
      montoDevengado: techo + excedente, salarioMinimo: SAL_MIN, rentaOrdinariaAnual: 300000,
    });
    const rentaAlta = aplicarFiscalidadDecimo({
      montoDevengado: techo + excedente, salarioMinimo: SAL_MIN, rentaOrdinariaAnual: 1500000,
    });
    expect(n(rentaAlta.isrRetenido)).toBeGreaterThan(n(rentaBaja.isrRetenido));
  });

  it("la retención nunca es negativa", () => {
    const f = aplicarFiscalidadDecimo({
      montoDevengado: 5000, salarioMinimo: SAL_MIN, rentaOrdinariaAnual: 0,
    });
    expect(n(f.isrRetenido)).toBeGreaterThanOrEqual(0);
  });
});

describe("liquidarDecimo — devengo más fiscalidad", () => {
  it("compone el resultado completo listo para guardar y pagar", () => {
    const r = liquidarDecimo(
      {
        tipo: "DECIMO_TERCERO",
        anio: 2026,
        fechaIngreso: d("2020-01-01"),
        salarioPromedio: 30000,
      },
      { salarioMinimo: SAL_MIN, rentaOrdinariaAnual: 360000 }
    );

    expect(n(r.montoDevengado)).toBeCloseTo(30000, 2);
    expect(n(r.montoExento)).toBeCloseTo(30000, 2); // bajo el techo
    expect(n(r.isrRetenido)).toBe(0);
    expect(n(r.montoNeto)).toBeCloseTo(30000, 2);
    expect(r.diasComputados).toBe(DIAS_ANIO_COMERCIAL);
  });

  it("el neto es el devengado menos la retención", () => {
    const techo = SAL_MIN * SALARIOS_MINIMOS_EXENTOS;
    const r = liquidarDecimo(
      {
        tipo: "DECIMO_TERCERO",
        anio: 2026,
        fechaIngreso: d("2015-01-01"),
        salarioPromedio: techo + 60000,
      },
      { salarioMinimo: SAL_MIN, rentaOrdinariaAnual: 1200000 }
    );
    expect(n(r.montoNeto)).toBeCloseTo(n(r.montoDevengado) - n(r.isrRetenido), 2);
  });
});

describe("salarioPromedioPonderado", () => {
  it("pondera cada salario por los días que estuvo vigente", () => {
    // Un aumento en el último mes no debe inflar el aguinaldo entero.
    const p = salarioPromedioPonderado([
      { salario: 20000, dias: 330 },
      { salario: 40000, dias: 30 },
    ]);
    expect(n(p)).toBeCloseTo((20000 * 330 + 40000 * 30) / 360, 2);
    expect(n(p)).toBeLessThan(40000);
  });

  it("un único tramo devuelve ese salario", () => {
    expect(n(salarioPromedioPonderado([{ salario: 25000, dias: 360 }]))).toBeCloseTo(25000, 2);
  });

  it("sin tramos devuelve cero en vez de dividir por cero", () => {
    expect(n(salarioPromedioPonderado([]))).toBe(0);
    expect(n(salarioPromedioPonderado([{ salario: 1000, dias: 0 }]))).toBe(0);
  });
});
