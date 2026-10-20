import { describe, it, expect } from "vitest";
import {
  calcularIHSS,
  calcularRAP,
  baseCotizableRAP,
  calcularISRMensual,
  calcularDescuentoAusencia,
  calcularPlanilla,
  calcularDiasVacaciones,
  diasVacacionesPorAnio,
  calcularVacacionesDevengadas,
  calcularProvision13vo,
  construirParametros,
  calcularImpuestoVecinal,
  calcularImpuestoVecinalAnual,
  TABLA_VECINAL_SPS,
  calcularMontoHorasExtra,
  salarioHora,
  totalHorasExtra,
  clasificarJornadaExtra,
  horasDiurnasEnIntervalo,
  repartirJornada,
  diasConDerechoASalario,
  RECARGO_EXTRA,
  RECARGO_FERIADO,
  PARAMETROS_DEFAULT,
  RAP_PISO_MENSUAL,
  RAP_TECHO_MENSUAL,
  type EntradaCalculoPlanilla,
} from "@/lib/payroll/calculos-hn";
import { aNumero as n, money, type Money, type MoneyInput } from "@/lib/payroll/money";

const P = PARAMETROS_DEFAULT;

/** Suma exacta usada para expresar el valor esperado de un test. */
const suma = (...vs: MoneyInput[]) => n(vs.reduce<Money>((a, v) => a.plus(money(v)), money(0)));

/** Entrada mensual estándar: 30 días, sin ausencias, sin extras. */
function entrada(over: Partial<EntradaCalculoPlanilla> = {}): EntradaCalculoPlanilla {
  return {
    salarioMensual: 15000,
    tipoPlanilla: "MENSUAL",
    diasPagables: 30,
    diasMes: 30,
    horasExtra: 0,
    bonificaciones: 0,
    otrosIngresos: 0,
    diasAusentes: 0,
    otrosDeducciones: 0,
    afpEmpleado: 0,
    aniosTrabajados: 3,
    ...over,
  };
}

// ─── IHSS ────────────────────────────────────────────────────────────────────

describe("IHSS — monto fijo pactado en la ficha del empleado", () => {
  it("reemplaza la parte del empleado y EM + IVM suman exactamente el monto", () => {
    const r = calcularIHSS(20000, P, 400);
    expect(r.fijo).toBe(true);
    expect(n(r.empleado)).toBe(400);
    expect(suma(r.emEmpleado, r.ivmEmpleado)).toBe(400);
  });

  it("reparte EM/IVM en la misma proporción que el cálculo por porcentaje", () => {
    // Los reportes al IHSS van desglosados: el reparto no puede ser arbitrario.
    const normal = calcularIHSS(20000, P);
    const fijo = calcularIHSS(20000, P, 400);
    const proporcionNormal = n(normal.ivmEmpleado) / n(normal.empleado);
    expect(n(fijo.ivmEmpleado) / 400).toBeCloseTo(proporcionNormal, 2);
  });

  it("NO toca el aporte patronal, que sigue por porcentaje", () => {
    const normal = calcularIHSS(20000, P);
    const fijo = calcularIHSS(20000, P, 400);
    expect(n(fijo.empleador)).toBe(n(normal.empleador));
    expect(n(fijo.ivmEstado)).toBe(n(normal.ivmEstado));
  });

  it("sin monto fijo (null o ausente) calcula por porcentaje, como siempre", () => {
    expect(calcularIHSS(20000, P, null)).toEqual(calcularIHSS(20000, P));
    expect(calcularIHSS(20000, P).fijo).toBe(false);
  });

  it("un monto fijo de cero es válido: la persona no aporta", () => {
    const r = calcularIHSS(20000, P, 0);
    expect(r.fijo).toBe(true);
    expect(n(r.empleado)).toBe(0);
  });

  it("en la planilla es MENSUAL: la quincena descuenta la mitad", () => {
    const r = calcularPlanilla(entrada({ tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15, ihssMontoFijoMensual: 400 }), P);
    expect(n(r.ihssEmpleado)).toBe(200);
    expect(r.ihssFijo).toBe(true);
  });

  it("el ISR resta el IHSS que realmente se descontó, no el calculado", () => {
    // Un IHSS fijo menor que el calculado deja más base gravable: el ISR sube.
    // Si el motor siguiera restando el calculado, retendría de menos.
    const salario = 40000;
    const normal = calcularPlanilla(entrada({ salarioMensual: salario }), P);
    const fijoBajo = calcularPlanilla(entrada({ salarioMensual: salario, ihssMontoFijoMensual: 100 }), P);
    expect(n(fijoBajo.isr)).toBeGreaterThan(n(normal.isr));
    expect(n(fijoBajo.ihssEmpleado)).toBe(100);
  });
});

describe("IHSS — split EM/IVM y techo cotizable", () => {
  it("cotiza sobre el salario cuando está bajo el techo", () => {
    const r = calcularIHSS(10000, P);
    expect(n(r.emEmpleado)).toBeCloseTo(250, 2);    // 2.5%
    expect(n(r.emEmpleador)).toBeCloseTo(500, 2);   // 5%
    expect(n(r.ivmEmpleado)).toBeCloseTo(250, 2);   // 2.5%
    expect(n(r.ivmEmpleador)).toBeCloseTo(350, 2);  // 3.5%
    expect(n(r.ivmEstado)).toBeCloseTo(50, 2);      // 0.5%
  });

  it("topa la base en el techo para salarios altos", () => {
    const r = calcularIHSS(80000, P);
    expect(n(r.empleado)).toBeCloseTo(11903.13 * 0.05, 2);
    expect(n(r.empleador)).toBeCloseTo(11903.13 * 0.085, 2);
  });

  it("el total empleado es EM + IVM y el patronal EM + IVM (sin el aporte estatal)", () => {
    const r = calcularIHSS(9000, P);
    expect(n(r.empleado)).toBeCloseTo(suma(r.emEmpleado, r.ivmEmpleado), 2);
    expect(n(r.empleador)).toBeCloseTo(suma(r.emEmpleador, r.ivmEmpleador), 2);
  });
});

// ─── RAP ─────────────────────────────────────────────────────────────────────

describe("RAP — base = excedente sobre el piso, acotado al techo", () => {
  it("REGRESIÓN: un salario bajo el piso NO cotiza (antes cotizaba sobre el íntegro)", () => {
    expect(n(baseCotizableRAP(10000, P))).toBe(0);
    expect(n(calcularRAP(10000, P).empleado)).toBe(0);
    expect(n(calcularRAP(10000, P).empleador)).toBe(0);
  });

  it("un salario exactamente en el piso no cotiza", () => {
    expect(n(baseCotizableRAP(RAP_PISO_MENSUAL, P))).toBe(0);
  });

  it("cotiza solo el excedente sobre el piso", () => {
    expect(n(baseCotizableRAP(30000, P))).toBeCloseTo(30000 - RAP_PISO_MENSUAL, 2);
    expect(n(calcularRAP(30000, P).empleado)).toBeCloseTo(271.45, 2);
  });

  it("REGRESIÓN: aplica el techo (antes no existía tope alguno)", () => {
    const esperado = (RAP_TECHO_MENSUAL - RAP_PISO_MENSUAL) * 0.015;
    expect(n(calcularRAP(80000, P).empleado)).toBeCloseTo(esperado, 2);
    expect(n(calcularRAP(999999, P).empleado)).toBeCloseTo(esperado, 2);
    // sin techo, un salario de 80,000 habría dado 1,200.00
    expect(n(calcularRAP(80000, P).empleado)).toBeLessThan(80000 * 0.015);
  });

  it("piso y techo son configurables sin tocar código", () => {
    const custom = construirParametros({ rapPiso: 5000, rapTope: 20000 });
    expect(n(baseCotizableRAP(30000, custom))).toBeCloseTo(15000, 2);
  });
});

// ─── ISR ─────────────────────────────────────────────────────────────────────

describe("ISR — tabla anual progresiva", () => {
  /** Convierte una base gravable anual deseada en su salario mensual equivalente. */
  const mensualPara = (gravableAnual: number) => (gravableAnual + P.deduccionMedicaAnual) / 12;

  it("no retiene bajo el mínimo exento", () => {
    expect(n(calcularISRMensual(mensualPara(200000), P))).toBe(0);
  });

  it("aplica 15% sobre el excedente en el segundo tramo", () => {
    const esperado = ((300000 - 228324.32) * 0.15) / 12;
    expect(n(calcularISRMensual(mensualPara(300000), P))).toBeCloseTo(esperado, 2);
  });

  it("aplica cuota fija + 20% en el tercer tramo", () => {
    const esperado = (17974.47 + (500000 - 348154.1) * 0.2) / 12;
    expect(n(calcularISRMensual(mensualPara(500000), P))).toBeCloseTo(esperado, 2);
  });

  it("aplica cuota fija + 25% en el tramo superior", () => {
    const esperado = (110275.8 + (900000 - 809660.75) * 0.25) / 12;
    expect(n(calcularISRMensual(mensualPara(900000), P))).toBeCloseTo(esperado, 2);
  });

  it("descuenta la deducción médica anual de la base", () => {
    const sinDeduccion = construirParametros({ deduccionMedicaAnual: 0 });
    expect(n(calcularISRMensual(mensualPara(300000), sinDeduccion)))
      .toBeGreaterThan(n(calcularISRMensual(mensualPara(300000), P)));
  });

  it("nunca retiene un monto negativo", () => {
    expect(n(calcularISRMensual(0, P))).toBe(0);
    expect(n(calcularISRMensual(-5000, P))).toBe(0);
  });

  it("REGRESIÓN: una base caída en un hueco entre tramos no tributa 0", () => {
    // Tabla deliberadamente discontinua: nada cubre 100,000–200,000.
    // La lógica anterior (>= desde && <= hasta) no encontraba tramo y devolvía 0.
    const gappy = construirParametros({
      deduccionMedicaAnual: 0,
      filasISR: [
        { rangoDesde: 0, rangoHasta: 100000, cuotaFija: 0, porcentaje: 0.1, excedenteDesde: 0 },
        { rangoDesde: 200000, rangoHasta: null, cuotaFija: 20000, porcentaje: 0.2, excedenteDesde: 200000 },
      ],
    });
    const isr = n(calcularISRMensual(150000 / 12, gappy));
    expect(isr).toBeGreaterThan(0);
    expect(isr).toBeCloseTo((150000 * 0.1) / 12, 2);
  });

  it("tolera filas de BD desordenadas", () => {
    const desordenada = construirParametros({
      deduccionMedicaAnual: 0,
      filasISR: [
        { rangoDesde: 200000, rangoHasta: null, cuotaFija: 20000, porcentaje: 0.2, excedenteDesde: 200000 },
        { rangoDesde: 0, rangoHasta: 199999, cuotaFija: 0, porcentaje: 0, excedenteDesde: 0 },
      ],
    });
    expect(n(calcularISRMensual(100000 / 12, desordenada))).toBe(0);
    expect(n(calcularISRMensual(300000 / 12, desordenada))).toBeCloseTo((20000 + 100000 * 0.2) / 12, 2);
  });
});

// ─── BASE IMPONIBLE DEL ISR ──────────────────────────────────────────────────

describe("ISR — base imponible (Arts. 10 y 11 Ley del ISR)", () => {
  const S = 40000; // salario con ISR > 0, para que el efecto sea observable

  it("REGRESIÓN: las bonificaciones tributan (antes quedaban exentas de hecho)", () => {
    const sin = calcularPlanilla(entrada({ salarioMensual: S, bonificaciones: 0 }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: S, bonificaciones: 5000 }), P);
    expect(n(con.isr)).toBeGreaterThan(n(sin.isr));
  });

  it("REGRESIÓN: las horas extra tributan", () => {
    const sin = calcularPlanilla(entrada({ salarioMensual: S, horasExtra: 0 }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: S, horasExtra: 20 }), P);
    expect(n(con.isr)).toBeGreaterThan(n(sin.isr));
  });

  it("REGRESIÓN: otros ingresos gravables entran en la base", () => {
    const sin = calcularPlanilla(entrada({ salarioMensual: S, otrosIngresos: 0 }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: S, otrosIngresos: 4000 }), P);
    expect(n(con.isr)).toBeGreaterThan(n(sin.isr));
  });

  it("IHSS, RAP y AFP siguen cotizando sólo sobre el salario ordinario", () => {
    const sin = calcularPlanilla(entrada({ salarioMensual: S }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: S, bonificaciones: 5000, horasExtra: 10 }), P);
    expect(n(con.ihssEmpleado)).toBeCloseTo(n(sin.ihssEmpleado), 2);
    expect(n(con.rapEmpleado)).toBeCloseTo(n(sin.rapEmpleado), 2);
  });

  it("un mismo ingreso mensual tributa igual repartido en quincenas", () => {
    const mensual = calcularPlanilla(entrada({ salarioMensual: S, bonificaciones: 2000 }), P);
    const quincenal = calcularPlanilla(
      entrada({ salarioMensual: S, tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15, bonificaciones: 1000 }), P);
    expect(n(quincenal.isr) * 2).toBeCloseTo(n(mensual.isr), 1);
  });

  it("sin ingresos extraordinarios el ISR no cambia", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: S }), P);
    expect(n(r.isr)).toBeGreaterThan(0);
  });
});

// ─── FACTOR DE PLANILLA ──────────────────────────────────────────────────────

describe("Factor de conversión mensual → período de pago", () => {
  const S = 15000;
  const semanal = () => calcularPlanilla(
    entrada({ salarioMensual: S, tipoPlanilla: "SEMANAL", diasMes: 7, diasPagables: 7 }), P);

  it("REGRESIÓN: 52 pagos semanales suman el salario anual completo (12/52, no 7/30.4)", () => {
    // Con el factor 7/30.4 anterior el año sumaba 11.97 meses: ~L 395 de defecto
    // anual por empleado sobre este salario.
    expect(n(semanal().salarioBase) * 52).toBeCloseTo(S * 12, 0);
  });

  it("las deducciones legales semanales también suman 12 meses al año", () => {
    const mensual = calcularPlanilla(entrada({ salarioMensual: S }), P);
    expect(n(semanal().ihssEmpleado) * 52).toBeCloseTo(n(mensual.ihssEmpleado) * 12, 0);
  });

  it("24 pagos quincenales suman el salario anual completo", () => {
    const q = calcularPlanilla(
      entrada({ salarioMensual: S, tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15 }), P);
    expect(n(q.salarioBase) * 24).toBeCloseTo(S * 12, 2);
  });
});

// ─── AUSENCIAS ───────────────────────────────────────────────────────────────

describe("Ausencias — descuento único, sin duplicar contra el salario base", () => {
  const S = 15000;
  const diario = S / 30;

  it("REGRESIÓN: el salario base NO se reduce por ausencias", () => {
    const sin = calcularPlanilla(entrada({ salarioMensual: S, diasAusentes: 0 }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: S, diasAusentes: 3 }), P);
    expect(n(con.salarioBase)).toBeCloseTo(n(sin.salarioBase), 2);
  });

  it("REGRESIÓN: el impacto neto es exactamente el factor, no el triple", () => {
    const sin = calcularPlanilla(entrada({ salarioMensual: S, diasAusentes: 0 }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: S, diasAusentes: 1 }), P);
    const impacto = n(sin.salarioNeto.minus(con.salarioNeto));
    expect(impacto).toBeCloseTo(diario * 2, 2);
    // el bug original descontaba ~3 días por 1 falta
    expect(impacto).toBeLessThan(diario * 3);
  });

  it("REGRESIÓN: un día de ausencia vale igual en quincenal que en mensual", () => {
    const mensual = calcularPlanilla(entrada({ salarioMensual: S, diasAusentes: 1 }), P);
    const quincenal = calcularPlanilla(
      entrada({ salarioMensual: S, tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15, diasAusentes: 1 }), P);
    expect(n(quincenal.ausencias)).toBeCloseTo(n(mensual.ausencias), 2);
    expect(n(quincenal.ausencias)).toBeCloseTo(diario * 2, 2);
  });

  it("el factor de descuento es configurable", () => {
    expect(n(calcularDescuentoAusencia(S, 1, 1))).toBeCloseTo(diario, 2);
    expect(n(calcularDescuentoAusencia(S, 1, 2))).toBeCloseTo(diario * 2, 2);
    const p1 = construirParametros({ factorDescuentoAusencia: 1 });
    expect(n(calcularPlanilla(entrada({ salarioMensual: S, diasAusentes: 1 }), p1).ausencias))
      .toBeCloseTo(diario, 2);
  });

  it("escala linealmente con los días ausentes", () => {
    expect(n(calcularDescuentoAusencia(S, 4, 2))).toBeCloseTo(n(calcularDescuentoAusencia(S, 2, 2)) * 2, 2);
  });

  it("sin ausencias no genera descuento", () => {
    expect(n(calcularPlanilla(entrada({ diasAusentes: 0 }), P).ausencias)).toBe(0);
  });
});

// ─── PRORRATEO POR CONTRATACIÓN PARCIAL ──────────────────────────────────────

describe("diasPagables — prorrateo por ingreso o baja a mitad de período", () => {
  it("un empleado con medio mes de derecho cobra medio salario base", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 15000, diasPagables: 15 }), P);
    expect(n(r.salarioBase)).toBeCloseTo(7500, 2);
  });

  it("el prorrateo por contratación y el descuento por ausencia son independientes", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 15000, diasPagables: 15, diasAusentes: 1 }), P);
    expect(n(r.salarioBase)).toBeCloseTo(7500, 2);
    expect(n(r.ausencias)).toBeCloseTo((15000 / 30) * 2, 2);
  });
});

// ─── VACACIONES (Art. 346 CT) ────────────────────────────────────────────────

describe("Vacaciones — Art. 346 Código de Trabajo", () => {
  it("otorga los días según años de servicio", () => {
    expect(calcularDiasVacaciones(0)).toBe(0);
    expect(calcularDiasVacaciones(1)).toBe(10);
    expect(calcularDiasVacaciones(2)).toBe(12);
    expect(calcularDiasVacaciones(3)).toBe(15);
    expect(calcularDiasVacaciones(4)).toBe(20);
    expect(calcularDiasVacaciones(10)).toBe(20);
  });

  it("el derecho por año completado sigue la misma escala", () => {
    expect(diasVacacionesPorAnio(1)).toBe(10);
    expect(diasVacacionesPorAnio(4)).toBe(20);
    expect(diasVacacionesPorAnio(0)).toBe(0);
  });

  it("acumula el devengado de años completos más la fracción en curso", () => {
    const ingreso = new Date("2023-01-01");
    // a los 2 años exactos: 10 + 12 = 22 días
    expect(calcularVacacionesDevengadas(ingreso, new Date("2025-01-01"))).toBeCloseTo(22, 0);
  });

  it("no devenga nada antes del primer año", () => {
    expect(calcularVacacionesDevengadas(new Date("2025-01-01"), new Date("2025-06-01"))).toBeLessThan(10);
  });
});

// ─── PROVISIONES ─────────────────────────────────────────────────────────────

describe("Provisiones 13vo / 14vo / vacaciones", () => {
  it("el 13vo de un mes completo es un doceavo del salario", () => {
    expect(n(calcularProvision13vo(12000, 30, 30))).toBeCloseTo(1000, 2);
  });

  it("13vo y 14vo se provisionan por igual", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 12000 }), P);
    expect(n(r.provision13vo)).toBeCloseTo(1000, 2);
    expect(n(r.provision14vo)).toBeCloseTo(n(r.provision13vo), 2);
  });

  it("las provisiones devengan sobre los días con derecho a salario", () => {
    const completo = calcularPlanilla(entrada({ salarioMensual: 12000, diasPagables: 30 }), P);
    const medio = calcularPlanilla(entrada({ salarioMensual: 12000, diasPagables: 15 }), P);
    expect(n(medio.provision13vo)).toBeCloseTo(n(completo.provision13vo) / 2, 2);
  });

  it("la provisión de vacaciones crece con la antigüedad", () => {
    const junior = calcularPlanilla(entrada({ aniosTrabajados: 1 }), P);
    const senior = calcularPlanilla(entrada({ aniosTrabajados: 5 }), P);
    expect(n(senior.provisionVacaciones)).toBeGreaterThan(n(junior.provisionVacaciones));
  });
});

// ─── INTEGRACIÓN ─────────────────────────────────────────────────────────────

describe("calcularPlanilla — integración y cuadre", () => {
  it("el neto siempre cuadra con bruto menos deducciones", () => {
    const casos = [
      entrada({ salarioMensual: 9000 }),
      entrada({ salarioMensual: 45000, diasAusentes: 2, horasExtra: 5, bonificaciones: 1000 }),
      entrada({ salarioMensual: 120000, afpEmpleado: 3600, otrosDeducciones: 2500 }),
      entrada({ salarioMensual: 15000, tipoPlanilla: "QUINCENAL", diasMes: 15, diasPagables: 15 }),
      entrada({ salarioMensual: 15000, tipoPlanilla: "SEMANAL", diasMes: 7, diasPagables: 7 }),
    ];
    for (const c of casos) {
      const r = calcularPlanilla(c, P);
      expect(n(r.salarioNeto)).toBeCloseTo(n(r.totalBruto.minus(r.totalDeducciones)), 2);
    }
  });

  it("el total de deducciones es la suma de sus componentes", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 45000, diasAusentes: 1, otrosDeducciones: 500 }), P);
    const esperado = suma(r.ihssEmpleado, r.rapEmpleado, r.afpEmpleado, r.isr,
      r.impuestoVecinal, r.ausencias, r.otrosDeducciones);
    expect(n(r.totalDeducciones)).toBeCloseTo(esperado, 2);
  });

  it("un salario bajo el piso RAP y bajo el techo ISR solo paga IHSS y vecinal", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 10000 }), P);
    expect(n(r.rapEmpleado)).toBe(0);
    expect(n(r.isr)).toBe(0);
    expect(n(r.ihssEmpleado)).toBeGreaterThan(0);
  });

  it("el ISR se calcula sobre la base neta de IHSS, RAP y AFP", () => {
    const conAfp = calcularPlanilla(entrada({ salarioMensual: 60000, afpEmpleado: 3000 }), P);
    const sinAfp = calcularPlanilla(entrada({ salarioMensual: 60000, afpEmpleado: 0 }), P);
    expect(n(conAfp.isr)).toBeLessThan(n(sinAfp.isr));
  });

  it("ningún componente resulta negativo", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 9000, diasAusentes: 1 }), P);
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "boolean") continue; // `ihssFijo` es una marca, no un importe
      expect(n(v as Money), `${k} no debe ser negativo`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── PARAMETRIZACIÓN ─────────────────────────────────────────────────────────

describe("construirParametros — configuración sin tocar código", () => {
  it("cae a los defaults 2026 cuando la BD no aporta valores", () => {
    const p = construirParametros({});
    expect(p).toEqual(PARAMETROS_DEFAULT);
  });

  it("ignora null y undefined manteniendo el default", () => {
    const p = construirParametros({ ihssTope: null, rapPiso: null, factorDescuentoAusencia: null });
    expect(p.ihssTope).toBe(PARAMETROS_DEFAULT.ihssTope);
    expect(p.rapPiso).toBe(PARAMETROS_DEFAULT.rapPiso);
    expect(p.factorDescuentoAusencia).toBe(PARAMETROS_DEFAULT.factorDescuentoAusencia);
  });

  it("un cambio de techo IHSS por decreto se refleja sin recompilar", () => {
    const p = construirParametros({ ihssTope: 15000, ivmTope: 15000 });
    expect(n(calcularIHSS(80000, p).empleado)).toBeCloseTo(15000 * 0.05, 2);
  });

  it("una tabla ISR vacía no rompe el cálculo", () => {
    const p = construirParametros({ filasISR: [] });
    expect(() => calcularISRMensual(50000, p)).not.toThrow();
  });

  it("la jornada ordinaria es parametrizable y cambia el valor de la hora extra", () => {
    const p = construirParametros({ jornadaHoras: 6 });
    expect(p.jornadaHoras).toBe(6);
    // Con jornada de 6 h la hora vale más: 24000/30/6 = 133.33
    expect(n(salarioHora(24000, p.jornadaHoras))).toBeCloseTo(133.33, 2);
  });
});

// ─── IMPUESTO VECINAL — San Pedro Sula, Cortés ───────────────────────────────

describe("impuesto vecinal — tabla progresiva de San Pedro Sula", () => {
  it("la tabla cubre el rango sin huecos ni solapes", () => {
    for (let i = 1; i < TABLA_VECINAL_SPS.length; i++) {
      expect(TABLA_VECINAL_SPS[i].desde).toBe(TABLA_VECINAL_SPS[i - 1].hasta);
    }
    expect(TABLA_VECINAL_SPS[0].desde).toBe(0);
    expect(TABLA_VECINAL_SPS[TABLA_VECINAL_SPS.length - 1].hasta).toBeNull();
  });

  it("las tarifas por millar son las del Plan de Arbitrios", () => {
    expect(TABLA_VECINAL_SPS.map((t) => t.porMillar))
      .toEqual([1.5, 2.0, 2.5, 3.0, 3.5, 3.75, 4.0, 5.0, 5.25]);
  });

  it("un ingreso dentro del primer tramo paga su tarifa", () => {
    // 4,000 × 1.50 ÷ 1000 = 6.00
    expect(n(calcularImpuestoVecinalAnual(4000))).toBeCloseTo(6, 2);
  });

  it("SUMA por tramos: cada porción tributa a la tarifa de SU tramo", () => {
    // 8,000 = 5,000 al 1.50 (7.50) + 3,000 al 2.00 (6.00) = 13.50
    // Una tarifa única del 2.00 sobre el total daría 16.00 — que es el error
    // que suele cometerse al simplificar la tabla.
    expect(n(calcularImpuestoVecinalAnual(8000))).toBeCloseTo(13.5, 2);
    expect(n(calcularImpuestoVecinalAnual(8000))).not.toBeCloseTo(16, 2);
  });

  it("un ingreso de L 100,000 atraviesa siete tramos", () => {
    //  5,000 × 1.50 =   7.50
    //  5,000 × 2.00 =  10.00
    // 10,000 × 2.50 =  25.00
    // 10,000 × 3.00 =  30.00
    // 20,000 × 3.50 =  70.00
    // 25,000 × 3.75 =  93.75
    // 25,000 × 4.00 = 100.00  →  336.25
    expect(n(calcularImpuestoVecinalAnual(100000))).toBeCloseTo(336.25, 2);
  });

  it("el último tramo no tiene techo", () => {
    const base = n(calcularImpuestoVecinalAnual(150000));
    // 50,000 por encima de 150,000 al 5.25 = 262.50 adicionales
    expect(n(calcularImpuestoVecinalAnual(200000))).toBeCloseTo(base + 262.5, 2);
  });

  it("es monótono: más ingreso nunca paga menos", () => {
    let anterior = 0;
    for (const ingreso of [0, 5000, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 500000]) {
      const actual = n(calcularImpuestoVecinalAnual(ingreso));
      expect(actual).toBeGreaterThanOrEqual(anterior);
      anterior = actual;
    }
  });

  it("un ingreso nulo o negativo no paga", () => {
    expect(n(calcularImpuestoVecinalAnual(0))).toBe(0);
    expect(n(calcularImpuestoVecinalAnual(-5000))).toBe(0);
  });

  it("la retención mensual es el impuesto anual entre doce", () => {
    // Base mensual 10,000 → anual 120,000
    const anual = n(calcularImpuestoVecinalAnual(120000));
    expect(n(calcularImpuestoVecinal(10000))).toBeCloseTo(anual / 12, 2);
  });

  it("REGRESIÓN: la aproximación anterior sub-retenía el impuesto", () => {
    // La versión anterior hacía `salarioMensual / 1000` truncado —L 1.00 por
    // millar MENSUAL— cuando la tabla es por millar del ingreso ANUAL. Para
    // L 50,000 mensuales daba L 50.00 al mes; la tabla de SPS da L 245.73.
    // El defecto retenía de menos, que es la dirección que genera contingencia
    // frente a la municipalidad.
    expect(n(calcularImpuestoVecinal(50000))).toBeCloseTo(245.73, 2);
    expect(n(calcularImpuestoVecinal(50000))).toBeGreaterThan(50);
  });

  it("valores de referencia de la tabla de San Pedro Sula", () => {
    // Retención mensual para varios niveles de ingreso, calculada a mano desde
    // el Anexo No. 1. Fija la tabla completa contra cambios accidentales.
    expect(n(calcularImpuestoVecinal(10000))).toBeCloseTo(36.35, 2);
    expect(n(calcularImpuestoVecinal(20000))).toBeCloseTo(88.23, 2);
    expect(n(calcularImpuestoVecinal(30000))).toBeCloseTo(140.73, 2);
    expect(n(calcularImpuestoVecinal(100000))).toBeCloseTo(508.23, 2);
  });

  it("una tabla vacía no rompe el cálculo", () => {
    expect(n(calcularImpuestoVecinalAnual(100000, []))).toBe(0);
  });

  it("la tabla es sustituible por la de otro municipio", () => {
    const otroMunicipio = [{ desde: 0, hasta: null, porMillar: 10 }];
    // Tarifa plana de 10 por millar sobre 50,000 = 500.00
    expect(n(calcularImpuestoVecinalAnual(50000, otroMunicipio))).toBeCloseTo(500, 2);
  });

  it("se carga desde filas de base de datos", () => {
    const p = construirParametros({
      filasVecinal: [
        { rangoDesde: 0, rangoHasta: 10000, porMillar: 1 },
        { rangoDesde: 10000, rangoHasta: null, porMillar: 2 },
      ],
    });
    expect(p.tablaVecinalAnual).toHaveLength(2);
    // 10,000 × 1 + 10,000 × 2 = 10 + 20 = 30
    expect(n(calcularImpuestoVecinalAnual(20000, p.tablaVecinalAnual))).toBeCloseTo(30, 2);
  });

  it("sin filas en BD cae a la tabla de San Pedro Sula", () => {
    expect(construirParametros({ filasVecinal: [] }).tablaVecinalAnual).toEqual(TABLA_VECINAL_SPS);
  });

  it("la base es el ingreso TOTAL sin deducciones, no sólo el salario", () => {
    // Art. 77: grava los ingresos totales. Las bonificaciones deben subirlo.
    const sin = calcularPlanilla(entrada({ salarioMensual: 30000 }), P);
    const con = calcularPlanilla(entrada({ salarioMensual: 30000, bonificaciones: 10000 }), P);
    expect(n(con.impuestoVecinal)).toBeGreaterThan(n(sin.impuestoVecinal));
  });
});

// ─── HORAS EXTRA — Art. 330 del Código del Trabajo ───────────────────────────

describe("horas extra — recargos legales por jornada", () => {
  // Salario 24,000 → hora ordinaria = 24000 / 30 / 8 = 100.00 exactos.
  const S = 24000;

  it("la hora ordinaria sale del mes de 30 días y la jornada configurada", () => {
    expect(n(salarioHora(S))).toBeCloseTo(100, 2);
    expect(n(salarioHora(S, 12))).toBeCloseTo(66.67, 2);
  });

  it("los recargos son los del Art. 330: 25 %, 50 % y 75 %", () => {
    expect(RECARGO_EXTRA.DIURNA).toBe(0.25);
    expect(RECARGO_EXTRA.MIXTA).toBe(0.5);
    expect(RECARGO_EXTRA.NOCTURNA).toBe(0.75);
  });

  it("el trabajo en feriado se paga al doble (Art. 339)", () => {
    expect(RECARGO_FERIADO).toBe(1);
    expect(n(calcularMontoHorasExtra(S, { feriado: 8 }))).toBeCloseTo(8 * 100 * 2, 2);
  });

  it("REGRESIÓN: la hora diurna se paga a 125 %, no a 150 %", () => {
    // El multiplicador anterior (1.5) duplicaba el recargo legal de la jornada
    // diurna, que es la mayoritaria en cualquier planilla.
    expect(n(calcularMontoHorasExtra(S, { diurnas: 10 }))).toBeCloseTo(1250, 2);
    expect(n(calcularMontoHorasExtra(S, { diurnas: 10 }))).not.toBeCloseTo(1500, 2);
  });

  it("cada jornada aplica su propio recargo", () => {
    expect(n(calcularMontoHorasExtra(S, { mixtas: 10 }))).toBeCloseTo(1500, 2);
    expect(n(calcularMontoHorasExtra(S, { nocturnas: 10 }))).toBeCloseTo(1750, 2);
  });

  it("un número suelto se interpreta como jornada diurna", () => {
    expect(n(calcularMontoHorasExtra(S, 10)))
      .toBeCloseTo(n(calcularMontoHorasExtra(S, { diurnas: 10 })), 2);
  });

  it("suma los tramos de un mismo período", () => {
    const m = calcularMontoHorasExtra(S, { diurnas: 4, mixtas: 2, nocturnas: 1, feriado: 8 });
    expect(n(m)).toBeCloseTo(4 * 125 + 2 * 150 + 1 * 175 + 8 * 200, 2);
  });

  it("sin horas no hay importe", () => {
    expect(n(calcularMontoHorasExtra(S, {}))).toBe(0);
    expect(n(calcularMontoHorasExtra(S, 0))).toBe(0);
  });

  it("totalHorasExtra agrega el desglose para la boleta", () => {
    expect(totalHorasExtra({ diurnas: 4, mixtas: 2, nocturnas: 1, feriado: 3 })).toBe(10);
    expect(totalHorasExtra(7)).toBe(7);
  });
});

describe("clasificación de jornada — Arts. 322-325", () => {
  it("la franja diurna va de 05:00 a 19:00", () => {
    expect(horasDiurnasEnIntervalo(8, 12)).toBeCloseTo(4, 6);  // dentro
    expect(horasDiurnasEnIntervalo(20, 23)).toBeCloseTo(0, 6); // fuera
    expect(horasDiurnasEnIntervalo(17, 21)).toBeCloseTo(2, 6); // a caballo
  });

  it("un turno que cruza la medianoche se mide sobre la franja del día siguiente", () => {
    // 22:00 → 07:00 = [22, 31]: nocturno hasta las 05:00, diurno de 05:00 a 07:00.
    expect(horasDiurnasEnIntervalo(22, 31)).toBeCloseTo(2, 6);
  });

  it("clasifica DIURNA, NOCTURNA y MIXTA según dónde caen las horas", () => {
    expect(clasificarJornadaExtra(16, 18).tipo).toBe("DIURNA");
    expect(clasificarJornadaExtra(20, 23).tipo).toBe("NOCTURNA");
    expect(clasificarJornadaExtra(18, 21).tipo).toBe("MIXTA");
  });

  it("no clasifica como MIXTA un bloque que sólo roza el límite", () => {
    // Medio segundo de desborde por redondeo del reloj no cambia la jornada.
    expect(clasificarJornadaExtra(17, 19 + 1 / 7200).tipo).toBe("DIURNA");
  });
});

describe("repartirJornada — de las marcas del reloj al desglose", () => {
  const dia = (h: number, m = 0) => new Date(2026, 7, 12, h, m, 0);

  it("ocho horas o menos no generan hora extra", () => {
    const r = repartirJornada({ horaEntrada: dia(8), horaSalida: dia(16) });
    expect(r.horasNormales).toBe(8);
    expect(r.totalExtra).toBe(0);
    expect(r.extra).toEqual({});
  });

  it("el excedente de la jornada se clasifica por la franja en que cae", () => {
    // 08:00 → 18:00: dos horas extra entre 16:00 y 18:00, franja diurna.
    const r = repartirJornada({ horaEntrada: dia(8), horaSalida: dia(18) });
    expect(r.horasNormales).toBe(8);
    expect(r.extra).toEqual({ diurnas: 2 });
  });

  it("el excedente que entra en la noche se clasifica MIXTA o NOCTURNA", () => {
    // 12:00 → 22:00: extras de 20:00 a 22:00 → íntegramente nocturnas.
    expect(repartirJornada({ horaEntrada: dia(12), horaSalida: dia(22) }).extra)
      .toEqual({ nocturnas: 2 });
    // 10:00 → 21:00: extras de 18:00 a 21:00 → cruzan las 19:00 → mixtas.
    expect(repartirJornada({ horaEntrada: dia(10), horaSalida: dia(21) }).extra)
      .toEqual({ mixtas: 3 });
  });

  it("el almuerzo se descuenta del lapso: 08:00 a 17:00 son 8 horas, no 9", () => {
    // El horario por defecto del sistema. Sin descuento generaba 1 h extra diaria.
    const r = repartirJornada({ horaEntrada: dia(8), horaSalida: dia(17), minutosDescanso: 60 });
    expect(r.horasNormales).toBe(8);
    expect(r.totalExtra).toBe(0);
  });

  it("con almuerzo, la hora extra empieza DESPUÉS de completar la jornada", () => {
    // 10:00 → 21:00 con 1 h de almuerzo = 10 h efectivas, 2 extra. La jornada
    // se completa a las 19:00 (10 + 8 + 1), así que la extra va de 19:00 a
    // 21:00: nocturna. Sin correr el inicio, empezaría a las 18:00 y cruzaría
    // las 19:00 como mixta — con otro recargo.
    const r = repartirJornada({ horaEntrada: dia(10), horaSalida: dia(21), minutosDescanso: 60 });
    expect(r.horasNormales).toBe(8);
    expect(r.extra).toEqual({ nocturnas: 2 });
  });

  it("en feriado el almuerzo tampoco se paga", () => {
    const r = repartirJornada({
      horaEntrada: dia(8), horaSalida: dia(17), esFeriado: true, minutosDescanso: 60,
    });
    expect(r.extra).toEqual({ feriado: 8 });
  });

  it("en feriado o descanso TODA la jornada lleva recargo, no sólo el exceso", () => {
    const r = repartirJornada({ horaEntrada: dia(8), horaSalida: dia(16), esFeriado: true });
    expect(r.horasNormales).toBe(0);
    expect(r.extra).toEqual({ feriado: 8 });
  });

  it("una salida anterior a la entrada no produce horas negativas", () => {
    const r = repartirJornada({ horaEntrada: dia(16), horaSalida: dia(8) });
    expect(r.horasNormales).toBe(0);
    expect(r.totalExtra).toBe(0);
  });

  it("respeta una jornada ordinaria distinta de 8 horas", () => {
    expect(repartirJornada({ horaEntrada: dia(8), horaSalida: dia(18), jornadaHoras: 10 }).totalExtra).toBe(0);
  });
});

// ─── DÍAS CON DERECHO A SALARIO ──────────────────────────────────────────────

describe("diasConDerechoASalario — ingreso y baja a mitad de período", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const mes = { desde: d("2026-08-01"), hasta: d("2026-08-31"), diasMes: 30 };

  it("un empleado presente todo el período cobra el período completo", () => {
    expect(diasConDerechoASalario({ fechaIngreso: d("2020-01-01"), fechaSalida: null, ...mes })).toBe(30);
  });

  it("REGRESIÓN: quien ingresa a mitad de mes NO cobra el mes entero", () => {
    // Ingreso el 20 de agosto: 12 días de relación laboral (del 20 al 31).
    const dias = diasConDerechoASalario({ fechaIngreso: d("2026-08-20"), fechaSalida: null, ...mes });
    expect(dias).toBeLessThan(30);
    expect(dias).toBe(12); // 12/31 del período, prorrateado sobre la convención de 30
  });

  it("quien causa baja a mitad de mes cobra sólo hasta su último día", () => {
    expect(diasConDerechoASalario({
      fechaIngreso: d("2020-01-01"), fechaSalida: d("2026-08-10"), ...mes,
    })).toBe(10);
  });

  it("el día de ingreso y el de salida cuentan como trabajados", () => {
    expect(diasConDerechoASalario({
      fechaIngreso: d("2026-08-01"), fechaSalida: d("2026-08-01"), ...mes,
    })).toBe(1);
  });

  it("una baja anterior al período no da derecho a nada", () => {
    expect(diasConDerechoASalario({
      fechaIngreso: d("2020-01-01"), fechaSalida: d("2026-07-15"), ...mes,
    })).toBe(0);
  });

  it("un ingreso posterior al período no da derecho a nada", () => {
    expect(diasConDerechoASalario({
      fechaIngreso: d("2026-09-05"), fechaSalida: null, ...mes,
    })).toBe(0);
  });

  it("funciona igual en planilla quincenal y semanal", () => {
    const quincena = { desde: d("2026-08-01"), hasta: d("2026-08-15"), diasMes: 15 };
    expect(diasConDerechoASalario({ fechaIngreso: d("2026-08-08"), fechaSalida: null, ...quincena })).toBe(8);

    const semana = { desde: d("2026-08-03"), hasta: d("2026-08-09"), diasMes: 7 };
    expect(diasConDerechoASalario({ fechaIngreso: d("2026-08-06"), fechaSalida: null, ...semana })).toBe(4);
  });

  it("menos días pagables producen menos salario base", () => {
    const completo = calcularPlanilla(entrada({ salarioMensual: 30000, diasPagables: 30 }), P);
    const medio = calcularPlanilla(entrada({ salarioMensual: 30000, diasPagables: 15 }), P);
    expect(n(medio.salarioBase)).toBeCloseTo(n(completo.salarioBase) / 2, 2);
  });
});

// ─── AFP INDIVIDUAL ──────────────────────────────────────────────────────────

describe("AFP — deducción individual, no porcentaje global", () => {
  it("el importe se descuenta tal cual, sin prorratear", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 40000, afpEmpleado: 1200 }), P);
    expect(n(r.afpEmpleado)).toBeCloseTo(1200, 2);
  });

  it("reduce la base del ISR", () => {
    const con = calcularPlanilla(entrada({ salarioMensual: 60000, afpEmpleado: 3000 }), P);
    const sin = calcularPlanilla(entrada({ salarioMensual: 60000, afpEmpleado: 0 }), P);
    expect(n(con.isr)).toBeLessThan(n(sin.isr));
  });

  it("en quincenal, la cuota del período se anualiza igual que la mensual", () => {
    const mensual = calcularPlanilla(entrada({ salarioMensual: 60000, afpEmpleado: 3000 }), P);
    const quincenal = calcularPlanilla(
      entrada({
        salarioMensual: 60000, tipoPlanilla: "QUINCENAL",
        diasMes: 15, diasPagables: 15, afpEmpleado: 1500,
      }), P);
    expect(n(quincenal.isr) * 2).toBeCloseTo(n(mensual.isr), 1);
  });

  it("entra en el total de deducciones", () => {
    const r = calcularPlanilla(entrada({ salarioMensual: 40000, afpEmpleado: 1200 }), P);
    const esperado = suma(r.ihssEmpleado, r.rapEmpleado, r.afpEmpleado, r.isr,
      r.impuestoVecinal, r.ausencias, r.otrosDeducciones);
    expect(n(r.totalDeducciones)).toBeCloseTo(esperado, 2);
  });
});
