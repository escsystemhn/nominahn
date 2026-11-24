import { describe, it, expect } from "vitest";
import { ordenarTipos } from "@/lib/deducciones/orden-columnas";
import { columnasDeDeducciones } from "@/lib/payroll/deducciones-de-linea";
import { columnasDetalle, type LineaPlanilla } from "@/lib/reportes/planilla-estructura";
import { CERO, money, type Money } from "@/lib/payroll/money";

const mapa = (o: Record<string, number>) => new Map<string, Money>(Object.entries(o).map(([k, v]) => [k, money(v)]));

describe("el orden de las deducciones, el mismo en pantalla y al imprimir (pedido del 2026-11-23)", () => {
  const lineas = [mapa({ "Préstamo Atlántida": 2076.09, "Cooperativa Audi": 500 }), mapa({ "AFP Atlántida": 900, "Retención Seguro Médico": 1100, Préstamos: 300 })];

  it("sin orden elegido, por nombre (como antes); las categorías de las líneas viejas, al final", () => {
    expect(columnasDeDeducciones(lineas)).toEqual(["AFP Atlántida", "Cooperativa Audi", "Préstamo Atlántida", "Retención Seguro Médico", "Préstamos"]);
  });

  it("con orden elegido, ese; lo que no está en él, después y por nombre", () => {
    expect(columnasDeDeducciones(lineas, ["Cooperativa Audi", "Préstamo Atlántida", "Vales"])).toEqual(["Cooperativa Audi", "Préstamo Atlántida", "AFP Atlántida", "Retención Seguro Médico", "Préstamos"]);
  });

  it("para editarlo: los tipos en el orden que rige y los nuevos al final", () => {
    const tipos = [{ codigo: "AFP", nombre: "AFP Atlántida" }, { codigo: "COOP", nombre: "Cooperativa Audi" }, { codigo: "ATL", nombre: "Préstamo Atlántida" }, { codigo: "NUEVO", nombre: "Bono X" }];
    expect(ordenarTipos(tipos, ["ATL", "COOP", "NO-EXISTE"]).map((t) => t.codigo)).toEqual(["ATL", "COOP", "AFP", "NUEVO"]);
  });

  it("la planilla impresa usa el mismo orden", () => {
    const ubicacion = { sucursal: { id: "s", nombre: "S" }, division: null, departamento: { id: "d", nombre: "D" } };
    const l = (porTipo: Map<string, Money>): LineaPlanilla => ({
      empleadoId: "e", nombre: "N", ubicacion, dias: 15, salario: money(1000), horasExtra: CERO, otrosIngresos: CERO, devengado: money(1000),
      ihss: CERO, rap: CERO, isr: CERO, vecinal: CERO, porTipo, ausencias: CERO, incapacidad: CERO, deducciones: CERO, neto: money(1000), patronal: CERO,
    });
    const titulos = columnasDetalle(lineas.map(l), ["Retención Seguro Médico", "Préstamo Atlántida"]).map((c) => c.titulo);
    const deTipos = titulos.slice(titulos.indexOf("ISR") + 1, titulos.indexOf("Total deducciones"));
    expect(deTipos).toEqual(["Retención Seguro Médico", "Préstamo Atlántida", "AFP Atlántida", "Cooperativa Audi", "Préstamos"]);
  });
});
