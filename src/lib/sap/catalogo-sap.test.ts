import { describe, it, expect } from "vitest";
import { construirCatalogoDesdeSap, reasignarMapeos, type CuentaSapCompleta, type FilaCatalogoSap } from "./catalogo-sap";

/** Plan segmentado de B1: Code interno `_SYS…`, FormatCode visible. */
const plan: CuentaSapCompleta[] = [
  { Code: "100000000000000", Name: "Activo", FormatCode: "100000000000000", ActiveAccount: "tNO", FatherAccountKey: null, AccountLevel: 1, AccountType: "at_Other" },
  { Code: "200000000000000", Name: "Pasivo", FormatCode: "200000000000000", ActiveAccount: "tNO", FatherAccountKey: null, AccountLevel: 1, AccountType: "at_Other" },
  { Code: "600000000000000", Name: "Gastos", FormatCode: "600000000000000", ActiveAccount: "tNO", FatherAccountKey: null, AccountLevel: 1, AccountType: "at_Expenses" },
  { Code: "_SYS00000000010", Name: "Gastos de personal", FormatCode: "6102", ActiveAccount: "tNO", FatherAccountKey: "600000000000000", AccountLevel: 2, AccountType: "at_Expenses" },
  { Code: "_SYS00000000011", Name: "Sueldos y salarios", FormatCode: "6102-01", ActiveAccount: "tYES", FatherAccountKey: "_SYS00000000010", AccountLevel: 3, AccountType: "at_Expenses" },
  { Code: "_SYS00000000012", Name: "Horas extra", FormatCode: "6102-02", ActiveAccount: "tYES", FatherAccountKey: "_SYS00000000010", AccountLevel: 3, AccountType: "at_Expenses", FrozenFor: "tYES" },
  { Code: "_SYS00000000020", Name: "Retenciones por pagar", FormatCode: "2103", ActiveAccount: "tNO", FatherAccountKey: "200000000000000", AccountLevel: 2, AccountType: "at_Other" },
  { Code: "_SYS00000000021", Name: "IHSS por pagar", FormatCode: "2103-01", ActiveAccount: "tYES", FatherAccountKey: "_SYS00000000020", AccountLevel: 3, AccountType: "at_Other" },
  { Code: "_SYS00000000030", Name: "Préstamos a empleados", FormatCode: "1114-01", ActiveAccount: "tYES", FatherAccountKey: "100000000000000", AccountLevel: 2, AccountType: "at_Other" },
];

describe("construirCatalogoDesdeSap", () => {
  const r = construirCatalogoDesdeSap(plan);
  const por = (codigo: string) => r.filas.find((f) => f.codigo === codigo) as FilaCatalogoSap;

  it("usa el código visible como código local y el interno como sapAcctCode", () => {
    expect(por("6102-01")).toMatchObject({ sapAcctCode: "_SYS00000000011", nombre: "Sueldos y salarios", padreCodigo: "6102", nivel: 3 });
    expect(por("6102")).toMatchObject({ sapAcctCode: "_SYS00000000010", padreCodigo: "600000000000000", esDetalle: false });
  });

  it("deduce el tipo NIIF del cajón raíz y la naturaleza del tipo", () => {
    expect(por("6102-01")).toMatchObject({ tipo: "GASTO", naturaleza: "DEUDORA" });
    expect(por("2103-01")).toMatchObject({ tipo: "PASIVO", naturaleza: "ACREEDORA" });
    expect(por("1114-01")).toMatchObject({ tipo: "ACTIVO", naturaleza: "DEUDORA" });
    expect(por("200000000000000")).toMatchObject({ tipo: "PASIVO", esDetalle: false, padreCodigo: null, nivel: 1 });
  });

  it("ActiveAccount tYES es cuenta de detalle; tNO es título; FrozenFor marca inactiva", () => {
    expect(por("6102-01").esDetalle).toBe(true);
    expect(por("6102").esDetalle).toBe(false);
    expect(por("6102-02")).toMatchObject({ esDetalle: true, activa: false });
    expect(r.resumen).toMatchObject({ total: 9, detalle: 4, titulos: 5, inactivas: 1 });
    expect(r.resumen.porTipo).toMatchObject({ ACTIVO: 2, PASIVO: 3, GASTO: 4 });
    expect(r.avisos).toEqual([]);
  });

  it("una cuenta con hijas es título aunque SAP la marque activa", () => {
    const raro = construirCatalogoDesdeSap([
      ...plan,
      { Code: "_SYS00000000099", Name: "Hija de sueldos", FormatCode: "6102-01-1", ActiveAccount: "tYES", FatherAccountKey: "_SYS00000000011", AccountLevel: 4 },
    ]);
    expect(raro.filas.find((f) => f.codigo === "6102-01")?.esDetalle).toBe(false);
  });

  it("sin cajón reconocible cae al AccountType y lo avisa; sin FormatCode usa el Code", () => {
    const r2 = construirCatalogoDesdeSap([
      { Code: "X1", Name: "Raíz rara", ActiveAccount: "tNO" },
      { Code: "X1-1", Name: "Ingreso suelto", ActiveAccount: "tYES", FatherAccountKey: "X1", AccountType: "at_Revenues" },
    ]);
    expect(r2.filas.find((f) => f.codigo === "X1-1")).toMatchObject({ tipo: "INGRESO", padreCodigo: "X1", nivel: 2 });
    expect(r2.avisos.some((a) => /No se reconoció el cajón de X1-1/.test(a))).toBe(true);
  });

  it("dos cuentas con el mismo código visible no chocan y queda aviso", () => {
    const r3 = construirCatalogoDesdeSap([
      plan[2],
      { Code: "_SYSA", Name: "A", FormatCode: "6109", ActiveAccount: "tYES", FatherAccountKey: "600000000000000", AccountLevel: 2 },
      { Code: "_SYSB", Name: "B", FormatCode: "6109", ActiveAccount: "tYES", FatherAccountKey: "600000000000000", AccountLevel: 2 },
    ]);
    expect(r3.filas.map((f) => f.codigo).sort()).toEqual(["600000000000000", "6109", "6109~_SYSB"]);
    expect(r3.avisos[0]).toMatch(/comparten el código visible 6109/);
  });
});

describe("reasignarMapeos", () => {
  const { filas } = construirCatalogoDesdeSap(plan);

  it("reengancha por código de SAP primero y por código visible después", () => {
    const r = reasignarMapeos(
      [
        { clave: "sueldos", codigo: "610201", sapAcctCode: "_SYS00000000011" },
        { clave: "ihssPorPagar", codigo: "2103-01", sapAcctCode: null },
      ],
      filas
    );
    expect(r.asignaciones).toEqual([
      { clave: "sueldos", codigo: "6102-01" },
      { clave: "ihssPorPagar", codigo: "2103-01" },
    ]);
    expect(r.sinCuenta).toEqual([]);
  });

  it("deja sin cuenta lo que no existe, es de título, está inactivo o no es del tipo admitido", () => {
    const r = reasignarMapeos(
      [
        { clave: "isrPorPagar", codigo: "210307", sapAcctCode: null },
        { clave: "horasExtra", codigo: "6102", sapAcctCode: null },
        { clave: "sueldosPorPagar", codigo: "6102-02", sapAcctCode: null },
        { clave: "rapPorPagar", codigo: "6102-01", sapAcctCode: null },
        { clave: "sueldos", codigo: null, sapAcctCode: null },
      ],
      filas
    );
    expect(r.asignaciones).toEqual([]);
    expect(r.sinCuenta.map((s) => [s.clave, s.motivo])).toEqual([
      ["isrPorPagar", "la cuenta 210307 no existe en SAP"],
      ["horasExtra", "6102 es cuenta de título en SAP"],
      ["sueldosPorPagar", "6102-02 está inactiva en SAP"],
      ["rapPorPagar", "6102-01 es de tipo GASTO, no admitido para este concepto"],
      ["sueldos", "no tenía cuenta asignada"],
    ]);
  });

  it("ignora claves que el motor no conoce", () => {
    expect(reasignarMapeos([{ clave: "inventada", codigo: "6102-01", sapAcctCode: null }], filas)).toEqual({ asignaciones: [], sinCuenta: [] });
  });
});
