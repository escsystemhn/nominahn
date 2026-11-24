/**
 * Auditoría de QA de noviembre de 2026: cálculos legales verificados y los 15 fallos
 * hallados, ya corregidos. Cada prueba dice cuál era el fallo (número del reporte) y
 * fija el comportamiento correcto: si alguna se rompe, el fallo volvió.
 *
 * Reporte: «Auditoría QA de nómina — noviembre 2026» (2026-11-10). El fallo 1 (techo
 * de EM del IHSS en 10,000) es de configuración de la base real, no de código.
 */
import { describe, it, expect } from "vitest";
import {
  calcularDescuentoAusencia, calcularMontoHorasExtra, calcularPlanilla, diasConDerechoASalario, PARAMETROS_DEFAULT,
  repartirJornada, semanasDistintas, type EntradaCalculoPlanilla,
} from "@/lib/payroll/calculos-hn";
import { aplicarFiscalidadDecimo, calcularDecimo } from "@/lib/payroll/decimos";
import { descuentoIncapacidades, REGLAS_POR_OMISION, subsidioEstimado } from "@/lib/asistencia/incapacidades";
import { calcularLiquidacion, CONCEPTO_FONDO_RESERVA, maximoVacacionesAcumulables } from "@/lib/payroll/liquidacion";
import { aplicarDeducciones, topesDelPeriodo, type DeduccionVigente } from "@/lib/payroll/deducciones";
import { excesosDeJornada } from "@/lib/payroll/revision-planilla";
import { calcularAniosTrabajados } from "@/lib/utils";

const P = PARAMETROS_DEFAULT;
const fecha = (s: string) => new Date(`${s}T00:00:00Z`);
/** Hora local de un día cualquiera: `repartirJornada` lee la hora con getHours(). */
const hora = (h: number) => new Date(2026, 9, 5, h, 0);
const mes = (o: Partial<EntradaCalculoPlanilla> & { salarioMensual: number }): EntradaCalculoPlanilla => ({
  tipoPlanilla: "MENSUAL", diasPagables: 30, diasMes: 30, horasExtra: 0, bonificaciones: 0, otrosIngresos: 0,
  diasAusentes: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 2, ...o,
});
const n = (x: { toString(): string }) => Number(x.toString());

describe("deducciones legales de un mes completo (verificadas)", () => {
  it("IHSS: EM 2.5 % + IVM 2.5 % del trabajador, topado en 11,903.13", () => {
    expect(n(calcularPlanilla(mes({ salarioMensual: 25000 }), P).ihssEmpleado)).toBeCloseTo(595.16, 2);
    expect(n(calcularPlanilla(mes({ salarioMensual: 60000 }), P).ihssEmpleado)).toBeCloseTo(595.16, 2);
  });
  it("RAP: 1.5 % sobre el excedente de 11,903.13, sin techo superior", () => {
    expect(n(calcularPlanilla(mes({ salarioMensual: 11000 }), P).rapEmpleado)).toBe(0);
    expect(n(calcularPlanilla(mes({ salarioMensual: 25000 }), P).rapEmpleado)).toBeCloseTo(196.45, 2);
    expect(n(calcularPlanilla(mes({ salarioMensual: 60000 }), P).rapEmpleado)).toBeCloseTo(721.45, 2);
  });
  it("ISR 2026: tabla del SAR sobre la renta neta menos L 40,000 de gastos médicos", () => {
    expect(n(calcularPlanilla(mes({ salarioMensual: 18000 }), P).isr)).toBe(0);
    expect(n(calcularPlanilla(mes({ salarioMensual: 40000 }), P).isr)).toBeCloseTo(2825.32, 2);
  });
  it("INFOP 1 % y Fondo de Reserva Laboral 4 % son patronales, no se descuentan al trabajador", () => {
    const r = calcularPlanilla(mes({ salarioMensual: 60000 }), P);
    expect(n(r.infop)).toBeCloseTo(600, 2);
    expect(n(r.reservaLaboral)).toBeCloseTo(2315.85, 2);
    expect(n(r.totalBruto) - n(r.salarioNeto)).toBeCloseTo(n(r.ihssEmpleado) + n(r.rapEmpleado) + n(r.isr) + n(r.impuestoVecinal), 2);
  });
});

describe("fallo 2: el neto nunca es negativo; los topes de los Arts. 371 y 372 sólo avisan", () => {
  const prestamo = (monto: number, o: Partial<DeduccionVigente> = {}): DeduccionVigente =>
    ({ id: "p", monto, saldo: monto, cuotasMeses: 1, cuotasPagadas: 0, tipo: "PRESTAMO", ...o });

  it("un préstamo se cobra completo aunque pase la cuarta parte; el tope queda para el aviso (decisión del cliente, 2026-11-21)", () => {
    // Neto de ley de 20,000: excedente 8,096.87 → cuarta parte 2,024.22. Se cobran los 15,000.
    const r = aplicarDeducciones([prestamo(15000)], topesDelPeriodo(20000, 11903.13));
    expect(n(r.prestamos)).toBeCloseTo(15000, 2);
    expect(r.amortizaciones[0].desactivar).toBe(true);
    expect(r.recortadas).toHaveLength(0);
    expect(n(r.cobradas[0].tope)).toBeCloseTo(2024.22, 2);
    // Sin excedente sobre el mínimo, el tope es cero y aun así se cobra.
    const sinExcedente = aplicarDeducciones([prestamo(5000)], topesDelPeriodo(11000, 11903.13));
    expect(n(sinExcedente.total)).toBeCloseTo(5000, 2);
    expect(n(sinExcedente.cobradas[0].tope)).toBe(0);
  });

  it("sólo corta lo que dejaría el neto negativo, y lo que falta del préstamo queda en el saldo", () => {
    const r = aplicarDeducciones([prestamo(15000)], topesDelPeriodo(12000, 11903.13));
    expect(n(r.prestamos)).toBeCloseTo(12000, 2);
    expect(n(r.amortizaciones[0].saldo!)).toBeCloseTo(3000, 2);
    expect(r.amortizaciones[0].desactivar).toBe(false);
    expect(r.recortadas).toHaveLength(1);
    expect(n(r.cobradas[0].cuota)).toBeCloseTo(15000, 2);
  });

  it("la pensión alimenticia va primero; la que pasa del 50 % se cobra y queda el aviso", () => {
    const pension = prestamo(8000, { id: "a", tipo: "PENSION_ALIMENTICIA", saldo: null, cuotasMeses: null });
    const r = aplicarDeducciones([prestamo(1000), pension], topesDelPeriodo(10000, 11903.13));
    expect(n(r.otros)).toBeCloseTo(8000, 2);
    expect(n(r.prestamos)).toBeCloseTo(1000, 2);
    expect(n(r.cobradas.find((c) => c.id === "a")!.tope)).toBeCloseTo(5000, 2);
  });

  it("anticipos y cooperativa no tienen la cuarta parte, sólo lo disponible", () => {
    const adelanto = prestamo(9000, { id: "x", tipo: "ADELANTO" });
    const r = aplicarDeducciones([adelanto], topesDelPeriodo(6000, 11903.13));
    expect(n(r.adelantos)).toBeCloseTo(6000, 2);
  });

  it("ocho ausencias en una quincena no descuentan más que la quincena", () => {
    const r = calcularPlanilla(mes({ salarioMensual: 12000, tipoPlanilla: "QUINCENAL", diasPagables: 15, diasMes: 15, diasAusentes: 8 }), P);
    expect(n(r.ausencias)).toBeLessThanOrEqual(n(r.salarioBase));
  });
});

describe("fallo 3: en un mes parcial los aportes se calculan sobre lo devengado", () => {
  const medio = calcularPlanilla(mes({ salarioMensual: 20000, diasPagables: 15 }), P);
  it("sueldo 10,000: IHSS 500, sin RAP, Reserva 400, INFOP 100", () => {
    expect(n(medio.salarioBase)).toBe(10000);
    expect(n(medio.ihssEmpleado)).toBeCloseTo(500, 2);
    expect(n(medio.rapEmpleado)).toBe(0);
    expect(n(medio.reservaLaboral)).toBeCloseTo(400, 2);
    expect(n(medio.infop)).toBeCloseTo(100, 2);
  });
  it("el techo es mensual: con 30,000 y medio mes, 15,000 devengados siguen sobre el techo del IHSS", () => {
    expect(n(calcularPlanilla(mes({ salarioMensual: 30000, diasPagables: 15 }), P).ihssEmpleado)).toBeCloseTo(595.16, 2);
  });
  it("el ISR sigue proyectando el mes completo", () => {
    expect(n(medio.isr)).toBeCloseTo(n(calcularPlanilla(mes({ salarioMensual: 20000 }), P).isr), 2);
  });
});

describe("fallo 4: recargo de horas extra según el período (Art. 330)", () => {
  // Salario 24,000 → hora diurna 24,000 / 30 / 8 = 100.
  it("hora extra en período diurno: 25 % sobre la hora diurna", () => {
    expect(n(calcularMontoHorasExtra(24000, repartirJornada({ horaEntrada: hora(7), horaSalida: hora(17) }).extra))).toBeCloseTo(2 * 125, 2);
  });
  it("trabajador diurno, extra de 19:00 a 21:00: 50 % sobre la hora diurna", () => {
    const extra = repartirJornada({ horaEntrada: hora(11), horaSalida: hora(21) }).extra;
    expect(n(calcularMontoHorasExtra(24000, extra))).toBeCloseTo(2 * 150, 2);
  });
  it("extra de 17:00 a 20:00: 2 h al 25 % y 1 h al 50 %", () => {
    const extra = repartirJornada({ horaEntrada: hora(9), horaSalida: hora(20) }).extra;
    expect(n(calcularMontoHorasExtra(24000, extra))).toBeCloseTo(2 * 125 + 1 * 150, 2);
  });
  it("prolongación de la jornada nocturna: 75 % sobre la hora nocturna (salario / 30 / 6)", () => {
    const extra = repartirJornada({ horaEntrada: hora(18), horaSalida: hora(23), jornadaHoras: 3, tipoJornada: "NOCTURNA" }).extra;
    expect(n(calcularMontoHorasExtra(24000, extra))).toBeCloseTo((24000 / 30 / 6) * 2 * 1.75, 2);
  });
});

describe("fallo 5: incapacidad, el patrono completa la diferencia (Reglamento de Incapacidad Temporal 2020, Art. 73)", () => {
  // 30,000 al mes, enfermedad común del 2 al 11: 3 días del patrono y 7 del IHSS.
  const regla = REGLAS_POR_OMISION.ENFERMEDAD_COMUN;
  const inc = { fechaInicio: fecha("2026-03-02"), fechaFin: fecha("2026-03-11"), diasPatrono: regla.diasPatrono, porcentajeSubsidio: regla.porcentajeSubsidio };
  const subsidio = subsidioEstimado(30000, 7, regla.porcentajeSubsidio, 11903.13); // 1,833.08
  it("el IHSS paga desde el 4.º día: 7 días a su cargo (Art. 71)", () => {
    expect(descuentoIncapacidades(30000, [inc], fecha("2026-03-01"), fecha("2026-03-15"), 11903.13).diasIhss).toBe(7);
  });
  it("al trabajador sólo se le descuenta lo que paga el IHSS (1,833.08 de 7,000)", () => {
    expect(descuentoIncapacidades(30000, [inc], fecha("2026-03-01"), fecha("2026-03-15"), 11903.13).descuento).toBeCloseTo(subsidio, 2);
  });
});

describe("fallo 6: exención del ISR de los décimos", () => {
  it("10 salarios mínimos promedio «en cada caso» (Ley del ISR, Art. 10)", () => {
    const r = aplicarFiscalidadDecimo({ montoDevengado: 100000, salarioMinimo: 14917.2 });
    expect(n(r.techoExento)).toBeCloseTo(149172, 2);
    expect(n(r.montoExento)).toBe(100000);
  });
});

describe("fallo 7: provisión de vacaciones", () => {
  const prov = (tipo: "MENSUAL" | "QUINCENAL" | "SEMANAL", dias: number, anios = 2) =>
    n(calcularPlanilla(mes({ salarioMensual: 30000, tipoPlanilla: tipo, diasPagables: dias, diasMes: dias, aniosTrabajados: anios }), P).provisionVacaciones);
  it("en un año suma el valor de las vacaciones del año en curso", () => {
    // Con 2 años completos se está en el tercero: se ganan 15 días (Art. 346).
    expect(prov("MENSUAL", 30) * 12).toBeCloseTo(15000, 0);
    expect(prov("QUINCENAL", 15) * 24).toBeCloseTo(15000, 0);
    expect(prov("SEMANAL", 7) * 52).toBeCloseTo(15000, 0);
  });
  it("el primer año devenga los 10 días que se cobran al cumplirlo", () => {
    expect(prov("MENSUAL", 30, 0) * 12).toBeCloseTo(10000, 0);
  });
  it("los años se cuentan al cierre del período, no a hoy", () => {
    expect(calcularAniosTrabajados(fecha("2030-01-15"), fecha("2032-03-31"))).toBe(2);
    expect(calcularAniosTrabajados(fecha("2030-01-15"), fecha("2026-11-10"))).toBe(0);
  });
});

describe("fallo 8: ausencias, un séptimo día por semana y no por ausencia", () => {
  it("dos faltas en la misma semana pierden un solo séptimo", () => {
    const fechas = [fecha("2026-11-03"), fecha("2026-11-05")];
    expect(semanasDistintas(fechas)).toBe(1);
    expect(n(calcularDescuentoAusencia(30000, 2, 2, semanasDistintas(fechas)))).toBeCloseTo(3000, 2);
  });
  it("en semanas distintas, un séptimo por cada una", () => {
    expect(semanasDistintas([fecha("2026-11-03"), fecha("2026-11-10")])).toBe(2);
  });
});

describe("fallos 9, 10 y 13: liquidación", () => {
  const base = { fechaIngreso: fecha("2023-06-01"), fechaSalida: fecha("2026-10-15"), causa: "DESPIDO_INJUSTIFICADO" as const, salarioPromedio: 25000 };
  it("fallo 9: el saldo del Fondo de Reserva se rebaja de la cesantía (Decreto 47-2024, Art. 6)", () => {
    const sin = calcularLiquidacion(base);
    const con = calcularLiquidacion({ ...base, saldoFondoReserva: 24000 });
    expect(n(con.totalAPagar)).toBeCloseTo(n(sin.totalAPagar) - 24000, 2);
    expect(con.conceptos.find((c) => c.concepto === CONCEPTO_FONDO_RESERVA)?.monto.toFixed(2)).toBe("-24000.00");
  });
  it("fallo 9: sin cesantía (despido justificado) el fondo no se rebaja de nada", () => {
    const r = calcularLiquidacion({ ...base, causa: "DESPIDO_JUSTIFICADO", saldoFondoReserva: 24000 });
    expect(r.conceptos.some((c) => c.concepto === CONCEPTO_FONDO_RESERVA)).toBe(false);
  });
  it("fallo 10: avisa cuando las vacaciones pendientes pasan de dos períodos (Art. 350)", () => {
    const r = calcularLiquidacion({ fechaIngreso: fecha("2020-01-01"), fechaSalida: fecha("2032-03-20"), causa: "DESPIDO_INJUSTIFICADO", salarioPromedio: 18000 });
    expect(r.observaciones.some((o) => o.includes("Art. 350"))).toBe(true);
    expect(maximoVacacionesAcumulables(12.2)).toBeCloseTo(20 + 20 + 20 * 0.2, 1);
  });
  it("fallo 13: preaviso de 60 días sobre 25,000 = 50,000.00", () => {
    expect(n(calcularLiquidacion(base).conceptos.find((c) => c.concepto === "Preaviso")!.monto)).toBe(50000);
  });
});

describe("fallos 11 y 12: días comerciales", () => {
  it("fallo 11: quien sale el 20 de un mes de 31 cobra 20 días", () => {
    expect(diasConDerechoASalario({ fechaIngreso: fecha("2020-01-01"), fechaSalida: fecha("2026-10-20"), desde: fecha("2026-10-01"), hasta: fecha("2026-10-31"), diasMes: 30 })).toBe(20);
  });
  it("fallo 12: décimo tercero de julio a diciembre = la mitad (15,000)", () => {
    const r = calcularDecimo({ tipo: "DECIMO_TERCERO", anio: 2026, fechaIngreso: fecha("2026-07-01"), salarioPromedio: 30000 });
    expect(n(r.montoDevengado)).toBeCloseTo(15000, 0);
  });
});

describe("fallo 14: jornada máxima (Arts. 332 y 333)", () => {
  const dia = (empleadoId: string, f: string, normales: number, extra: number) =>
    ({ empleadoId, fecha: fecha(f), horasNormales: normales, horasExtra: extra, horasFeriado: 0 });
  it("señala más de 12 h en un día", () => {
    expect([...excesosDeJornada([dia("a", "2026-11-03", 8, 5), dia("b", "2026-11-03", 8, 4)])]).toEqual(["a"]);
  });
  it("señala horas extra más de 4 días en una semana", () => {
    const semana = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((f) => dia("c", f, 8, 1));
    expect(excesosDeJornada(semana).has("c")).toBe(true);
    expect(excesosDeJornada(semana.slice(0, 4)).has("c")).toBe(false);
  });
});
