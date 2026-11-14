import { describe, expect, it } from "vitest";
import { calcularLiquidacion } from "@/lib/payroll/liquidacion";
import { aNumero } from "@/lib/payroll/money";
import { asistencia, cesantiaAcumulada, fuerzaLaboral, mesesDelRango, proyectarDecimo, tasaRotacion, variacion, type PersonaTablero } from "./indicadores";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const persona = (id: string, ingreso: string, salida: string | null, sucursal = "SPS", salario = 18000): PersonaTablero => ({
  id, fechaIngreso: d(ingreso), fechaSalida: salida ? d(salida) : null, salarioBase: salario, sucursal, departamento: "Ventas",
});

describe("fuerzaLaboral", () => {
  const gente = [
    persona("a", "2020-01-01", null),
    persona("b", "2026-10-10", null, "Choloma"),
    persona("c", "2019-05-01", "2026-10-20"),
    persona("d", "2026-11-03", null),
    persona("e", "2021-01-01", "2026-09-15"),
  ];
  const r = fuerzaLaboral(gente, d("2026-10-01"), d("2026-11-14"));

  it("activos al final, altas y bajas del período", () => {
    expect(r.activos).toBe(3);
    expect(r.altas).toBe(2);
    expect(r.bajas).toBe(1);
  });
  it("rotación = bajas ÷ promedio de activos (inicio 2, fin 3)", () => {
    expect(r.rotacion).toBe(40);
  });
  it("distribución y altas/bajas por mes", () => {
    expect(r.porSucursal).toEqual([{ nombre: "SPS", activos: 2 }, { nombre: "Choloma", activos: 1 }]);
    expect(r.porMes).toEqual([{ mes: "2026-10", altas: 1, bajas: 1 }, { mes: "2026-11", altas: 1, bajas: 0 }]);
  });
});

describe("tasaRotacion y variacion", () => {
  it("sin activos no hay tasa", () => expect(tasaRotacion(1, 0, 0)).toBeNull());
  it("variación con y sin período anterior", () => {
    expect(variacion(110, 100)).toBe(10);
    expect(variacion(100, 0)).toBeNull();
  });
  it("meses que cruzan el año", () => expect(mesesDelRango(d("2026-11-20"), d("2027-02-01"))).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]));
});

describe("asistencia", () => {
  it("ausentismo, horas extra sobre ordinarias y puntualidad", () => {
    const r = asistencia({ diasConRegistro: 4, ausencias: 1, horasOrdinarias: 24, horasExtra: 3 }, { diasConMarca: 20, llegadasTarde: 3 });
    expect(r).toMatchObject({ diasConRegistro: 4, ausencias: 1, ausentismo: 25, horasOrdinarias: 24, horasExtra: 3, extraSobreOrdinarias: 12.5, puntualidad: 85 });
  });
  it("sin datos, nulos (no ceros que parezcan medidos)", () => {
    expect(asistencia({ diasConRegistro: 0, ausencias: 0, horasOrdinarias: 0, horasExtra: 0 }, null)).toMatchObject({ ausentismo: null, extraSobreOrdinarias: null, puntualidad: null });
  });
});

describe("proyectarDecimo", () => {
  const hoy = d("2026-11-14");
  it("13.º: proyectado a diciembre, acumulado a hoy y neto menos adelantos", () => {
    // Todo el año: 18,000 al corte; del 1/1 al 14/11 van 314 días comerciales (10 × 30 + 14).
    const r = proyectarDecimo("DECIMO_TERCERO", hoy, [persona("a", "2020-01-01", null)], new Map([["a", 3000]]));
    expect(r.anio).toBe(2026);
    expect(r.proyectado).toBe(18000);
    expect(r.acumulado).toBe(15700);
    expect(r.adelantos).toBe(3000);
    expect(r.neto).toBe(15000);
  });
  it("14.º en noviembre es el que se paga en junio del año siguiente", () => {
    const r = proyectarDecimo("DECIMO_CUARTO", hoy, [persona("a", "2020-01-01", null)], new Map());
    expect(r.anio).toBe(2027);
    expect(r.proyectado).toBe(18000);
  });
  it("quien ya salió no se proyecta; un adelanto mayor deja el neto en cero", () => {
    const r = proyectarDecimo("DECIMO_TERCERO", hoy, [persona("a", "2020-01-01", "2026-06-30"), persona("b", "2026-07-01", null, "Choloma", 12000)], new Map([["b", 99999]]));
    expect(r.porSucursal).toEqual([{ nombre: "Choloma", proyectado: 6000, adelantos: 99999, neto: 0, empleados: 1 }]);
    expect(r.neto).toBe(0);
  });
});

describe("cesantiaAcumulada", () => {
  it("es la cesantía que daría la liquidación por despido ese día", () => {
    const esperado = calcularLiquidacion({ fechaIngreso: d("2020-01-01"), fechaSalida: d("2026-06-30"), causa: "DESPIDO_INJUSTIFICADO", salarioPromedio: 15000 })
      .conceptos.find((c) => c.concepto.startsWith("Auxilio de cesantía"))!.monto;
    expect(cesantiaAcumulada({ fechaIngreso: d("2020-01-01"), salarioBase: 15000 }, d("2026-06-30"), false)).toBe(aNumero(esperado));
    expect(aNumero(esperado)).toBeCloseTo(97397.26, 2); // 30 días × 6.49 años de servicio
  });
  it("menos de tres meses: cero", () => {
    expect(cesantiaAcumulada({ fechaIngreso: d("2026-10-01"), salarioBase: 15000 }, d("2026-11-14"), false)).toBe(0);
  });
});
