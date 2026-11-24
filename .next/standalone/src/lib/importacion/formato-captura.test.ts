import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { money, type Money } from "@/lib/payroll/money";
import { periodoDeNombreArchivo } from "@/lib/payroll/periodos-planilla";
import { columnasDelFormato, construirFormato, encabezadoDosLineas, nombreArchivoFormato, type DatosFormato } from "@/lib/importacion/formato-captura";
import { validarMontos, type ContextoMontos, type EstadoCelda, type OperacionHorasExtra, type OperacionMonto, type TipoColumna } from "@/lib/importacion/montos-periodo";
import type { ClaveRecargo, HorasFijadas, HorasPorRecargo } from "@/lib/payroll/horas-extra-periodo";
import { xlsxATexto } from "@/lib/importacion/xlsx";

const PERIODO = { tipo: "QUINCENAL" as const, desde: "2026-12-01", hasta: "2026-12-15" };
const T = (id: string, codigo: string, nombre: string, categoria: string): TipoColumna => ({ id, codigo, nombre, categoria });
const ISR = T("isr", "ISR-FIJO", "Retención de ISR fija por período", "IMPUESTO");
const AUDI = T("audi", "COOP-AUDI", "Cooperativa AUDI", "COOPERATIVA");
const BAT = T("bat", "PTMO-BANCATLAN", "Préstamo BANCATLAN", "VOLUNTARIA");
const VALES = T("vales", "VALES", "Vales", "ADELANTO");
const AFP = T("afp", "AFP-ATL", "AFP Atlántida", "AFP");

describe("encabezados en dos líneas, como la planilla de la empresa", () => {
  it("abrevia la primera palabra y deja el resto abajo", () => {
    expect(encabezadoDosLineas(AUDI)).toEqual(["Coop.", "AUDI"]);
    expect(encabezadoDosLineas(BAT)).toEqual(["Ptamo.", "BANCATLAN"]);
    expect(encabezadoDosLineas(AFP)).toEqual(["AFP", "Atlántida"]);
    expect(encabezadoDosLineas(VALES)).toEqual(["Vales", ""]);
    expect(encabezadoDosLineas(ISR)).toEqual(["Retención", "en la Fuente"]);
  });
});

describe("columnas del formato", () => {
  const tipos = [VALES, AFP, BAT, AUDI, ISR];
  it("sin formato guardado: el ISR primero y luego por categoría", () => {
    expect(columnasDelFormato(tipos, null).map((c) => `${c.tipo.codigo}${c.incluida ? "" : "-"}`)).toEqual(["ISR-FIJO", "COOP-AUDI", "PTMO-BANCATLAN", "VALES", "AFP-ATL"]);
  });
  it("lo guardado manda; lo oculto no va; un tipo nuevo va al final, incluido", () => {
    const r = columnasDelFormato([...tipos, T("nuevo", "CXC-X", "CxC X", "PRESTAMO")], { columnas: ["AFP-ATL", "COOP-AUDI", "NO-EXISTE"], ocultas: ["VALES", "ISR-FIJO"] });
    expect(r.map((c) => `${c.tipo.codigo}${c.incluida ? "" : "-"}`)).toEqual(["AFP-ATL", "COOP-AUDI", "ISR-FIJO-", "CXC-X", "PTMO-BANCATLAN", "VALES-"]);
  });
});

describe("el nombre del archivo", () => {
  it("lleva el período, que el importador reconoce, y la sucursal sin tildes", () => {
    const n = nombreArchivoFormato(PERIODO, "Pagsa San Pedro Sula / Ñ");
    expect(n).toBe("deducciones_quincenal_2026-12-01_al_2026-12-15_Pagsa-San-Pedro-Sula-N.xlsx");
    expect(periodoDeNombreArchivo(n)).toEqual(PERIODO);
  });
});

// ─── El libro ───────────────────────────────────────────────────────────────

const COLUMNAS = [ISR, AUDI, BAT, VALES, AFP];
const EMPLEADOS = {
  e1: { id: "e1", codigo: "010001", nombre: "Alba Luz Garcia Zuniga" },
  e2: { id: "e2", codigo: "010114", nombre: "rafael  acosta garcia" },
  e3: { id: "e3", codigo: "010003", nombre: "Julio Humberto Aragon Mejia" },
};
/** Lo que hay hoy: lo que debe salir en la celda y lo que, reimportado, no cambia nada. */
const HOY: Record<string, number> = { "e1|audi": 500, "e1|afp": 900, "e2|isr": 2500, "e3|bat": 1959.37 };

function datos(o: Partial<DatosFormato> = {}): DatosFormato {
  return {
    grupo: "Grupo PAGSA", sucursal: "Pagsa SPS", etiquetaSucursal: "Sucursal", periodo: PERIODO, columnas: COLUMNAS,
    departamentos: [
      // Desordenados a propósito: el orden lo pone quien llama (código del departamento y del empleado).
      { nombre: "Administracion", empleados: [EMPLEADOS.e1, EMPLEADOS.e2] },
      { nombre: "Ventas", empleados: [EMPLEADOS.e3] },
      { nombre: "Vacío", empleados: [] },
    ],
    monto: (e, t) => (HOY[`${e}|${t}`] ? money(HOY[`${e}|${t}`]) : null),
    ...o,
  };
}

function contexto(horas: ContextoMontos["horas"] = null): ContextoMontos {
  const estados = new Map<string, EstadoCelda>(
    Object.entries(HOY).map(([k, v]) => [k, { novedad: null, cadaPlanilla: money(v) as Money, otros: money(0) }]),
  );
  const empleados = new Map(Object.values(EMPLEADOS).map((e) => [e.codigo.toLowerCase(), {
    id: e.id, codigo: e.codigo, nombre: e.nombre, sucursalId: "s", departamentoId: "d", tipoPlanilla: "QUINCENAL" as const, cobra: true,
  }]));
  return { periodo: PERIODO, tipos: COLUMNAS, noImportables: new Map(), empleados, estados, planillas: new Map(), horas };
}

async function leerLibro(bytes: Uint8Array) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes as unknown as Parameters<typeof libro.xlsx.load>[0]);
  return libro;
}

describe("el formato de captura", () => {
  it("agrupa por departamento, con nombres en mayúsculas, subtotales y total de la sucursal", async () => {
    const hoja = (await leerLibro(await construirFormato(datos()))).getWorksheet("Deducciones")!;
    const texto = (r: number, c: number) => String(hoja.getCell(r, c).value ?? "");
    expect(texto(1, 1)).toBe("GRUPO PAGSA");
    expect(texto(2, 1)).toBe("Sucursal: Pagsa SPS");
    expect(texto(3, 1)).toMatch(/1\.ª quincena de diciembre de 2026/);
    expect([texto(6, 1), texto(7, 1), texto(6, 2), texto(7, 2), texto(6, 4)]).toEqual(["Código", "Empl.", "Nombre del", "Empleado", "Coop."]);
    expect([texto(8, 1), texto(8, 2)]).toEqual(["Depto. 01", "ADMINISTRACION"]);
    expect([texto(9, 1), texto(9, 2), texto(10, 2)]).toEqual(["010001", "ALBA LUZ GARCIA ZUNIGA", "RAFAEL ACOSTA GARCIA"]);
    expect(texto(11, 2)).toBe("Total Depto. 01");
    expect((hoja.getCell(11, 4).value as { formula: string }).formula).toBe("SUBTOTAL(9,D9:D10)");
    expect([texto(13, 1), texto(13, 2), texto(14, 1), texto(15, 2)]).toEqual(["Depto. 02", "VENTAS", "010003", "Total Depto. 02"]);
    // El departamento sin empleados no sale; el total de la sucursal suma todo sin contar los subtotales.
    expect(texto(17, 2)).toBe("Total Pagsa SPS");
    expect((hoja.getCell(17, 3).value as { formula: string }).formula).toBe("SUBTOTAL(9,C8:C16)");
    expect(hoja.getCell(9, 4).value).toBe(500);
    expect(hoja.getCell(10, 3).value).toBe(2500);
    expect(hoja.getCell(9, 3).value).toBeNull();
  });

  it("sólo los montos se pueden escribir; con validación; panel fijo e impresión en legal horizontal", async () => {
    const hoja = (await leerLibro(await construirFormato(datos()))).getWorksheet("Deducciones")!;
    expect((hoja as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet).toBe(true);
    expect(hoja.getCell(9, 4).protection?.locked).toBe(false);
    expect(hoja.getCell(9, 1).protection?.locked).not.toBe(false);
    expect(hoja.getCell(11, 4).protection?.locked).not.toBe(false);
    expect(hoja.getCell(9, 4).dataValidation).toMatchObject({ type: "decimal", operator: "between" });
    expect(hoja.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 7 });
    expect(hoja.pageSetup).toMatchObject({ orientation: "landscape", paperSize: 5, fitToWidth: 1 });
  });

  it("descargado y subido sin tocarlo, no cambia nada", async () => {
    const lectura = await xlsxATexto(await construirFormato(datos()));
    if (!lectura.ok) throw new Error(lectura.error);
    const r = validarMontos(lectura.texto, contexto(), () => true);
    expect(r.hoja).toMatchObject({ lineaCabecera: 6, dosFilas: true });
    expect(r.columnasLeidas.map((c) => `${c.codigo}|${c.por}`).sort()).toEqual(["AFP-ATL|NOMBRE", "COOP-AUDI|NOMBRE", "ISR-FIJO|NOMBRE", "PTMO-BANCATLAN|NOMBRE", "VALES|NOMBRE"]);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.incidencias).toEqual([]);
    expect(r.operaciones).toEqual([]);
    expect(r.sinCambio).toBe(4);
  });

  it("lo que se escribe en Excel, con los totales ya calculados, entra como montos del período", async () => {
    const libro = await leerLibro(await construirFormato(datos()));
    const hoja = libro.getWorksheet("Deducciones")!;
    hoja.getCell(9, 4).value = 750;   // 010001, Coop. AUDI: de 500 a 750
    hoja.getCell(14, 6).value = 300;  // 010003, Vales: nuevo
    hoja.getCell(10, 3).value = 0;    // 010114, ISR: no se retiene este período
    // Como al guardar en Excel: las fórmulas llevan su resultado.
    for (const [r, c] of [[11, 4], [15, 6], [17, 4]]) hoja.getCell(r, c).value = { formula: (hoja.getCell(r, c).value as { formula: string }).formula, result: 1 };
    const lectura = await xlsxATexto(new Uint8Array(await libro.xlsx.writeBuffer()));
    if (!lectura.ok) throw new Error(lectura.error);
    const r = validarMontos(lectura.texto, contexto(), () => true);
    const ops = r.operaciones as OperacionMonto[];
    expect(ops.map((o) => `${o.empleadoId}|${o.tipoDeduccionId}|${o.monto}`).sort()).toEqual(["e1|audi|750.00", "e2|isr|0.00", "e3|vales|300.00"]);
    // Las filas «Total» se ignoran sin aviso: dicen lo que son.
    expect(r.filasTotales).toBe(3);
    expect(r.incidencias).toEqual([]);
  });
});

// ─── Con las horas extra (pedido del 2026-11-23) ────────────────────────────

/** Hoy: e1 tiene 6 h al 25 % de los marcajes; e2, 8 h al 100 % fijadas para el período. */
const MARCAJES = new Map<string, HorasPorRecargo>([["e1", { diurnas: 6, mixtas: 0, nocturnas: 0, feriado: 0 }]]);
const FIJADAS = new Map<string, HorasFijadas>([["e2", { diurnas: null, mixtas: null, nocturnas: null, feriado: 8 }]]);
const horasHoy = (e: string, c: ClaveRecargo) => (FIJADAS.get(e)?.[c] ?? MARCAJES.get(e)?.[c] ?? 0) || null;

describe("el formato con las horas extra", () => {
  it("cuatro columnas de horas antes de las deducciones, con su código debajo y lo de hoy", async () => {
    const hoja = (await leerLibro(await construirFormato(datos({ horas: horasHoy })))).getWorksheet("Deducciones")!;
    const texto = (r: number, c: number) => {
      const v = hoja.getCell(r, c).value as unknown;
      return v && typeof v === "object" && "richText" in (v as object) ? (v as { richText: { text: string }[] }).richText.map((x) => x.text).join("") : String(v ?? "");
    };
    expect([3, 4, 5, 6].map((c) => texto(6, c))).toEqual(["Horas extra", "Horas extra", "Horas extra", "Horas extra"]);
    expect([3, 4, 5, 6].map((c) => texto(7, c))).toEqual(["25 %\n(HE-25)", "50 %\n(HE-50)", "75 %\n(HE-75)", "100 %\n(HE-100)"]);
    // Las deducciones empiezan después: el ISR en la 7.
    expect(texto(6, 7)).toBe("Retención");
    expect(texto(3, 1)).toMatch(/^Horas extra y deducciones/);
    expect(hoja.getCell(9, 3).value).toBe(6);    // 010001: 6 h al 25 % de los marcajes
    expect(hoja.getCell(10, 6).value).toBe(8);   // 010114: 8 h al 100 % fijadas
    expect(hoja.getCell(9, 8).value).toBe(500);  // la cooperativa de 010001, corrida a la derecha
    expect(hoja.getCell(9, 3).protection?.locked).toBe(false);
    expect(hoja.getCell(9, 3).dataValidation).toMatchObject({ type: "decimal", formulae: [0, 400] });
    expect((hoja.getCell(11, 3).value as { formula: string }).formula).toBe("SUBTOTAL(9,C9:C10)");
  });

  it("descargado y subido sin tocarlo, no cambia nada", async () => {
    const lectura = await xlsxATexto(await construirFormato(datos({ horas: horasHoy })));
    if (!lectura.ok) throw new Error(lectura.error);
    const r = validarMontos(lectura.texto, contexto({ fijadas: FIJADAS, marcajes: MARCAJES }), () => true);
    expect(r.columnasLeidas.filter((c) => c.codigo.startsWith("HE-")).map((c) => c.codigo)).toEqual(["HE-25", "HE-50", "HE-75", "HE-100"]);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.incidencias).toEqual([]);
    expect(r.operaciones).toEqual([]);
  });

  it("las horas escritas entran como horas extra del período; las deducciones, como siempre", async () => {
    const libro = await leerLibro(await construirFormato(datos({ horas: horasHoy })));
    const hoja = libro.getWorksheet("Deducciones")!;
    hoja.getCell(9, 3).value = 10;    // 010001, 25 %: de 6 (marcajes) a 10
    hoja.getCell(9, 4).value = 2.5;   // 010001, 50 %: nuevo
    hoja.getCell(10, 6).value = 0;    // 010114, 100 %: de 8 (fijadas) a 0, que es lo de sus marcajes: se quita lo fijado
    hoja.getCell(14, 5).value = 4;    // 010003, 75 %: nuevo
    hoja.getCell(14, 10).value = 300; // 010003, Vales: nuevo (columna 6 + 4 de horas)
    const lectura = await xlsxATexto(new Uint8Array(await libro.xlsx.writeBuffer()));
    if (!lectura.ok) throw new Error(lectura.error);
    const r = validarMontos(lectura.texto, contexto({ fijadas: FIJADAS, marcajes: MARCAJES }), () => true);
    const horas = (r.operaciones as Array<OperacionHorasExtra | OperacionMonto>).filter((o): o is OperacionHorasExtra => o.clase === "HORAS_EXTRA");
    expect(horas.map((o) => `${o.empleadoId}|${JSON.stringify(o.horas)}`)).toEqual([
      'e1|{"diurnas":"10.00","mixtas":"2.50"}',
      'e2|{"feriado":null}',
      'e3|{"nocturnas":"4.00"}',
    ]);
    const montos = (r.operaciones as Array<OperacionHorasExtra | OperacionMonto>).filter((o): o is OperacionMonto => o.clase === "MONTO_PERIODO");
    expect(montos.map((o) => `${o.empleadoId}|${o.tipoDeduccionId}|${o.monto}`)).toEqual(["e3|vales|300.00"]);
    expect(r.previsualizacion.find((p) => p.referencia.startsWith("010001"))?.cambios).toEqual(["25 %: 6 h → 10 h", "50 %: — → 2.5 h"]);
    expect(r.incidencias).toEqual([]);
  });

  it("más de 4 horas extra por día en el período se avisa (puede ser un error de tecleo)", async () => {
    const libro = await leerLibro(await construirFormato(datos({ horas: horasHoy })));
    libro.getWorksheet("Deducciones")!.getCell(9, 3).value = 61; // 15 días × 4 = 60
    const lectura = await xlsxATexto(new Uint8Array(await libro.xlsx.writeBuffer()));
    if (!lectura.ok) throw new Error(lectura.error);
    const r = validarMontos(lectura.texto, contexto({ fijadas: FIJADAS, marcajes: MARCAJES }), () => true);
    expect(r.incidencias.map((i) => `${i.severidad}: ${i.mensaje}`)).toEqual([expect.stringMatching(/^AVISO: 010001 queda con 61 h extra en 15 días: pasa de 4 por día/)]);
    expect(r.operaciones).toHaveLength(1);
  });
});
