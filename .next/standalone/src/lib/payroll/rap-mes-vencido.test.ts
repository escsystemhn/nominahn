import { describe, expect, it } from "vitest";
import { calcularPlanilla, calcularReservaLaboral, PARAMETROS_DEFAULT, type EntradaCalculoPlanilla, type ParametrosLegales } from "./calculos-hn";
import { aNumero as n, money } from "./money";
import {
  baseDelMes,
  mesAnterior,
  mesDe,
  nombreMes,
  normalizarBaseRap,
  pendienteDeSalida,
  rangoMes,
  rapPendienteDeSalida,
  reglaDelMes,
} from "./rap-mes-vencido";

const P = PARAMETROS_DEFAULT;
const con = (rap: "DIVIDIDO" | "PRIMERA" | "SEGUNDA"): ParametrosLegales => ({ ...P, distribucionQuincenal: { ...P.distribucionQuincenal, rap } });

const entrada = (o: Partial<EntradaCalculoPlanilla>): EntradaCalculoPlanilla => ({
  salarioMensual: 30000, tipoPlanilla: "MENSUAL", diasPagables: 30, diasMes: 30, horasExtra: 0, bonificaciones: 0, otrosIngresos: 0,
  diasAusentes: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 1, ...o,
});
const quincena = (numero: 1 | 2, enOtraQuincena = true) => ({ tipoPlanilla: "QUINCENAL" as const, diasMes: 15, diasPagables: 15, quincena: { numero, diasPagablesMes: 30, enOtraQuincena } });

// Base de octubre 41,903.13: excedente de 30,000 → RAP 450.00 de cada parte.
const OCTUBRE = 41903.13;

describe("configuración y meses", () => {
  it("lo guardado que no se entiende vale como «mes en curso»; a mes vencido exige el mes", () => {
    expect(normalizarBaseRap(null)).toEqual({ modo: "EN_CURSO", desde: null });
    expect(normalizarBaseRap('{"modo":"ANTERIOR"}')).toEqual({ modo: "EN_CURSO", desde: null });
    expect(normalizarBaseRap('{"modo":"ANTERIOR","desde":"2026-12"}')).toEqual({ modo: "ANTERIOR", desde: "2026-12" });
    expect(normalizarBaseRap({ modo: "EN_CURSO", desde: "2026-12" })).toEqual({ modo: "EN_CURSO", desde: null });
  });

  it("antes del mes elegido sigue el mes en curso; el primero es de transición", () => {
    const c = { modo: "ANTERIOR" as const, desde: "2026-12" };
    expect(reglaDelMes(c, "2026-11")).toBe("EN_CURSO");
    expect(reglaDelMes(c, "2026-12")).toBe("TRANSICION");
    expect(reglaDelMes(c, "2027-01")).toBe("ANTERIOR");
    expect(reglaDelMes({ modo: "EN_CURSO", desde: null }, "2027-01")).toBe("EN_CURSO");
  });

  it("meses: anterior, rango y nombre", () => {
    expect(mesAnterior("2027-01")).toBe("2026-12");
    expect(mesDe(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11");
    expect(rangoMes("2026-02").hasta.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(nombreMes("2026-10")).toBe("octubre de 2026");
  });
});

describe("la base de cada empleado", () => {
  it("la importada manda; si no, la de las planillas; en la transición sólo la importada", () => {
    expect(baseDelMes("ANTERIOR", money(50000), money(30000))).toMatchObject({ origen: "IMPORTADA" });
    expect(n(baseDelMes("ANTERIOR", null, money(30000)).base)).toBe(30000);
    expect(baseDelMes("ANTERIOR", null, money(0)).origen).toBe("SIN_BASE");
    expect(baseDelMes("TRANSICION", null, money(30000)).origen).toBe("SIN_BASE");
    expect(n(baseDelMes("TRANSICION", money(0), money(30000)).base)).toBe(0);
  });

  it("lo pendiente de quien sale: la parte del mes trabajada", () => {
    const p = pendienteDeSalida(60000, 15)!;
    expect(n(p.base)).toBe(30000);
    expect(n(p.fraccion)).toBe(0.5);
    expect(pendienteDeSalida(60000, 0)).toBeNull();
  });
});

describe("el motor a mes vencido", () => {
  it("planilla mensual: RAP de las dos partes y Reserva sobre la base del mes anterior, no sobre el salario", () => {
    const r = calcularPlanilla(entrada({ rapMesVencido: { base: OCTUBRE } }), P);
    expect(n(r.rapEmpleado)).toBe(450);
    expect(n(r.rapEmpleador)).toBe(450);
    expect(n(r.reservaLaboral)).toBe(n(calcularReservaLaboral(OCTUBRE, P).empleador));
    // Sin la opción, sobre los 30,000 del mes.
    expect(n(calcularPlanilla(entrada({}), P).rapEmpleado)).toBeCloseTo(271.45, 2);
  });

  it("quien entró este mes no tiene base del anterior: no cotiza hasta el mes siguiente", () => {
    const r = calcularPlanilla(entrada({ rapMesVencido: { base: 0 } }), P);
    expect(n(r.rapEmpleado)).toBe(0);
    expect(n(r.reservaLaboral)).toBe(0);
  });

  it("quincenal, la mitad en cada quincena: la mitad del mes anterior en cada una", () => {
    const r = calcularPlanilla(entrada({ ...quincena(1), rapMesVencido: { base: OCTUBRE } }), con("DIVIDIDO"));
    expect(n(r.rapEmpleado)).toBe(225);
    expect(n(r.reservaLaboral)).toBeCloseTo(n(calcularReservaLaboral(OCTUBRE, P).empleador) / 2, 1);
  });

  it("quincenal, completo en la segunda: nada en la primera y todo en la segunda; la Reserva sigue al RAP", () => {
    const p = con("SEGUNDA");
    const q1 = calcularPlanilla(entrada({ ...quincena(1), rapMesVencido: { base: OCTUBRE } }), p);
    const q2 = calcularPlanilla(entrada({ ...quincena(2), rapMesVencido: { base: OCTUBRE } }), p);
    expect([n(q1.rapEmpleado), n(q1.reservaLaboral)]).toEqual([0, 0]);
    expect(n(q2.rapEmpleado)).toBe(450);
    expect(n(q2.reservaLaboral)).toBe(n(calcularReservaLaboral(OCTUBRE, P).empleador));
  });

  it("quien sale en la primera quincena paga ahí el mes anterior entero; lo de su mes lo toma la liquidación", () => {
    const r = calcularPlanilla(entrada({ ...quincena(1, false), salarioMensual: 60000, rapMesVencido: { base: OCTUBRE } }), con("DIVIDIDO"));
    expect(n(r.rapEmpleado)).toBe(450);
    expect(n(r.reservaLaboral)).toBe(n(calcularReservaLaboral(OCTUBRE, P).empleador));
  });

  it("el neto y las deducciones usan el RAP a mes vencido", () => {
    const sin = calcularPlanilla(entrada({}), P);
    const con_ = calcularPlanilla(entrada({ rapMesVencido: { base: OCTUBRE } }), P);
    expect(n(con_.totalDeducciones) - n(sin.totalDeducciones)).toBeCloseTo(450 - 271.45, 2);
    expect(n(sin.salarioNeto) - n(con_.salarioNeto)).toBeCloseTo(450 - 271.45, 2);
  });
});

describe("al salir: lo que toma la liquidación", () => {
  const nada = { empleado: money(0), empleador: money(0), reserva: money(0) };

  it("sin planillas del mes de salida: todo el mes anterior y lo trabajado en el de salida", () => {
    // Sale el 15 de noviembre con 60,000: octubre (base 41,903.13) 450 y noviembre (30,000) 271.45.
    const r = rapPendienteDeSalida({ mesSalida: "2036-11", baseAnterior: money(OCTUBRE), descontado: nada, salarioMensual: 60000, diasEnElMes: 15 }, P);
    expect(r.meses.map((m) => [m.mes, n(m.base), m.declarar, n(m.empleado)])).toEqual([["2036-10", OCTUBRE, true, 450], ["2036-11", 30000, true, 271.45]]);
    expect(n(r.empleado)).toBeCloseTo(721.45, 2);
    expect(n(r.reserva)).toBeCloseTo(n(calcularReservaLaboral(OCTUBRE, P).empleador) + 1200, 2);
  });

  it("si una quincena ya descontó la mitad del mes anterior, toma sólo la otra mitad", () => {
    const r = rapPendienteDeSalida({
      mesSalida: "2036-11", baseAnterior: money(OCTUBRE), salarioMensual: 60000, diasEnElMes: 20,
      descontado: { empleado: money(225), empleador: money(225), reserva: money(0) },
    }, P);
    expect(n(r.meses[0].empleado)).toBe(225);
    expect(r.meses[0].declarar).toBe(false); // su base ya salió en la planilla
  });

  it("si las planillas ya descontaron el mes anterior, sólo queda el de salida", () => {
    const todo = { empleado: money(450), empleador: money(450), reserva: calcularReservaLaboral(OCTUBRE, P).empleador };
    const r = rapPendienteDeSalida({ mesSalida: "2036-11", baseAnterior: money(OCTUBRE), descontado: todo, salarioMensual: 60000, diasEnElMes: 15 }, P);
    expect(r.meses.map((m) => m.mes)).toEqual(["2036-11"]);
  });

  it("bajo el piso no hay RAP, pero sí Reserva (no tiene piso)", () => {
    const r = rapPendienteDeSalida({ mesSalida: "2036-11", baseAnterior: money(0), descontado: nada, salarioMensual: 20000, diasEnElMes: 10 }, P);
    expect([n(r.empleado), n(r.reserva)]).toEqual([0, n(calcularReservaLaboral(20000 / 3, P).empleador)]);
  });

  it("con monto fijo general, al mes de salida le toca su fracción", () => {
    const p: ParametrosLegales = { ...P, fijos: { ...P.fijos, rap: { empleado: 300, empleador: 300 } } };
    const r = rapPendienteDeSalida({ mesSalida: "2036-11", baseAnterior: money(0), descontado: nada, salarioMensual: 30000, diasEnElMes: 15 }, p);
    expect(n(r.empleado)).toBe(450); // 300 de octubre (monto fijo) + 150 de medio noviembre
  });
});
