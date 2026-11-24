import { describe, it, expect } from "vitest";
import { armarTablero, columnasDelTablero, encabezadoDe, type PlanillaDelTablero } from "@/lib/payroll/tablero-planillas";
import { avisarDelEnCurso, periodoAnterior } from "@/lib/payroll/pendientes-generar-bd";

const Q = "QUINCENAL" as const;
let n = 0;
const pl = (desde: string, hasta: string, divisionId: string, division: string, estado: PlanillaDelTablero["estado"] = "PAGADA", neto = 1000): PlanillaDelTablero => ({
  id: `p${++n}`, tipo: Q, desde, hasta, estado, neto,
  empresaId: "e1", sucursalId: "g1", divisionId, departamentoId: null, grupo: "Grupo Uno", division, departamento: null,
});

describe("tablero sucursal × período (fase 3, 2026-11-24)", () => {
  it("los encabezados se leen cortos", () => {
    expect(encabezadoDe({ tipo: Q, desde: "2026-11-16", hasta: "2026-11-30" })).toEqual({ titulo: "2.ª quincena", sub: "nov. 2026" });
    expect(encabezadoDe({ tipo: Q, desde: "2026-09-01", hasta: "2026-09-15" })).toEqual({ titulo: "1.ª quincena", sub: "sept. 2026" });
    expect(encabezadoDe({ tipo: "MENSUAL", desde: "2026-11-01", hasta: "2026-11-30" })).toEqual({ titulo: "Noviembre", sub: "2026" });
    expect(encabezadoDe({ tipo: "SEMANAL", desde: "2026-11-16", hasta: "2026-11-22" })).toEqual({ titulo: "Semana del 16", sub: "nov. 2026" });
    expect(encabezadoDe({ tipo: Q, desde: "2026-11-03", hasta: "2026-11-17" })).toEqual({ titulo: "Del 3 al 17", sub: "nov. 2026" });
  });

  it("las columnas: los seis más recientes, del más antiguo al más reciente, con el de hoy si se pide", () => {
    const ps = ["01", "16"].flatMap((d) => ["07", "08", "09", "10"].map((m) => ({ tipo: Q, desde: `2026-${m}-${d}`, hasta: `2026-${m}-${d === "01" ? "15" : "28"}` })));
    const cols = columnasDelTablero(ps, { tipo: Q, desde: "2026-11-01", hasta: "2026-11-15" });
    expect(cols.map((c) => c.desde)).toEqual(["2026-08-16", "2026-09-01", "2026-09-16", "2026-10-01", "2026-10-16", "2026-11-01"]);
    expect(columnasDelTablero(ps.slice(0, 2), null).map((c) => c.desde)).toEqual(["2026-07-01", "2026-08-01"]);
  });

  it("cada sucursal en su fila; su planilla, «Falta» o nada; la anulada sólo si no hay otra", () => {
    const per = [{ tipo: Q, desde: "2026-11-01", hasta: "2026-11-15" }, { tipo: Q, desde: "2026-11-16", hasta: "2026-11-30" }];
    const planillas = [
      pl("2026-11-01", "2026-11-15", "dN", "Norte", "PAGADA", 100.1),
      pl("2026-11-01", "2026-11-15", "dS", "Sur", "ANULADA", 50),
      pl("2026-11-01", "2026-11-15", "dS", "Sur", "APROBADA", 200.2),
      pl("2026-11-16", "2026-11-30", "dN", "Norte", "BORRADOR", 300),
      pl("2026-11-16", "2026-11-30", "dC", "Centro", "ANULADA", 70),
      pl("2026-10-16", "2026-10-31", "dX", "Fuera", "PAGADA", 9),
    ];
    const faltan = { "QUINCENAL|2026-11-16|2026-11-30": [{ empresaId: "e1", sucursalId: "g1", divisionId: "dS", grupo: "Grupo Uno", nombre: "Sur", empleados: 4 }] };
    const t = armarTablero(per, planillas, faltan, "2026-11-24");
    expect(t.filas.map((f) => f.nombre)).toEqual(["Centro", "Norte", "Sur"]);
    const sur = t.filas.find((f) => f.nombre === "Sur")!;
    expect(sur.celdas[0]).toMatchObject({ tipo: "planilla", estado: "APROBADA" });
    expect(sur.celdas[1]).toEqual({ tipo: "falta", empleados: 4, unidad: "e1|g1|dS" });
    const centro = t.filas.find((f) => f.nombre === "Centro")!;
    expect(centro.celdas.map((c) => c.tipo)).toEqual(["vacia", "planilla"]);
    expect(t.columnas.map((c) => [c.titulo, c.enCurso, c.neto, c.faltan])).toEqual([["1.ª quincena", false, 300.3, 0], ["2.ª quincena", true, 300, 1]]);
  });

  it("con varios grupos, cada fila lleva el suyo", () => {
    const per = [{ tipo: Q, desde: "2026-11-01", hasta: "2026-11-15" }];
    const otro = { ...pl("2026-11-01", "2026-11-15", "dA", "Centro"), sucursalId: "g2", grupo: "Grupo Dos" };
    const t = armarTablero(per, [pl("2026-11-01", "2026-11-15", "dN", "Norte"), otro], {}, "2026-11-24");
    expect(t.filas.map((f) => f.nombre)).toEqual(["Grupo Dos / Centro", "Grupo Uno / Norte"]);
  });
});

describe("avisos de Inicio: qué ya debería estar generado", () => {
  it("el período anterior", () => {
    expect(periodoAnterior({ tipo: Q, desde: "2026-11-16", hasta: "2026-11-30" })).toEqual({ tipo: Q, desde: "2026-11-01", hasta: "2026-11-15" });
    expect(periodoAnterior({ tipo: Q, desde: "2026-12-01", hasta: "2026-12-15" })).toEqual({ tipo: Q, desde: "2026-11-16", hasta: "2026-11-30" });
    expect(periodoAnterior({ tipo: "MENSUAL", desde: "2026-01-01", hasta: "2026-01-31" })).toEqual({ tipo: "MENSUAL", desde: "2025-12-01", hasta: "2025-12-31" });
  });

  it("el período en curso: en sus últimos días, o si ya se generó para unas sucursales y no para otras", () => {
    const p = { tipo: Q, desde: "2026-11-16", hasta: "2026-11-30" };
    expect(avisarDelEnCurso(p, "2026-11-24", false)).toBe(false);
    expect(avisarDelEnCurso(p, "2026-11-26", false)).toBe(true);
    expect(avisarDelEnCurso(p, "2026-11-17", true)).toBe(true);
  });
});
