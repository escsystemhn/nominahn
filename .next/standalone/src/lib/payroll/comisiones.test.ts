import { describe, it, expect } from "vitest";
import { calcularLineaComision, isrComisionPersonalizado, type CriteriosComision } from "./comisiones";
import { calcularPlanilla, PARAMETROS_DEFAULT as P, type ParametrosLegales } from "./calculos-hn";
import { CONFIG_ISR_PERSONALIZADO_DEFAULT } from "./isr-personalizado";
import { aNumero } from "./money";

const RECOMENDADOS: CriteriosComision = { cotizaRapYReserva: true, retieneVecinal: true };
const linea = (salarioMensual: number, comision: number, extra: Partial<Parameters<typeof calcularLineaComision>[0]> = {}, c = RECOMENDADOS, p: ParametrosLegales = P) =>
  calcularLineaComision({ salarioMensual, comision, ...extra }, p, c);
const n = (x: Parameters<typeof aNumero>[0]) => aNumero(x);

/** Una quincena ordinaria, tal como la calcula hoy la planilla. */
const quincena = (salario: number) => calcularPlanilla({
  salarioMensual: salario, tipoPlanilla: "QUINCENAL", diasPagables: 15, diasMes: 15, horasExtra: {}, bonificaciones: 0,
  otrosIngresos: 0, diasAusentes: 0, incapacidad: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 2,
} as Parameters<typeof calcularPlanilla>[0], P);

describe("comisión pagada en planilla aparte: los ejemplos del FAQ", () => {
  it("salario de L 9,000 y comisión de L 5,000: completa el techo del IHSS", () => {
    const l = linea(9000, 5000);
    expect(n(l.ihssEmpleado)).toBe(145.16);
    expect(n(l.rapEmpleado)).toBe(31.45);
    expect(n(l.isr)).toBe(0);
    expect(n(l.impuestoVecinal)).toBe(25.38);
    expect(n(l.totalDeducciones)).toBe(201.99);
    expect(n(l.neto)).toBe(4798.01);
    expect(n(l.ihssEmpleador)).toBe(246.77);
    expect(n(l.infop)).toBe(50);
    expect(n(l.reservaLaboral)).toBe(200);
  });

  it("salario de L 25,000 y comisión de L 10,000: el IHSS ya está en el techo y el ISR sí sube", () => {
    const l = linea(25000, 10000);
    expect(n(l.ihssEmpleado)).toBe(0);
    expect(n(l.ihssEmpleador)).toBe(0);
    expect(n(l.rapEmpleado)).toBe(150);
    expect(n(l.isr)).toBe(1563.12);
    expect(n(l.impuestoVecinal)).toBe(52.5);
    expect(n(l.totalDeducciones)).toBe(1765.62);
    expect(n(l.infop)).toBe(100);
  });
});

describe("el mes cuadra sin importar el día de pago", () => {
  it.each([[9000, 5000], [11000, 2000], [25000, 10000], [60000, 30000], [11903.13, 0.01]])(
    "salario %s + comisión %s: dos quincenas + comisión = el mes completo",
    (salario, comision) => {
      const q = quincena(salario);
      const l = linea(salario, comision);
      const mes = linea(0, salario + comision); // todo el mes de una vez, sin nada antes
      for (const k of ["ihssEmpleado", "rapEmpleado", "isr", "impuestoVecinal", "ihssEmpleador", "rapEmpleador"] as const) {
        const enQuincenas = 2 * n(k === "isr" ? q.isr : k === "impuestoVecinal" ? q.impuestoVecinal : k === "ihssEmpleado" ? q.ihssEmpleado : k === "rapEmpleado" ? q.rapEmpleado : k === "ihssEmpleador" ? q.ihssEmpleador : q.rapEmpleador);
        // Cada quincena redondea su mitad: el mes puede diferir en un centavo.
        expect(Math.abs(enQuincenas + n(l[k]) - n(mes[k]))).toBeLessThanOrEqual(0.02);
      }
    }
  );

  it("dos planillas de comisiones en el mismo mes suman lo mismo que una sola", () => {
    const una = linea(9000, 8000);
    const primera = linea(9000, 3000);
    const segunda = linea(9000, 5000, { comisionesPreviasDelMes: 3000 });
    for (const k of ["ihssEmpleado", "rapEmpleado", "isr", "impuestoVecinal", "ihssEmpleador"] as const) {
      expect(Math.abs(n(primera[k]) + n(segunda[k]) - n(una[k]))).toBeLessThanOrEqual(0.01);
    }
  });
});

describe("lo que no se repite", () => {
  it("no cobra préstamos ni cuotas: sólo las de ley y lo autorizado para comisiones", () => {
    const sin = linea(9000, 5000);
    const con = linea(9000, 5000, { deduccionesAutorizadas: 300 });
    expect(n(con.totalDeducciones) - n(sin.totalDeducciones)).toBeCloseTo(300, 2);
    expect(n(sin.deduccionesAutorizadas)).toBe(0);
  });

  it("con IHSS de monto fijo, el trabajador ya pagó su monto del mes", () => {
    const l = linea(9000, 5000, { ihssMontoFijoMensual: 400 });
    expect(n(l.ihssEmpleado)).toBe(0);
    expect(n(l.ihssEmpleador)).toBe(246.77); // la parte patronal sigue por porcentaje
  });

  it("con montos fijos generales, nada de eso aumenta", () => {
    const p: ParametrosLegales = { ...P, fijos: { ihss: { empleado: 300, empleador: 600 }, ivm: { empleado: 200, empleador: 300 }, rap: null, infop: { empleador: 90 }, reservaLaboral: null } };
    const l = linea(9000, 5000, {}, RECOMENDADOS, p);
    expect(n(l.ihssEmpleado)).toBe(0);
    expect(n(l.ihssEmpleador)).toBe(0);
    expect(n(l.infop)).toBe(0);
  });
});

describe("decisiones del FAQ", () => {
  it("si la comisión no es salario ordinario, no suma al RAP ni a la Reserva", () => {
    const l = linea(25000, 10000, {}, { cotizaRapYReserva: false, retieneVecinal: true });
    expect(n(l.rapEmpleado)).toBe(0);
    expect(n(l.rapEmpleador)).toBe(0);
    expect(n(l.reservaLaboral)).toBe(0);
    // Sin RAP que restar, la base del ISR es mayor.
    expect(n(l.isr)).toBeGreaterThan(1563.12);
  });

  it("si el vecinal se regulariza al año, no se retiene aquí", () => {
    expect(n(linea(9000, 5000, {}, { cotizaRapYReserva: true, retieneVecinal: false }).impuestoVecinal)).toBe(0);
  });

  it("con el cálculo personalizado usa la retención que se le pasa", () => {
    expect(n(linea(25000, 10000, { isrPersonalizado: 812.4 }).isr)).toBe(812.4);
  });
});

describe("isrComisionPersonalizado", () => {
  const base = {
    mesPago: 6,
    historial: Array.from({ length: 5 }, () => ({ meses: 1, sueldo: 25000, variables: 0, isrRetenido: 277.2 })),
    actual: { sueldo: 25000, variables: 0 },
    salarioMensual: 25000,
    proyectar: true,
    edad: 35,
    ivmTope: 11903.13,
    ivmEmpleado: 0.025,
    tabla: P.tablaISRAnual,
    config: CONFIG_ISR_PERSONALIZADO_DEFAULT,
  };

  it("sin comisión no retiene nada", () => {
    expect(n(isrComisionPersonalizado(base, 0))).toBe(0);
  });

  it("retiene la parte del mes del aumento del ISR anual, y crece con la comisión", () => {
    const chica = n(isrComisionPersonalizado(base, 5000));
    const grande = n(isrComisionPersonalizado(base, 10000));
    expect(chica).toBeGreaterThan(0);
    expect(grande).toBeGreaterThan(chica);
    // Sólo la parte del mes: el resto lo reparten las planillas siguientes.
    expect(grande).toBeLessThan(10000 * 0.25);
  });
});
