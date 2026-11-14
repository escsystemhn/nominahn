/**
 * Liquidación final de prestaciones.
 *
 * Los valores esperados siguen el criterio de la calculadora de la Secretaría
 * de Trabajo (consulta.trabajo.gob.hn), que es el que aplica la inspectoría.
 */

import { describe, it, expect } from "vitest";
import {
  calcularLiquidacion,
  calcularTiempoServicio,
  diasPreaviso,
  diasCesantia,
  porcentajeCesantia,
  correspondePreaviso,
  salarioOrdinarioPromedio,
  TOPE_CESANTIA_DIAS,
  TOPE_CESANTIA_DIAS_MICROEMPRESA,
  PORCENTAJE_CESANTIA_RENUNCIA,
  PORCENTAJE_CESANTIA_MUERTE,
  type CausaTerminacion,
} from "@/lib/payroll/liquidacion";
import { aNumero as n } from "@/lib/payroll/money";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Salario de trabajo: L 15,000 al mes → L 500 diarios exactos. */
const SALARIO = 15000;
const DIARIO = 500;

function liquidar(over: Partial<Parameters<typeof calcularLiquidacion>[0]> = {}) {
  return calcularLiquidacion({
    fechaIngreso: d("2020-01-01"),
    fechaSalida: d("2026-06-30"),
    causa: "DESPIDO_INJUSTIFICADO",
    salarioPromedio: SALARIO,
    ...over,
  });
}

/** Importe de un concepto por nombre, o 0 si no aparece en la liquidación. */
function concepto(r: ReturnType<typeof calcularLiquidacion>, nombre: string): number {
  const c = r.conceptos.find((x) => x.concepto.startsWith(nombre));
  return c ? n(c.monto) : 0;
}

// ─── TIEMPO DE SERVICIO ──────────────────────────────────────────────────────

describe("calcularTiempoServicio", () => {
  it("cuenta los meses por calendario, no en bloques de 30 días", () => {
    // Del 15 de enero al 15 de abril son tres meses, aunque sean 91 días.
    expect(calcularTiempoServicio(d("2026-01-15"), d("2026-04-15")).mesesCompletos).toBe(3);
  });

  it("un ingreso a fin de mes cumple el mes el último día del mes corto", () => {
    // Quien entra el 31 de enero cumple el mes el 28 de febrero: febrero no
    // tiene 31. Sin esta regla se perdía un mes de antigüedad y con él un
    // tramo entero de preaviso o de cesantía.
    expect(calcularTiempoServicio(d("2026-01-31"), d("2026-02-28")).mesesCompletos).toBe(1);
    expect(calcularTiempoServicio(d("2026-01-31"), d("2026-02-27")).mesesCompletos).toBe(0);
    // En año bisiesto el mes se cumple el 29.
    expect(calcularTiempoServicio(d("2028-01-31"), d("2028-02-29")).mesesCompletos).toBe(1);
    // Marzo sí tiene 31: ahí no aplica la excepción.
    expect(calcularTiempoServicio(d("2026-01-31"), d("2026-03-30")).mesesCompletos).toBe(1);
    expect(calcularTiempoServicio(d("2026-01-31"), d("2026-03-31")).mesesCompletos).toBe(2);
  });

  it("el mes sólo se completa al llegar al mismo día", () => {
    expect(calcularTiempoServicio(d("2026-01-15"), d("2026-02-14")).mesesCompletos).toBe(0);
    expect(calcularTiempoServicio(d("2026-01-15"), d("2026-02-15")).mesesCompletos).toBe(1);
  });

  it("cuenta aniversarios cumplidos", () => {
    const t = calcularTiempoServicio(d("2020-03-10"), d("2026-03-09"));
    expect(t.aniosCompletos).toBe(5); // aún no cumple el sexto
    expect(calcularTiempoServicio(d("2020-03-10"), d("2026-03-10")).aniosCompletos).toBe(6);
  });

  it("el día de ingreso y el de salida cuentan como trabajados", () => {
    expect(calcularTiempoServicio(d("2026-01-01"), d("2026-01-01")).dias).toBe(1);
  });

  it("los años fraccionarios suman la porción del año en curso", () => {
    const t = calcularTiempoServicio(d("2020-01-01"), d("2026-07-01"));
    expect(t.aniosCompletos).toBe(6);
    expect(t.aniosFraccionarios).toBeGreaterThan(6.4);
    expect(t.aniosFraccionarios).toBeLessThan(6.6);
  });

  it("una salida anterior al ingreso no produce tiempo negativo", () => {
    const t = calcularTiempoServicio(d("2026-06-01"), d("2026-01-01"));
    expect(t.dias).toBe(0);
    expect(t.mesesCompletos).toBe(0);
  });
});

// ─── PREAVISO — Art. 116 ─────────────────────────────────────────────────────

describe("preaviso — Art. 116", () => {
  it("aplica la escala completa por meses de servicio", () => {
    expect(diasPreaviso(0)).toBe(1);   // menos de 3 meses → 24 horas
    expect(diasPreaviso(2)).toBe(1);
    expect(diasPreaviso(3)).toBe(7);   // 1 semana
    expect(diasPreaviso(5)).toBe(7);
    expect(diasPreaviso(6)).toBe(14);  // 2 semanas
    expect(diasPreaviso(11)).toBe(14);
    expect(diasPreaviso(12)).toBe(30); // 1 mes
    expect(diasPreaviso(23)).toBe(30);
    expect(diasPreaviso(24)).toBe(60); // 2 meses
    expect(diasPreaviso(200)).toBe(60);
  });

  it("sólo el despido injustificado lo genera", () => {
    expect(correspondePreaviso("DESPIDO_INJUSTIFICADO")).toBe(true);
    expect(correspondePreaviso("RENUNCIA")).toBe(false);
    expect(correspondePreaviso("DESPIDO_JUSTIFICADO")).toBe(false);
    expect(correspondePreaviso("MUERTE")).toBe(false);
  });

  it("no se paga si el patrono lo otorgó por escrito", () => {
    expect(concepto(liquidar({ preavisoOtorgado: true }), "Preaviso")).toBe(0);
    expect(liquidar({ preavisoOtorgado: true }).observaciones.join(" ")).toMatch(/otorgado/i);
  });

  it("con más de dos años se pagan 60 días de salario", () => {
    expect(concepto(liquidar(), "Preaviso")).toBeCloseTo(60 * DIARIO, 2);
  });
});

// ─── AUXILIO DE CESANTÍA — Art. 120 ──────────────────────────────────────────

describe("auxilio de cesantía — Art. 120", () => {
  const servicio = (meses: number) =>
    calcularTiempoServicio(d("2020-01-01"), mesesDespues(d("2020-01-01"), meses));

  function mesesDespues(base: Date, meses: number): Date {
    const f = new Date(base);
    f.setUTCMonth(f.getUTCMonth() + meses);
    return f;
  }

  it("menos de tres meses no genera auxilio", () => {
    expect(diasCesantia(servicio(2))).toBe(0);
  });

  it("de tres a seis meses: 10 días de salario", () => {
    expect(diasCesantia(servicio(3))).toBe(10);
    expect(diasCesantia(servicio(5))).toBe(10);
  });

  it("de seis meses a un año: 20 días de salario", () => {
    expect(diasCesantia(servicio(6))).toBe(20);
    expect(diasCesantia(servicio(11))).toBe(20);
  });

  it("a partir del año: un mes de salario por año", () => {
    expect(diasCesantia(servicio(12))).toBeCloseTo(30, 1);
    expect(diasCesantia(servicio(60))).toBeCloseTo(150, 1); // 5 años
  });

  it("la fracción de año se paga en proporción", () => {
    // 6 años y medio ≈ 195 días de cesantía.
    const t = calcularTiempoServicio(d("2020-01-01"), d("2026-07-01"));
    expect(diasCesantia(t)).toBeGreaterThan(190);
    expect(diasCesantia(t)).toBeLessThan(200);
  });

  it("se acota al tope de 25 meses", () => {
    // 40 años de servicio superarían los 1,200 días sin tope.
    const t = calcularTiempoServicio(d("1986-01-01"), d("2026-01-01"));
    expect(diasCesantia(t)).toBe(TOPE_CESANTIA_DIAS);
  });

  it("en empresa de hasta 10 trabajadores el tope baja a 15 meses", () => {
    const t = calcularTiempoServicio(d("1986-01-01"), d("2026-01-01"));
    expect(diasCesantia(t, true)).toBe(TOPE_CESANTIA_DIAS_MICROEMPRESA);
  });
});

describe("porcentaje de cesantía según la causa", () => {
  const largo = calcularTiempoServicio(d("2000-01-01"), d("2026-01-01"));  // 26 años
  const medio = calcularTiempoServicio(d("2020-01-01"), d("2026-01-01"));  // 6 años
  const corto = calcularTiempoServicio(d("2026-01-01"), d("2026-04-01"));  // 3 meses

  it("el despido injustificado paga el auxilio completo", () => {
    expect(porcentajeCesantia("DESPIDO_INJUSTIFICADO", medio)).toBe(1);
  });

  it("el despido justificado no genera auxilio", () => {
    expect(porcentajeCesantia("DESPIDO_JUSTIFICADO", largo)).toBe(0);
  });

  it("la renuncia sólo paga a partir de 15 años, y al 35 %", () => {
    expect(porcentajeCesantia("RENUNCIA", medio)).toBe(0);
    expect(porcentajeCesantia("RENUNCIA", largo)).toBe(PORCENTAJE_CESANTIA_RENUNCIA);
  });

  it("en microempresa la renuncia nunca genera auxilio (Art. 120-A)", () => {
    expect(porcentajeCesantia("RENUNCIA", largo, true)).toBe(0);
  });

  it("por muerte, los beneficiarios reciben el 75 % desde los 6 meses", () => {
    expect(porcentajeCesantia("MUERTE", medio)).toBe(PORCENTAJE_CESANTIA_MUERTE);
    expect(porcentajeCesantia("MUERTE", corto)).toBe(0);
  });
});

// ─── LIQUIDACIÓN COMPLETA ────────────────────────────────────────────────────

describe("calcularLiquidacion — despido injustificado", () => {
  const r = liquidar();

  it("paga preaviso y cesantía completa", () => {
    expect(concepto(r, "Preaviso")).toBeCloseTo(60 * DIARIO, 2);
    expect(concepto(r, "Auxilio de cesantía")).toBeGreaterThan(0);
  });

  it("el salario diario es el promedio mensual entre 30", () => {
    expect(n(r.salarioDiario)).toBeCloseTo(DIARIO, 2);
  });

  it("el total es la suma exacta de los conceptos", () => {
    const suma = r.conceptos.reduce((a, c) => a + n(c.monto), 0);
    expect(n(r.totalPrestaciones)).toBeCloseTo(suma, 2);
  });

  it("cada concepto declara su fundamento legal", () => {
    for (const c of r.conceptos) expect(c.base.length).toBeGreaterThan(0);
    expect(r.conceptos.find((c) => c.concepto === "Preaviso")?.base).toBe("Art. 116 C.T.");
  });
});

describe("calcularLiquidacion — según la causa", () => {
  const causas: CausaTerminacion[] = [
    "DESPIDO_INJUSTIFICADO",
    "RENUNCIA",
    "DESPIDO_JUSTIFICADO",
    "MUERTE",
  ];

  it("vacaciones y décimos se pagan SIEMPRE: son salario devengado", () => {
    for (const causa of causas) {
      const r = liquidar({
        causa,
        decimoTerceroDevengado: 7500,
        decimoCuartoDevengado: 15000,
      });
      expect(concepto(r, "Vacaciones no gozadas")).toBeGreaterThan(0);
      expect(concepto(r, "Décimo tercer mes")).toBeCloseTo(7500, 2);
      expect(concepto(r, "Décimo cuarto mes")).toBeCloseTo(15000, 2);
    }
  });

  it("la renuncia con 6 años no paga preaviso ni cesantía", () => {
    const r = liquidar({ causa: "RENUNCIA" });
    expect(concepto(r, "Preaviso")).toBe(0);
    expect(concepto(r, "Auxilio de cesantía")).toBe(0);
    expect(r.observaciones.join(" ")).toMatch(/15 años/);
  });

  it("la renuncia con más de 15 años paga el 35 % del auxilio", () => {
    const conRenuncia = liquidar({
      fechaIngreso: d("2005-01-01"),
      causa: "RENUNCIA",
    });
    const conDespido = liquidar({
      fechaIngreso: d("2005-01-01"),
      causa: "DESPIDO_INJUSTIFICADO",
    });
    expect(concepto(conRenuncia, "Auxilio de cesantía"))
      .toBeCloseTo(concepto(conDespido, "Auxilio de cesantía") * 0.35, 1);
  });

  it("el despido justificado sólo paga lo devengado", () => {
    const r = liquidar({ causa: "DESPIDO_JUSTIFICADO" });
    expect(concepto(r, "Preaviso")).toBe(0);
    expect(concepto(r, "Auxilio de cesantía")).toBe(0);
    expect(concepto(r, "Vacaciones no gozadas")).toBeGreaterThan(0);
    expect(r.observaciones.join(" ")).toMatch(/causa justificada/i);
  });

  it("por muerte se paga el 75 % del auxilio, sin preaviso", () => {
    const porMuerte = liquidar({ causa: "MUERTE" });
    const porDespido = liquidar({ causa: "DESPIDO_INJUSTIFICADO" });
    expect(concepto(porMuerte, "Preaviso")).toBe(0);
    expect(concepto(porMuerte, "Auxilio de cesantía"))
      .toBeCloseTo(concepto(porDespido, "Auxilio de cesantía") * 0.75, 1);
  });
});

describe("calcularLiquidacion — vacaciones y deducciones", () => {
  it("descuenta los días de vacaciones ya gozados", () => {
    const sin = liquidar({ diasVacacionesGozados: 0 });
    const con = liquidar({ diasVacacionesGozados: 10 });
    expect(concepto(con, "Vacaciones no gozadas"))
      .toBeCloseTo(concepto(sin, "Vacaciones no gozadas") - 10 * DIARIO, 2);
  });

  it("gozar más días de los devengados no produce un importe negativo", () => {
    const r = liquidar({ diasVacacionesGozados: 999 });
    expect(concepto(r, "Vacaciones no gozadas")).toBe(0);
  });

  it("resta las deducciones del total a pagar", () => {
    const r = liquidar({ deducciones: 5000 });
    expect(n(r.deducciones)).toBeCloseTo(5000, 2);
    expect(n(r.totalAPagar)).toBeCloseTo(n(r.totalPrestaciones) - 5000, 2);
  });

  it("las deducciones nunca dejan el finiquito en negativo", () => {
    const r = liquidar({ causa: "DESPIDO_JUSTIFICADO", deducciones: 9_999_999 });
    expect(n(r.totalAPagar)).toBe(0);
    expect(n(r.deducciones)).toBeCloseTo(n(r.totalPrestaciones), 2);
    expect(r.observaciones.join(" ")).toMatch(/superan el total/i);
  });

  it("suma salarios pendientes y otros adeudos", () => {
    const r = liquidar({ salariosPendientes: 7500, otrosAdeudos: 1200 });
    expect(concepto(r, "Salarios pendientes")).toBeCloseTo(7500, 2);
    expect(concepto(r, "Otros adeudos")).toBeCloseTo(1200, 2);
  });

  it("los conceptos en cero no aparecen en el finiquito", () => {
    const r = liquidar({ decimoTerceroDevengado: 0 });
    expect(r.conceptos.some((c) => c.concepto.startsWith("Décimo tercer"))).toBe(false);
  });

  it("el RAP pendiente a mes vencido va en su propia línea de deducciones, junto a los préstamos", () => {
    const r = liquidar({
      deducciones: 5000,
      deduccionesLegales: [{ clave: "RAP_PENDIENTE", concepto: "RAP del trabajador pendiente (octubre y noviembre)", base: "Art. 43 Ley del RAP", monto: 721.45 }],
    });
    expect(r.deduccionesDetalle.map((d) => [d.concepto, n(d.monto)])).toEqual([
      ["Anticipos y préstamos", 5000],
      ["RAP del trabajador pendiente (octubre y noviembre)", 721.45],
    ]);
    expect(n(r.deducciones)).toBeCloseTo(5721.45, 2);
    expect(n(r.totalAPagar)).toBeCloseTo(n(r.totalPrestaciones) - 5721.45, 2);
    // Una retención en cero no aparece.
    expect(liquidar({ deduccionesLegales: [{ clave: "RAP_PENDIENTE", concepto: "RAP", base: "", monto: 0 }] }).deduccionesDetalle).toEqual([]);
  });
});

describe("salarioOrdinarioPromedio", () => {
  const f = (s: string) => new Date(`${s}T00:00:00Z`);
  const ultimoDia = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  /** Planillas mensuales de `desde` a `hasta` (meses 1-12 de 2026), con el monto de cada mes. */
  const mensuales = (montos: Record<number, number>) =>
    Object.entries(montos).map(([m, totalBruto]) => ({
      totalBruto, fechaInicio: f(`2026-${m.padStart(2, "0")}-01`), fechaFin: f(`2026-${m.padStart(2, "0")}-${ultimoDia(2026, Number(m))}`),
    }));
  /** Dos quincenas por mes, cada una con la mitad del salario mensual. */
  const quincenales = (mensual: number, meses: number[]) =>
    meses.flatMap((m) => {
      const mm = String(m).padStart(2, "0");
      return [
        { totalBruto: mensual / 2, fechaInicio: f(`2026-${mm}-01`), fechaFin: f(`2026-${mm}-15`) },
        { totalBruto: mensual / 2, fechaInicio: f(`2026-${mm}-16`), fechaFin: f(`2026-${mm}-${ultimoDia(2026, m)}`) },
      ];
    });
  const SALIDA = { fechaSalida: f("2026-10-31") };

  it("promedia por mes: seis mensuales de L15,000 dan L15,000", () => {
    const r = salarioOrdinarioPromedio(mensuales({ 5: 15000, 6: 15000, 7: 15000, 8: 15000, 9: 15000, 10: 15000 }), SALIDA);
    expect(n(r.promedio)).toBeCloseTo(15000, 2);
    expect(r.meses).toBe(6);
  });

  it("REGRESIÓN: en quincenal una quincena es medio mes (L30,000 al mes no sale a L15,000)", () => {
    const r = salarioOrdinarioPromedio(quincenales(30000, [3, 4, 5, 6, 7, 8, 9, 10]), SALIDA);
    expect(n(r.promedio)).toBeCloseTo(30000, 2);
    expect(r.meses).toBe(6);
    expect(r.periodos).toBe(12); // las doce quincenas de mayo a octubre; marzo y abril quedan fuera
  });

  it("un aumento reciente no infla el promedio entero", () => {
    const r = salarioOrdinarioPromedio(mensuales({ 5: 12000, 6: 12000, 7: 12000, 8: 12000, 9: 12000, 10: 30000 }), SALIDA);
    expect(n(r.promedio)).toBeCloseTo(15000, 2);
  });

  it("la planilla del mes de salida cuenta sólo los días trabajados", () => {
    // Sale el 10 de octubre; la quincena del 1 al 15 le pagó 10 días comerciales
    // (`diasConDerechoASalario`): 30,000 × 10/30 = 10,000.
    const lineas = [...quincenales(30000, [4, 5, 6, 7, 8, 9]), { totalBruto: 10000, fechaInicio: f("2026-10-01"), fechaFin: f("2026-10-15") }];
    const r = salarioOrdinarioPromedio(lineas, { fechaSalida: f("2026-10-10") });
    expect(n(r.promedio)).toBeCloseTo(30000, 2);
    expect(r.meses).toBe(6); // 1/3 de octubre + septiembre…mayo + 2/3 de abril
  });

  it("una sola quincena es medio mes aunque el mes tenga 31 o 28 días", () => {
    const una = (inicio: string, fin: string, salida: string) =>
      salarioOrdinarioPromedio([{ totalBruto: 9000, fechaInicio: f(inicio), fechaFin: f(fin) }], { fechaSalida: f(salida) });
    for (const r of [una("2026-08-01", "2026-08-15", "2026-08-15"), una("2026-08-16", "2026-08-31", "2026-08-31"), una("2026-02-16", "2026-02-28", "2026-02-28")]) {
      expect(n(r.promedio)).toBeCloseTo(18000, 2);
      expect(r.meses).toBe(0.5);
    }
  });

  it("quien entró hace menos de seis meses se promedia con el tiempo que trabajó", () => {
    // Entró el 16 de agosto: dos meses y medio de quincenas de L10,000.
    const lineas = quincenales(20000, [9, 10]).concat([{ totalBruto: 10000, fechaInicio: f("2026-08-16"), fechaFin: f("2026-08-31") }]);
    const r = salarioOrdinarioPromedio(lineas, { ...SALIDA, fechaIngreso: f("2026-08-16") });
    expect(n(r.promedio)).toBeCloseTo(20000, 2);
    expect(r.meses).toBe(2.5);
  });

  it("una planilla de comisiones sobre los mismos días suma dinero, no tiempo", () => {
    const comisiones = [{ totalBruto: 6000, fechaInicio: f("2026-10-01"), fechaFin: f("2026-10-31") }];
    const r = salarioOrdinarioPromedio([...quincenales(30000, [5, 6, 7, 8, 9, 10]), ...comisiones], SALIDA);
    expect(n(r.promedio)).toBeCloseTo(31000, 2);
    expect(r.meses).toBe(6);
  });

  it("sin períodos devuelve cero y el llamador cae al salario base", () => {
    expect(n(salarioOrdinarioPromedio([], SALIDA).promedio)).toBe(0);
  });
});
