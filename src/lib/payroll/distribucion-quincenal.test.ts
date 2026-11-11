import { describe, it, expect } from "vitest";
import { calcularPlanilla, PARAMETROS_DEFAULT, type EntradaCalculoPlanilla, type ParametrosLegales } from "@/lib/payroll/calculos-hn";
import {
  DISTRIBUCION_POR_OMISION, normalizarDistribucion, numeroDeQuincena, otraQuincena, tramoQuincenal, type DistribucionQuincenal,
} from "@/lib/payroll/distribucion-quincenal";

const n = (x: { toString(): string }) => Number(x.toString());
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (f: Date) => f.toISOString().slice(0, 10);
const conDistribucion = (x: DistribucionQuincenal): ParametrosLegales => ({ ...PARAMETROS_DEFAULT, distribucionQuincenal: x });
const SEGUNDA: DistribucionQuincenal = { ihss: "SEGUNDA", rap: "SEGUNDA", vecinal: "SEGUNDA" };
const PRIMERA: DistribucionQuincenal = { ihss: "PRIMERA", rap: "PRIMERA", vecinal: "PRIMERA" };

const quincena = (salario: number, numero: 1 | 2, o: Partial<EntradaCalculoPlanilla> = {}, mes = { diasPagablesMes: 30, enOtraQuincena: true }): EntradaCalculoPlanilla => ({
  salarioMensual: salario, tipoPlanilla: "QUINCENAL", diasPagables: 15, diasMes: 15, horasExtra: 0, bonificaciones: 0,
  otrosIngresos: 0, diasAusentes: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 3,
  quincena: { numero, ...mes }, ...o,
});

describe("configuración guardada", () => {
  it("por omisión todo va dividido, como antes", () => {
    expect(normalizarDistribucion(null)).toEqual(DISTRIBUCION_POR_OMISION);
    expect(PARAMETROS_DEFAULT.distribucionQuincenal).toEqual(DISTRIBUCION_POR_OMISION);
  });
  it("lee el JSON guardado y descarta valores que no entiende", () => {
    expect(normalizarDistribucion('{"ihss":"SEGUNDA","rap":"OTRO","vecinal":"PRIMERA"}')).toEqual({ ihss: "SEGUNDA", rap: "DIVIDIDO", vecinal: "PRIMERA" });
    expect(normalizarDistribucion("no es json")).toEqual(DISTRIBUCION_POR_OMISION);
  });
  it("la quincena que empieza el 16 o después es la segunda; la otra mitad del mes", () => {
    expect(numeroDeQuincena(d("2026-11-01"))).toBe(1);
    expect(numeroDeQuincena(d("2026-11-16"))).toBe(2);
    expect([iso(otraQuincena(d("2026-11-01")).desde), iso(otraQuincena(d("2026-11-01")).hasta)]).toEqual(["2026-11-16", "2026-11-30"]);
    expect([iso(otraQuincena(d("2026-02-16")).desde), iso(otraQuincena(d("2026-02-16")).hasta)]).toEqual(["2026-02-01", "2026-02-15"]);
  });
  it("en qué quincena toca cada modo", () => {
    expect(tramoQuincenal("DIVIDIDO", 1, true)).toBe("quincena");
    expect(tramoQuincenal("SEGUNDA", 1, true)).toBeNull();
    expect(tramoQuincenal("SEGUNDA", 2, true)).toBe("mes");
    expect(tramoQuincenal("PRIMERA", 1, true)).toBe("mes");
    expect(tramoQuincenal("PRIMERA", 2, true)).toBeNull();
    // Sin días en la otra quincena, paga el mes en ésta.
    expect(tramoQuincenal("SEGUNDA", 1, false)).toBe("mes");
    expect(tramoQuincenal("PRIMERA", 2, false)).toBe("mes");
  });
});

describe("IHSS, RAP y vecinal completos en la segunda quincena", () => {
  const P = conDistribucion(SEGUNDA);
  it("en la primera quincena no se deduce nada de eso (planilla 20/2026 de PAGSA)", () => {
    const r = calcularPlanilla(quincena(40000, 1), P);
    expect(n(r.ihssEmpleado)).toBe(0);
    expect(n(r.rapEmpleado)).toBe(0);
    expect(n(r.impuestoVecinal)).toBe(0);
    expect(n(r.ihssEmpleador)).toBe(0);
    expect(n(r.rapEmpleador)).toBe(0);
    expect(n(r.salarioBase)).toBe(20000);
  });
  it("en la segunda se deduce el mes completo: el IHSS del trabajador topa en 595.16", () => {
    const r = calcularPlanilla(quincena(40000, 2), P);
    expect(n(r.ihssEmpleado)).toBeCloseTo(595.16, 2);
    expect(n(r.rapEmpleado)).toBeCloseTo((40000 - 11903.13) * 0.015, 2);
    expect(n(r.ihssEmpleador)).toBeCloseTo(595.16 + 416.61, 2);
  });
  it("el mes suma lo mismo que dividido", () => {
    const D = conDistribucion(DISTRIBUCION_POR_OMISION);
    const mes = (p: ParametrosLegales) => {
      const a = calcularPlanilla(quincena(26000, 1), p), b = calcularPlanilla(quincena(26000, 2), p);
      return [n(a.ihssEmpleado) + n(b.ihssEmpleado), n(a.rapEmpleado) + n(b.rapEmpleado), n(a.impuestoVecinal) + n(b.impuestoVecinal)];
    };
    const [i1, r1, v1] = mes(P), [i2, r2, v2] = mes(D);
    expect(i1).toBeCloseTo(i2, 1);
    expect(r1).toBeCloseTo(r2, 1);
    expect(v1).toBeCloseTo(v2, 1);
  });
  it("quien entra el 16 cotiza en la segunda sobre lo ganado en el mes (15 días)", () => {
    const r = calcularPlanilla(quincena(20000, 2, {}, { diasPagablesMes: 15, enOtraQuincena: false }), P);
    expect(n(r.ihssEmpleado)).toBeCloseTo(10000 * 0.05, 2);
  });
  it("quien sale en la primera quincena paga ahí el mes, porque no estará en la segunda", () => {
    const r = calcularPlanilla(quincena(20000, 1, { diasPagables: 10 }, { diasPagablesMes: 10, enOtraQuincena: false }), P);
    // 6,666.67 devengados: EM 166.67 + IVM 166.67 (cada régimen se redondea aparte).
    expect(n(r.ihssEmpleado)).toBeCloseTo(333.34, 2);
  });
  it("cada concepto se configura aparte", () => {
    const r = calcularPlanilla(quincena(40000, 1), conDistribucion({ ihss: "SEGUNDA", rap: "DIVIDIDO", vecinal: "DIVIDIDO" }));
    expect(n(r.ihssEmpleado)).toBe(0);
    expect(n(r.rapEmpleado)).toBeGreaterThan(0);
    expect(n(r.impuestoVecinal)).toBeGreaterThan(0);
  });
  it("no afecta la planilla mensual", () => {
    const entrada: EntradaCalculoPlanilla = { ...quincena(40000, 1), tipoPlanilla: "MENSUAL", diasPagables: 30, diasMes: 30 };
    expect(n(calcularPlanilla(entrada, P).ihssEmpleado)).toBeCloseTo(595.16, 2);
  });
  it("el ISR sigue proyectando el mes y se retiene en cada quincena", () => {
    const a = calcularPlanilla(quincena(40000, 1), P), b = calcularPlanilla(quincena(40000, 2), P);
    expect(n(a.isr)).toBeGreaterThan(0);
    expect(n(a.isr)).toBeCloseTo(n(b.isr), 2);
  });
});

describe("completo en la primera quincena", () => {
  const P = conDistribucion(PRIMERA);
  it("el mes entero en la primera y nada en la segunda", () => {
    expect(n(calcularPlanilla(quincena(40000, 1), P).ihssEmpleado)).toBeCloseTo(595.16, 2);
    expect(n(calcularPlanilla(quincena(40000, 2), P).ihssEmpleado)).toBe(0);
    expect(n(calcularPlanilla(quincena(40000, 2), P).rapEmpleado)).toBe(0);
  });
  it("quien entra el 16 no estuvo en la primera: paga el mes en la segunda", () => {
    const r = calcularPlanilla(quincena(20000, 2, {}, { diasPagablesMes: 15, enOtraQuincena: false }), P);
    expect(n(r.ihssEmpleado)).toBeCloseTo(500, 2);
  });
});

describe("con monto fijo de IHSS", () => {
  const fijo: ParametrosLegales = { ...PARAMETROS_DEFAULT, fijos: { ...PARAMETROS_DEFAULT.fijos, ihss: { empleado: 297.58, empleador: 595.16 }, ivm: { empleado: 297.58, empleador: 416.61 } } };
  it("dividido: la mitad del monto en cada quincena", () => {
    expect(n(calcularPlanilla(quincena(9000, 1), { ...fijo, distribucionQuincenal: DISTRIBUCION_POR_OMISION }).ihssEmpleado)).toBeCloseTo(297.58, 2);
  });
  it("en una sola quincena: el monto mensual completo en ésa", () => {
    const P = { ...fijo, distribucionQuincenal: SEGUNDA };
    expect(n(calcularPlanilla(quincena(9000, 1), P).ihssEmpleado)).toBe(0);
    expect(n(calcularPlanilla(quincena(9000, 2), P).ihssEmpleado)).toBeCloseTo(595.16, 2);
  });
  it("el IHSS fijo de la ficha del empleado sigue la misma regla", () => {
    const P = conDistribucion(SEGUNDA);
    expect(n(calcularPlanilla(quincena(30000, 2, { ihssMontoFijoMensual: 400 }), P).ihssEmpleado)).toBeCloseTo(400, 2);
    expect(n(calcularPlanilla(quincena(30000, 1, { ihssMontoFijoMensual: 400 }), P).ihssEmpleado)).toBe(0);
  });
});
