import { describe, it, expect } from "vitest";
import { Money } from "@/lib/payroll/money";
import type { PartidaContable, PartidaPorCentroCosto } from "@/lib/payroll/partida-contable";
import { construirAsiento, memoDesdePlantilla, referenciasDe, truncar, type MapeoSap, type OpcionesAsiento } from "./asiento";

const m = (v: number | string) => new Money(v);

/** Partida consolidada mínima: gasto de sueldos contra IHSS por pagar y neto. */
const partida: PartidaContable = {
  lineas: [
    { clave: "sueldos", cuenta: "610201", nombre: "Sueldos y salarios", debe: m(10000), haber: m(0) },
    { clave: "ihssPorPagar", cuenta: "211101", nombre: "IHSS por pagar", debe: m(0), haber: m(500) },
    { clave: "sueldosPorPagar", cuenta: "2111", nombre: "Sueldos por pagar", debe: m(0), haber: m(9500) },
    { clave: "isrPorPagar", cuenta: "211103", nombre: "ISR por pagar", debe: m(0), haber: m(0) },
  ],
  totalDebe: m(10000),
  totalHaber: m(10000),
  cuadra: true,
  diferencia: m(0),
  anomalias: [],
} as unknown as PartidaContable;

const mapeo: MapeoSap = {
  porClave: {
    sueldos: { acctCode: "_SYS00000000001", nombre: "Sueldos", codigoLocal: "610201" },
    ihssPorPagar: { acctCode: "_SYS00000000002", nombre: "IHSS por pagar", codigoLocal: "211101" },
    sueldosPorPagar: { acctCode: "_SYS00000000003", nombre: "Sueldos por pagar", codigoLocal: "2111" },
  },
  centros: {
    c1: { codigo: "PROD", nombre: "Producción", costingCode: "PROD", projectCode: null },
    c2: { codigo: "ADM", nombre: "Administración", costingCode: null, projectCode: null },
  },
};

const opciones: OpcionesAsiento = {
  planillaId: "cmf0abcdef1234567890abcde",
  tipoPlanilla: "QUINCENAL",
  empresa: "Empresa de Prueba S. de R.L.",
  fechaInicio: new Date("2026-09-16T00:00:00Z"),
  fechaFin: new Date("2026-09-30T00:00:00Z"),
  fechaPago: new Date("2026-10-02T00:00:00Z"),
  fechaContable: "PAGO",
  porCentroCosto: false,
  dimensionCentro: 1,
  codigoTransaccion: "NOM",
  serie: null,
  memoPlantilla: "Planilla {tipo} {desde} al {hasta}",
  longitudes: { memo: 50, lineMemo: 50, referencia: 100 },
};

describe("construirAsiento", () => {
  it("convierte la partida en JournalEntryLines con cuentas de SAP, fechas y referencias", () => {
    const r = construirAsiento(partida, mapeo, opciones);
    expect(r.errores).toEqual([]);
    expect(r.payload).not.toBeNull();
    const p = r.payload!;
    expect(p.ReferenceDate).toBe("2026-10-02");
    expect(p.DueDate).toBe("2026-10-02");
    expect(p.TaxDate).toBe("2026-09-30");
    expect(p.Memo).toBe("Planilla Quincenal 16/09/2026 al 30/09/2026");
    expect(p.Reference).toBe("NOM-QUINCENAL-2026-09-30");
    expect(p.Reference2).toBe("cmf0abcdef1234567890abcde");
    expect(p.TransactionCode).toBe("NOM");
    expect(p.Series).toBeUndefined();
    // La línea en cero (ISR) no viaja.
    expect(p.JournalEntryLines).toEqual([
      { AccountCode: "_SYS00000000001", Debit: 10000, Credit: 0, LineMemo: "Sueldos y salarios" },
      { AccountCode: "_SYS00000000002", Debit: 0, Credit: 500, LineMemo: "IHSS por pagar" },
      { AccountCode: "_SYS00000000003", Debit: 0, Credit: 9500, LineMemo: "Sueldos por pagar" },
    ]);
    expect(r.totalDebe).toBe(10000);
    expect(r.totalHaber).toBe(10000);
  });

  it("usa el fin del período como fecha contable cuando se pide, o cuando no hay fecha de pago", () => {
    expect(construirAsiento(partida, mapeo, { ...opciones, fechaContable: "FIN_PERIODO" }).payload?.ReferenceDate).toBe("2026-09-30");
    const r = construirAsiento(partida, mapeo, { ...opciones, fechaPago: null });
    expect(r.payload?.ReferenceDate).toBe("2026-09-30");
    expect(r.avisos.some((a) => /no tiene fecha de pago/.test(a))).toBe(true);
  });

  it("sin cuenta de SAP para un concepto: no hay payload y el error nombra el concepto", () => {
    const sinIhss: MapeoSap = { ...mapeo, porClave: { ...mapeo.porClave, ihssPorPagar: { acctCode: null, nombre: "IHSS por pagar", codigoLocal: "211101" } } };
    const r = construirAsiento(partida, sinIhss, opciones);
    expect(r.payload).toBeNull();
    expect(r.errores[0]).toMatch(/Conceptos sin cuenta en SAP: IHSS por pagar \(211101\)/);
  });

  it("una partida que no cuadra no se envía", () => {
    const r = construirAsiento({ ...partida, cuadra: false, diferencia: m("0.01") }, mapeo, opciones);
    expect(r.payload).toBeNull();
    expect(r.errores[0]).toMatch(/no cuadra/);
  });

  it("el reverso invierte Debe y Haber y lleva referencia propia", () => {
    const r = construirAsiento(partida, mapeo, { ...opciones, reverso: true });
    const p = r.payload!;
    expect(p.JournalEntryLines[0]).toMatchObject({ Debit: 0, Credit: 10000, LineMemo: "Reverso: Sueldos y salarios" });
    expect(p.JournalEntryLines[1]).toMatchObject({ Debit: 500, Credit: 0 });
    expect(p.Reference).toBe("NOM-QUINCENAL-2026-09-30-R");
    expect(p.Reference2).toBe("cmf0abcdef1234567890abcde-R");
    expect(p.Memo.startsWith("Reverso Planilla")).toBe(true);
  });

  it("recorta memo, memo de línea y referencias a lo que admite el servidor", () => {
    const r = construirAsiento(partida, mapeo, { ...opciones, longitudes: { memo: 10, lineMemo: 6, referencia: 12 } });
    const p = r.payload!;
    expect(p.Memo).toBe("Planilla Q");
    expect(p.JournalEntryLines[0].LineMemo).toBe("Sueldo");
    expect(p.Reference).toBe("NOM-QUINCENA");
    expect(p.Reference2).toBe("cmf0abcdef12");
  });

  describe("por centro de costo", () => {
    const porCentro: PartidaPorCentroCosto = {
      gastoPorCentro: [
        { clave: "sueldos", cuenta: "610201", nombre: "Sueldos y salarios", debe: m(6000), haber: m(0), centroCostoId: "c1", centroCodigo: "PROD", centroNombre: "Producción" },
        { clave: "sueldos", cuenta: "610201", nombre: "Sueldos y salarios", debe: m(4000), haber: m(0), centroCostoId: "c2", centroCodigo: "ADM", centroNombre: "Administración" },
      ],
      pasivos: [
        { clave: "ihssPorPagar", cuenta: "211101", nombre: "IHSS por pagar", debe: m(0), haber: m(500) },
        { clave: "sueldosPorPagar", cuenta: "2111", nombre: "Sueldos por pagar", debe: m(0), haber: m(9500) },
      ],
      totalesPorCentro: [],
      totalGasto: m(10000),
      totalPasivos: m(10000),
      conciliado: true,
      diferenciaConciliacion: m(0),
      anomalias: [],
    };

    it("pone el CostingCode de la dimensión elegida sólo en las líneas de gasto", () => {
      const conAdm: MapeoSap = { ...mapeo, centros: { ...mapeo.centros, c2: { ...mapeo.centros.c2, costingCode: "ADM", projectCode: "P-01" } } };
      const r = construirAsiento(porCentro, conAdm, { ...opciones, porCentroCosto: true, dimensionCentro: 2 });
      expect(r.errores).toEqual([]);
      const l = r.payload!.JournalEntryLines;
      expect(l[0]).toMatchObject({ AccountCode: "_SYS00000000001", Debit: 6000, CostingCode2: "PROD" });
      expect(l[1]).toMatchObject({ Debit: 4000, CostingCode2: "ADM", ProjectCode: "P-01" });
      expect(l[0]).not.toHaveProperty("CostingCode");
      expect(l[2]).not.toHaveProperty("CostingCode2");
      expect(r.totalDebe).toBe(10000);
    });

    it("un centro sin código en SAP o un empleado sin centro detienen el envío", () => {
      const r = construirAsiento(porCentro, mapeo, { ...opciones, porCentroCosto: true });
      expect(r.payload).toBeNull();
      expect(r.errores[0]).toMatch(/ADM sin código en SAP/);

      const sinCentro = { ...porCentro, gastoPorCentro: [{ ...porCentro.gastoPorCentro[0], centroCostoId: null, centroCodigo: "SIN-CENTRO", debe: m(10000) }] };
      const r2 = construirAsiento(sinCentro, mapeo, { ...opciones, porCentroCosto: true });
      expect(r2.errores[0]).toMatch(/empleados sin centro de costo asignado/);
    });

    it("si el desglose no concilia con el consolidado, no se envía", () => {
      const r = construirAsiento({ ...porCentro, conciliado: false, diferenciaConciliacion: m("0.02") }, mapeo, { ...opciones, porCentroCosto: true });
      expect(r.payload).toBeNull();
      expect(r.errores[0]).toMatch(/no concilia/);
    });
  });
});

describe("ayudas", () => {
  it("memoDesdePlantilla sustituye las variables", () => {
    expect(memoDesdePlantilla("{empresa}: {tipo} {desde}-{hasta}", opciones)).toBe("Empresa de Prueba S. de R.L.: Quincenal 16/09/2026-30/09/2026");
  });
  it("referenciasDe y truncar", () => {
    expect(referenciasDe(opciones)).toEqual({ Reference: "NOM-QUINCENAL-2026-09-30", Reference2: "cmf0abcdef1234567890abcde" });
    expect(truncar("abcdef", 3)).toBe("abc");
    expect(truncar("ab", 3)).toBe("ab");
  });
});
