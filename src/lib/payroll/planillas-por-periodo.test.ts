import { describe, it, expect } from "vitest";
import { agruparPorPeriodo, enCurso, rangoLegible, type PlanillaResumen } from "@/lib/payroll/planillas-por-periodo";
import { pdfComprobantes } from "@/lib/payroll/comprobante-pdf";
import type { DatosBoleta } from "@/lib/payroll/comprobante";

let n = 0;
const pl = (desde: string, hasta: string, alcance: string, estado: PlanillaResumen["estado"] = "PAGADA", neto = 1000, tipo: PlanillaResumen["tipo"] = "QUINCENAL"): PlanillaResumen =>
  ({ id: `p${++n}`, tipo, desde, hasta, estado, bruto: neto + 100, deducciones: 100, neto, empleados: 5, alcance });

describe("planillas por período (fase 1, 2026-11-24)", () => {
  const lista = [
    pl("2026-11-16", "2026-11-30", "Grupo A / Tegucigalpa", "BORRADOR", 2000),
    pl("2026-11-16", "2026-11-30", "Grupo A / San Pedro Sula", "CALCULADA", 3000),
    pl("2026-11-01", "2026-11-15", "Grupo A / San Pedro Sula", "APROBADA"),
    pl("2026-11-01", "2026-11-15", "Grupo A / Tegucigalpa"),
    pl("2026-10-16", "2026-10-31", "Grupo A / San Pedro Sula"),
    pl("2026-10-01", "2026-10-15", "Grupo A / San Pedro Sula"),
    pl("2026-10-01", "2026-10-15", "Grupo A / Tegucigalpa", "ANULADA", 999),
    pl("2025-12-16", "2025-12-31", "Grupo A / San Pedro Sula"),
    pl("2025-01-01", "2025-01-15", "Grupo A / San Pedro Sula"),
  ];
  const g = agruparPorPeriodo(lista);

  it("el mes más reciente con sus períodos, del más reciente al más antiguo; cada período con sus sucursales por nombre", () => {
    expect(g.reciente?.nombre).toBe("Noviembre de 2026");
    expect(g.reciente?.periodos.map((p) => p.nombre)).toEqual(["2.ª quincena de noviembre de 2026", "1.ª quincena de noviembre de 2026"]);
    expect(g.reciente?.periodos[0].planillas.map((p) => p.alcance)).toEqual(["Grupo A / San Pedro Sula", "Grupo A / Tegucigalpa"]);
  });

  it("cada período suma lo suyo y cuenta lo pendiente", () => {
    const [actual, anterior] = g.reciente!.periodos;
    expect(actual.neto.toFixed(2)).toBe("5000.00");
    expect(actual.porEstado).toEqual({ BORRADOR: 1, CALCULADA: 1 });
    expect(actual.pendientes).toBe(2);
    expect(anterior.pendientes).toBe(1);
    expect(anterior.pagadas).toBe(1);
  });

  it("los meses anteriores del año, uno por fila; la anulada se ve pero no suma ni cuenta", () => {
    expect(g.anteriores.map((m) => m.nombre)).toEqual(["Octubre de 2026"]);
    const oct = g.anteriores[0];
    expect(oct.cantidad).toBe(3);
    expect(oct.vigentes).toBe(2);
    expect(oct.neto.toFixed(2)).toBe("2000.00");
    expect(oct.pendientes).toBe(0);
    expect(oct.porEstado.ANULADA).toBe(1);
  });

  it("los años anteriores, cada uno con sus meses", () => {
    expect(g.anios.map((a) => a.anio)).toEqual([2025]);
    expect(g.anios[0].meses.map((m) => m.nombre)).toEqual(["Diciembre de 2025", "Enero de 2025"]);
    expect(g.anios[0].pagadas).toBe(2);
  });

  it("sin planillas no hay nada que agrupar", () => {
    expect(agruparPorPeriodo([])).toEqual({ reciente: null, anteriores: [], anios: [] });
  });

  it("el rango en palabras y el período en curso", () => {
    expect(rangoLegible("2026-11-16", "2026-11-30")).toBe("Del 16 al 30 de noviembre");
    expect(rangoLegible("2026-11-28", "2026-12-04")).toBe("Del 28 de noviembre al 4 de diciembre");
    expect(rangoLegible("2026-12-28", "2027-01-03")).toBe("Del 28 de diciembre de 2026 al 3 de enero de 2027");
    expect(enCurso({ desde: "2026-11-16", hasta: "2026-11-30" }, "2026-11-24")).toBe(true);
    expect(enCurso({ desde: "2026-11-01", hasta: "2026-11-15" }, "2026-11-24")).toBe(false);
  });
});

describe("comprobantes de un período en un solo PDF", () => {
  const datos = (nombre: string): DatosBoleta => ({
    estado: "APROBADA", empresa: "Empresa", empresaRtn: "0801-1990-000001", sucursal: "Sucursal", departamento: "Ventas",
    nombreEmpleado: nombre, codigoEmpleado: "E-1", identidad: "0801199000001", periodo: "01/11/2026 al 15/11/2026",
    tipoPlanilla: "Planilla quincenal", diasTrabajados: "15", horasExtra: "0",
    ingresos: [["Salario base", "L 10,000.00"]], deducciones: [["RAP", "L 50.00"]],
    totalBruto: "L 10,000.00", totalDeducciones: "L 50.00", salarioNeto: "L 9,950.00",
  });

  it("cada empleado en su hoja, con las dos copias", async () => {
    const pdf = await pdfComprobantes([{ datos: datos("Ana") }, { datos: datos("Beto") }, { datos: datos("Ciro") }], "Comprobantes");
    const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    expect(paginas).toBe(3);
  });
});
