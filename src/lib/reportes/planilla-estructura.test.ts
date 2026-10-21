import { describe, it, expect } from "vitest";
import { money } from "@/lib/payroll/money";
import { tablaPlanillaDetallada, tablaResumenPlanilla, ubicacionDeLinea, type LineaPlanilla } from "./planilla-estructura";
import type { Ubicacion } from "@/lib/organizacion/estructura";

const CONF = { id: "conf", nombre: "NOMINA CONFIDENCIAL" };
const MAY = { id: "may", nombre: "PAGSA MAYOREO" };
const TGU = { id: "tgu", nombre: "PAGSA TEGUCIGALPA" };

const linea = (nombre: string, division: typeof MAY, departamento: string, neto: number): LineaPlanilla => {
  const ubicacion: Ubicacion = { sucursal: CONF, division, departamento: { id: `${division.id}-${departamento}`, nombre: departamento } };
  const m = money(neto);
  return {
    empleadoId: nombre, nombre, periodo: "01/10/2026-31/10/2026", ubicacion,
    bruto: m.plus(1000), ihss: money(200), rap: money(150), afp: money(0), isr: money(500), otras: money(0),
    ausencias: money(0), deducciones: money(1000), neto: m, patronal: money(800),
  };
};

/** `formatCurrency` separa la L con un espacio duro, como `Intl`. */
const txt = (s: string) => s.replace(/ /g, " ");

const LINEAS = [
  linea("JUAN PEREZ", MAY, "Administracion", 20000),
  linea("CARLOS MEJIA", MAY, "Administracion", 18000),
  linea("FIDEL BULNES", MAY, "Ventas", 15000),
  linea("ROGER FLORES", TGU, "Administracion", 22000),
  linea("MARIA MEDINA", TGU, "Administracion", 17000),
  linea("GONZALO CARIAS", TGU, "Ventas", 16000),
];

describe("planilla detallada agrupada", () => {
  const t = tablaPlanillaDetallada(LINEAS);
  const fila = (texto: string) => t.datos.findIndex((f) => f[0] === texto);

  it("lleva encabezado, detalle y subtotal en cada nivel, y el total general al final", () => {
    expect(t.datos.map((f, i) => `${t.filas[i].tipo}/${t.filas[i].nivel}/${f[0]}`).slice(0, 7)).toEqual([
      "grupo/0/NOMINA CONFIDENCIAL",
      "grupo/1/PAGSA MAYOREO",
      "grupo/2/Administracion",
      "detalle/3/CARLOS MEJIA",
      "detalle/3/JUAN PEREZ",
      "subtotal/2/Subtotal Administracion",
      "grupo/2/Ventas",
    ]);
    expect(t.filas.at(-1)).toEqual({ tipo: "total", nivel: 0 });
    expect(t.datos.at(-1)![0]).toBe("TOTAL GENERAL");
  });

  it("los subtotales suman exactamente lo de abajo", () => {
    const neto = t.cabeceras.indexOf("Neto");
    expect(txt(t.datos[fila("Subtotal Administracion")][neto])).toBe("L 38,000.00");
    expect(txt(t.datos[fila("Subtotal PAGSA MAYOREO")][neto])).toBe("L 53,000.00");
    expect(txt(t.datos[fila("Subtotal PAGSA TEGUCIGALPA")][neto])).toBe("L 55,000.00");
    expect(txt(t.datos[fila("Subtotal NOMINA CONFIDENCIAL")][neto])).toBe("L 108,000.00");
    expect(txt(t.datos.at(-1)![neto])).toBe("L 108,000.00");
    expect(t.datos[fila("Subtotal PAGSA MAYOREO")][1]).toBe("3 empleado(s)");
  });

  it("ya no repite la sucursal como columna: es un nivel del árbol", () => {
    expect(t.cabeceras).not.toContain("Sucursal");
  });
});

describe("resumen de planilla en árbol", () => {
  const t = tablaResumenPlanilla(LINEAS);

  it("una fila por nivel con sus totales, cada nivel antes de su contenido", () => {
    expect(t.datos.map((f, i) => txt(`${"  ".repeat(t.filas[i].nivel)}${f[0]} ${f[1]} ${f[4]}`))).toEqual([
      "NOMINA CONFIDENCIAL 6 L 108,000.00",
      "  PAGSA MAYOREO 3 L 53,000.00",
      "    Administracion 2 L 38,000.00",
      "    Ventas 1 L 15,000.00",
      "  PAGSA TEGUCIGALPA 3 L 55,000.00",
      "    Administracion 2 L 39,000.00",
      "    Ventas 1 L 16,000.00",
      "TOTAL GENERAL 6 L 108,000.00",
    ]);
    expect(t.filas.map((f) => f.tipo)).toEqual(["subtotal", "subtotal", "detalle", "detalle", "subtotal", "detalle", "detalle", "total"]);
  });

  it("sin líneas no inventa un total", () => {
    expect(tablaResumenPlanilla([]).datos).toEqual([]);
  });
});

describe("dónde estaba la persona al pagarse", () => {
  const empleado = { sucursal: { id: "s2", nombre: "Actual" }, departamento: { id: "d2", nombre: "Depto actual", division: { id: "v2", nombre: "Div actual" } } };

  it("usa la ubicación guardada en la línea aunque la persona se haya movido", () => {
    const u = ubicacionDeLinea({ sucursal: CONF, division: MAY, departamento: { id: "d1", nombre: "Ventas" }, empleado }, true);
    expect([u.sucursal.nombre, u.division?.nombre, u.departamento.nombre]).toEqual(["NOMINA CONFIDENCIAL", "PAGSA MAYOREO", "Ventas"]);
  });

  it("en una línea anterior a esas columnas, usa la ubicación actual", () => {
    const u = ubicacionDeLinea({ sucursal: null, division: null, departamento: null, empleado }, true);
    expect([u.sucursal.nombre, u.division?.nombre, u.departamento.nombre]).toEqual(["Actual", "Div actual", "Depto actual"]);
  });

  it("con las divisiones apagadas no hay división", () => {
    expect(ubicacionDeLinea({ sucursal: CONF, division: MAY, departamento: { id: "d1", nombre: "Ventas" }, empleado }, false).division).toBeNull();
  });
});
