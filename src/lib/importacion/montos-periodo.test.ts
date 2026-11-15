import { describe, it, expect } from "vitest";
import { money } from "@/lib/payroll/money";
import { PARAMETROS_DEFAULT } from "@/lib/payroll/calculos-hn";
import { conMontosDelPeriodo, MARCA_MONTO_PERIODO } from "@/lib/payroll/deducciones";
import {
  armarMatriz, decidirBaseRap, decidirCelda, estadosDelPeriodo, observacionMontoPeriodo, sugerirTiposNuevos, totalDeCelda, validarMontos,
  type ContextoMontos, type DeduccionParaEstado, type EmpleadoMatriz, type EstadoCelda, type OperacionMonto, type ResultadoMontos, type ContextoBaseRap,
} from "@/lib/importacion/montos-periodo";

/** Sólo los montos de deducción (sin las bases del RAP). */
const montosDe = (r: ResultadoMontos) => r.operaciones.filter((o): o is OperacionMonto => o.clase === "MONTO_PERIODO");

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const PERIODO = { tipo: "QUINCENAL" as const, desde: "2026-11-01", hasta: "2026-11-15" };
const OBS = observacionMontoPeriodo(PERIODO);

let n = 0;
const ded = (o: Partial<DeduccionParaEstado>): DeduccionParaEstado => ({
  id: `d${++n}`, empleadoId: "e1", tipoDeduccionId: "coop", monto: 500, saldo: null, cuotasMeses: null, cuotasPagadas: 0,
  fechaInicio: d("2026-01-01"), fechaFin: null, observacion: null, ...o,
});
const estado = (o: Partial<EstadoCelda>): EstadoCelda => ({ novedad: null, cadaPlanilla: money(0), otros: money(0), ...o });

describe("el monto del período reemplaza a la deducción de cada planilla del mismo tipo", () => {
  const fija = ded({ monto: 5274.39 });
  const prestamo = ded({ tipoDeduccionId: "coop", monto: 6000, saldo: 4500, cuotasMeses: 12, cuotasPagadas: 3 });
  const otraFija = ded({ tipoDeduccionId: "seguro", monto: 1000 });
  const novedad = ded({ monto: 5100, fechaInicio: d("2026-11-01"), fechaFin: d("2026-11-15"), observacion: OBS });

  it("sin monto del período no cambia nada", () => {
    expect(conMontosDelPeriodo([fija, prestamo, otraFija]).map((x) => x.id)).toEqual([fija.id, prestamo.id, otraFija.id]);
  });
  it("con monto del período: fuera la de cada planilla del tipo; el préstamo y los otros tipos siguen", () => {
    expect(conMontosDelPeriodo([fija, prestamo, otraFija, novedad]).map((x) => x.id)).toEqual([prestamo.id, otraFija.id, novedad.id]);
  });
  it("una deducción de cada planilla con fecha final pero sin la marca no reemplaza a nadie", () => {
    const conFin = ded({ monto: 100, fechaFin: d("2026-12-31"), observacion: "Cuota sindical" });
    expect(conMontosDelPeriodo([fija, conFin])).toHaveLength(2);
    expect(OBS.startsWith(MARCA_MONTO_PERIODO)).toBe(true);
  });
});

describe("estado de cada celda", () => {
  it("separa el monto del período, lo de cada planilla y lo que el archivo no cambia", () => {
    const e = estadosDelPeriodo([
      ded({ monto: 5274.39 }),
      ded({ monto: 6000, saldo: 6000, cuotasMeses: 12 }), // 500 por cuota
      ded({ monto: 5100, fechaInicio: d("2026-11-01"), fechaFin: d("2026-11-15"), observacion: OBS }),
    ], PERIODO).get("e1|coop")!;
    expect(e.novedad?.monto.toFixed(2)).toBe("5100.00");
    expect(e.cadaPlanilla.toFixed(2)).toBe("5274.39");
    expect(e.otros.toFixed(2)).toBe("500.00");
    expect(totalDeCelda(e).toFixed(2)).toBe("5600.00");
  });
  it("el monto de otro período que también cae aquí (uno mensual) cuenta como fijo y reemplaza a la de cada planilla", () => {
    const e = estadosDelPeriodo([
      ded({ monto: 1000 }),
      ded({ monto: 1800, fechaInicio: d("2026-11-01"), fechaFin: d("2026-11-30"), observacion: observacionMontoPeriodo({ desde: "2026-11-01", hasta: "2026-11-30" }) }),
    ], PERIODO).get("e1|coop")!;
    expect(e.novedad).toBeNull();
    expect(e.cadaPlanilla.toFixed(2)).toBe("0.00");
    expect(totalDeCelda(e).toFixed(2)).toBe("1800.00");
  });
});

describe("qué hacer con el valor nuevo de una celda", () => {
  it("igual a lo de hoy: nada", () => {
    expect(decidirCelda(estado({ cadaPlanilla: money(1000) }), money(1000)).accion).toBe("IGUAL");
    expect(decidirCelda(undefined, money(0)).accion).toBe("IGUAL");
  });
  it("nuevo en una celda vacía", () => {
    const r = decidirCelda(undefined, money(2076.09));
    expect(r).toMatchObject({ accion: "PONER" });
    if (r.accion === "PONER") expect(r.monto.toFixed(2)).toBe("2076.09");
  });
  it("cambia la de cada planilla sólo en este período", () => {
    const r = decidirCelda(estado({ cadaPlanilla: money(5274.39) }), money(5100));
    expect(r.accion).toBe("PONER");
    if (r.accion === "PONER") expect(r.monto.toFixed(2)).toBe("5100.00");
  });
  it("vacía con una de cada planilla: monto del período en cero, no se cobra este período", () => {
    const r = decidirCelda(estado({ cadaPlanilla: money(217) }), money(0));
    expect(r.accion).toBe("PONER");
    if (r.accion === "PONER") expect(r.monto.isZero()).toBe(true);
  });
  it("volver a lo de cada planilla quita el monto del período; vaciar un monto del período también", () => {
    expect(decidirCelda(estado({ novedad: { id: "n", monto: money(5100) }, cadaPlanilla: money(5274.39) }), money(5274.39)).accion).toBe("QUITAR");
    expect(decidirCelda(estado({ novedad: { id: "n", monto: money(300) } }), money(0)).accion).toBe("QUITAR");
  });
  it("con cuotas de préstamo del tipo: el monto nuevo se reparte encima, y no puede ser menor", () => {
    const e = estado({ otros: money(500) });
    const r = decidirCelda(e, money(700));
    if (r.accion !== "PONER") throw new Error(r.accion);
    expect(r.monto.toFixed(2)).toBe("200.00");
    const menor = decidirCelda(e, money(300));
    expect(menor.accion).toBe("ERROR");
    if (menor.accion === "ERROR") expect(menor.mensaje).toMatch(/no puede ser menor/);
  });
});

// ─── El archivo ─────────────────────────────────────────────────────────────

const TIPOS = [
  { id: "audi", codigo: "COOP-AUDI", nombre: "Cooperativa AUDI" },
  { id: "rap", codigo: "PTMO-RAP", nombre: "Préstamo RAP" },
  { id: "seg", codigo: "SEG-MED", nombre: "Seguro médico" },
];
const emp = (codigo: string, o: Partial<EmpleadoMatriz> = {}): EmpleadoMatriz => ({
  id: `id-${codigo}`, codigo, nombre: `Empleado ${codigo}`, sucursalId: "s1", departamentoId: "dp1", tipoPlanilla: "QUINCENAL", cobra: true, ...o,
});
function contexto(o: Partial<ContextoMontos> = {}): ContextoMontos {
  const empleados = new Map([["010001", emp("010001")], ["010122", emp("010122")], ["010130", emp("010130")], ["010999", emp("010999", { cobra: false })]]);
  const estados = new Map<string, EstadoCelda>([
    ["id-010001|audi", estado({ cadaPlanilla: money(500) })],
    ["id-010001|seg", estado({ cadaPlanilla: money(1000) })],
    ["id-010122|audi", estado({ novedad: { id: "nv", monto: money(5274.39) } })],
  ]);
  return { periodo: PERIODO, tipos: TIPOS, noImportables: new Map([["ihss", "«IHSS» es una deducción de ley: la calcula la planilla."]]), empleados, estados, planillas: new Map(), ...o };
}
const todos = () => true;
const CAB = "Codigo Empleado,Empleado,Departamento,Cooperativa AUDI (COOP-AUDI),Préstamo RAP (PTMO-RAP),Seguro médico (SEG-MED)";

describe("validar el archivo de montos del período", () => {
  it("el archivo tal cual se exportó no cambia nada", () => {
    const r = validarMontos([CAB, "010001,A,Adm,500.00,,1000.00", "010122,B,Adm,5274.39,,"].join("\n"), contexto(), todos);
    expect(r.operaciones).toHaveLength(0);
    expect(r.incidencias).toHaveLength(0);
    expect(r.sinCambio).toBe(3); // las tres celdas con monto; las vacías no se tocan
  });

  it("una celda vacía no cambia nada, y una fila vacía no se toca aunque sea de un inactivo o de un código que no existe", () => {
    const r = validarMontos([
      CAB,
      "010001,A,Adm,,,1000.00", // la cooperativa de cada planilla queda como está
      "010122,B,Adm,,,", // fila vacía: su monto del período sigue
      "010999,X,Adm,,,", // inactivo, sin montos: no es error
      "099999,Z,Adm,,,", // no existe, sin montos: no es error
    ].join("\n"), contexto(), todos);
    expect(r.incidencias).toEqual([]);
    expect(r.operaciones).toEqual([]);
    expect(r.sinMontos).toBe(3);
    expect(r.sinCambio).toBe(1);
  });

  it("igual, nuevo, cambia y se quita, como en la vista previa", () => {
    const r = validarMontos([
      CAB,
      "010001,A,Adm,500.00,,1000.00",     // igual
      "010122,B,Adm,5100,,",              // cambia
      "010130,C,Adm,,2076.09,",           // nuevo
    ].join("\n"), contexto(), todos);
    expect(r.incidencias.filter((i) => i.severidad === "ERROR")).toHaveLength(0);
    expect([r.nuevos, r.cambian, r.seQuitan]).toEqual([1, 1, 0]);
    expect(montosDe(r).map((o) => `${o.referencia}:${o.accion}:${o.monto}`)).toEqual([
      "010122 Empleado 010122, Cooperativa AUDI:PONER:5100.00",
      "010130 Empleado 010130, Préstamo RAP:PONER:2076.09",
    ]);
    expect(r.previsualizacion[0].cambios?.[0]).toMatch(/5,274\.39 → .*5,100\.00/);
  });

  it("un 0 en una de cada planilla se ve como «se quita» y avisa que es sólo este período", () => {
    const r = validarMontos([CAB, "010001,A,Adm,0,,1000.00"].join("\n"), contexto(), todos);
    expect(r.seQuitan).toBe(1);
    expect(r.previsualizacion[0]).toMatchObject({ accion: "QUITAR" });
    expect(r.previsualizacion[0].cambios?.join(" ")).toMatch(/no se cobra en este período; los L.*500\.00 de cada planilla vuelven en el siguiente/);
    expect(r.operaciones[0]).toMatchObject({ accion: "PONER", monto: "0.00" });
  });

  it("reconoce las columnas por el código o el nombre solo, y una columna borrada no se toca", () => {
    const r = validarMontos(["codigo,PTMO-RAP,seguro medico", "010001,100,1000"].join("\n"), contexto(), todos);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.operaciones).toHaveLength(1); // la cooperativa no viene: no se quita
    expect(montosDe(r)[0].tipoDeduccionId).toBe("rap");
  });

  it("acepta coma decimal y separador de miles en las celdas", () => {
    const r = validarMontos(["Codigo Empleado;Préstamo RAP (PTMO-RAP)", "010130;1.399,41"].join("\n"), contexto(), todos);
    expect(montosDe(r)[0].monto).toBe("1399.41");
  });

  it("errores con su línea: empleado inexistente, repetido, fuera de alcance, inactivo y monto ilegible", () => {
    const r = validarMontos([
      CAB,
      "XYZ,,,100,,",
      "010130,,,abc,,",
      "010130,,,50,,",
      "010130,,,60,,",
      "010999,,,70,,",
    ].join("\n"), contexto(), todos);
    const errores = r.incidencias.filter((i) => i.severidad === "ERROR").map((i) => `${i.linea}:${i.mensaje}`);
    expect(errores[0]).toMatch(/^2:No existe un empleado con código «XYZ»/);
    expect(errores[1]).toMatch(/^3:/);
    expect(errores.some((e) => /^5:El empleado ya viene en la línea 3/.test(e))).toBe(true);
    expect(errores.some((e) => /^6:El empleado no está activo/.test(e))).toBe(true);
    const fuera = validarMontos([CAB, "010130,,,50,,"].join("\n"), contexto(), () => false);
    expect(fuera.incidencias[0].mensaje).toMatch(/fuera de su alcance/);
  });

  it("una columna de ley se ignora con aviso; una que no existe se reporta como desconocida", () => {
    const r = validarMontos(["Codigo Empleado,IHSS,Bono X,Seguro médico (SEG-MED)", "010001,595.16,1,1000"].join("\n"), contexto(), todos);
    expect(r.incidencias.find((i) => i.columna === "IHSS")?.mensaje).toMatch(/de ley.*Se ignora/);
    expect(r.columnasDesconocidas).toEqual(["Bono X"]);
    expect(r.operaciones).toHaveLength(0);
  });

  it("sin código de empleado o sin columnas de deducción, no hay nada que leer", () => {
    expect(validarMontos("Empleado,Seguro médico\nA,100", contexto(), todos).incidencias[0].mensaje).toMatch(/Codigo Empleado/);
    expect(validarMontos("Codigo Empleado,Empleado\n010001,A", contexto(), todos).incidencias[0].mensaje).toMatch(/ninguna columna de deducción/);
  });

  it("planilla del período aprobada o pagada: error; en borrador o calculada: aviso de recalcular", () => {
    const cerrada = validarMontos([CAB, "010130,,,100,,"].join("\n"), contexto({ planillas: new Map([["id-010130", { estado: "PAGADA" }]]) }), todos);
    expect(cerrada.incidencias[0]).toMatchObject({ severidad: "ERROR" });
    expect(cerrada.incidencias[0].mensaje).toMatch(/pagada/);
    const borrador = validarMontos([CAB, "010130,,,100,,"].join("\n"), contexto({ planillas: new Map([["id-010130", { estado: "BORRADOR" }]]) }), todos);
    expect(borrador.operaciones).toHaveLength(1);
    expect(borrador.incidencias[0]).toMatchObject({ severidad: "AVISO" });
    expect(borrador.incidencias[0].mensaje).toMatch(/vuelva a calcularla/);
  });

  it("avisa cuando el empleado cobra en otro tipo de planilla", () => {
    const ctx = contexto();
    ctx.empleados.set("010130", emp("010130", { tipoPlanilla: "MENSUAL" }));
    const r = validarMontos([CAB, "010130,,,100,,"].join("\n"), ctx, todos);
    expect(r.incidencias.some((i) => i.severidad === "AVISO" && /planilla mensual/.test(i.mensaje))).toBe(true);
  });
});

describe("columnas que todavía no son tipos", () => {
  it("una columna renombrada que conserva «(CÓDIGO)» sigue siendo de ese tipo", () => {
    const r = validarMontos(["Codigo Empleado,Coop de la empresa (COOP-AUDI)", "010130,100"].join("\n"), contexto(), todos);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(montosDe(r)[0].tipoDeduccionId).toBe("audi");
  });

  it("propone crear las columnas con montos, con código y categoría, y no los totales ni las vacías", () => {
    const texto = [
      "Codigo Empleado,Coop ELGA,Ptmo BANCATLAN (PTMO-BAT),Total deducciones,Bono X,Seguro médico (SEG-MED)",
      "010001,5274.39,2076.09,9000,,1000",
      "010122,100,,100,,",
    ].join("\n");
    const r = validarMontos(texto, contexto(), todos);
    expect(r.columnasDesconocidas).toEqual(["Coop ELGA", "Ptmo BANCATLAN (PTMO-BAT)", "Total deducciones", "Bono X"]);
    const s = sugerirTiposNuevos(texto, r.columnasDesconocidas, ["COOP-AUDI", "COOP-ELGA"]);
    expect(s.map((t) => `${t.nombre}|${t.codigo}|${t.tipo}|${t.conMontos}|${t.crear}`)).toEqual([
      "Coop ELGA|COOP-ELGA-2|COOPERATIVA|2|true",
      "Ptmo BANCATLAN|PTMO-BAT|VOLUNTARIA|1|true",
      "Total deducciones|TOTAL-DEDUCCIONES|VOLUNTARIA|2|false",
      "Bono X|BONO-X|VOLUNTARIA|0|false",
    ]);
    expect(s[3].motivo).toMatch(/no trae montos/);
  });

  it("si ninguna columna es tipo todavía, el error dice que se pueden crear", () => {
    const r = validarMontos(["Codigo Empleado,Coop ELGA", "010001,100"].join("\n"), contexto(), todos);
    expect(r.incidencias.find((i) => i.severidad === "ERROR")?.mensaje).toMatch(/créelos/);
  });
});

describe("archivo exportado", () => {
  it("una fila por empleado; las columnas con montos primero; celdas vacías donde no hay nada", () => {
    const ctx = contexto();
    const { columnas, filas, total } = armarMatriz(
      [{ id: "id-010001", codigo: "010001", nombre: "A", departamento: "Adm" }, { id: "id-010130", codigo: "010130", nombre: "C", departamento: "Adm" }],
      TIPOS, ctx.estados,
    );
    expect(columnas.map((c) => c.etiqueta)).toEqual(["Codigo Empleado", "Empleado", "Departamento", "Cooperativa AUDI (COOP-AUDI)", "Seguro médico (SEG-MED)", "Préstamo RAP (PTMO-RAP)"]);
    expect(filas).toEqual([["010001", "A", "Adm", "500.00", "1000.00", ""], ["010130", "C", "Adm", "", "", ""]]);
    expect(total.toFixed(2)).toBe("1500.00");
    expect(columnas.slice(3).every((c) => c.formato === "monto")).toBe(true);
  });

  it("lo exportado vuelve a entrar sin cambios (ida y vuelta)", () => {
    const ctx = contexto();
    const { columnas, filas } = armarMatriz(
      [{ id: "id-010001", codigo: "010001", nombre: "A", departamento: "Adm" }, { id: "id-010122", codigo: "010122", nombre: "B", departamento: "Adm" }],
      TIPOS, ctx.estados,
    );
    const csv = [columnas.map((c) => c.etiqueta).join(","), ...filas.map((f) => f.join(","))].join("\n");
    const r = validarMontos(csv, ctx, todos);
    expect(r.operaciones).toHaveLength(0);
    expect(r.incidencias).toHaveLength(0);
  });
});

// ─── Base del RAP a mes vencido ─────────────────────────────────────────────

describe("columna «Base RAP (mes anterior)»", () => {
  const baseRap = (o: Partial<ContextoBaseRap> = {}): ContextoBaseRap => ({
    mes: "2026-11",
    regla: "ANTERIOR",
    // 010122 ya tiene base importada; 010001 sólo la de sus planillas de octubre.
    importadas: new Map([["id-010122", money(50000)]]),
    automaticas: new Map([["id-010001", money(30000)], ["id-010122", money(30000)]]),
    planillasMes: new Map(),
    parametros: PARAMETROS_DEFAULT,
    ...o,
  });
  const CABB = "Codigo Empleado,Empleado,Departamento,Base RAP (mes anterior)";

  it("decidir la celda: vacía vuelve a la del sistema; igual a la del sistema no se guarda", () => {
    expect(decidirBaseRap(null, money(30000), money(30000))).toEqual({ accion: "IGUAL" });
    expect(decidirBaseRap(null, money(30000), null)).toEqual({ accion: "IGUAL" });
    expect(decidirBaseRap(money(50000), money(30000), null)).toMatchObject({ accion: "QUITAR" });
    expect(decidirBaseRap(money(50000), money(30000), money(50000))).toEqual({ accion: "IGUAL" });
    expect(decidirBaseRap(null, money(30000), money(0))).toMatchObject({ accion: "PONER" });
  });

  it("un archivo sólo con la base vale: crea la nueva, y una fila vacía no toca la base importada", () => {
    const r = validarMontos([CABB, "010001,A,Adm,35000", "010122,B,Adm,", "010130,C,Adm,"].join("\n"), contexto({ baseRap: baseRap() }), todos);
    expect(r.incidencias.filter((i) => i.severidad === "ERROR")).toEqual([]);
    expect(r.operaciones.map((o) => `${o.clase}:${o.accion}:${o.despues}`)).toEqual(["BASE_RAP:PONER:35000.00"]);
    expect([r.nuevos, r.seQuitan, r.sinMontos]).toEqual([1, 0, 2]);
    // 35,000 − 11,903.13 = 23,096.87 → 346.45 de cada parte; Reserva 4 % = 1,400.
    expect(r.previsualizacion[0].cambios?.join(" ")).toMatch(/RAP L.*346\.45 del trabajador y L.*346\.45 del patrono, Reserva L.*1,400\.00/);
  });

  it("en una fila con montos, la base vacía vuelve a la del sistema", () => {
    const CABD = "Codigo Empleado,Empleado,Departamento,Cooperativa AUDI (COOP-AUDI),Base RAP (mes anterior)";
    const r = validarMontos([CABD, "010122,B,Adm,5274.39,"].join("\n"), contexto({ baseRap: baseRap() }), todos);
    expect(r.operaciones.map((o) => `${o.clase}:${o.accion}:${o.despues}`)).toEqual(["BASE_RAP:QUITAR:30000.00"]);
    expect(r.previsualizacion[0].cambios?.join(" ")).toMatch(/vuelve a la de las planillas de octubre/);
  });

  it("no deja cambiar la base si ya hay una planilla del mes aprobada, ni ponérsela a un inactivo", () => {
    const ctx = contexto({ baseRap: baseRap({ planillasMes: new Map([["id-010001", { estado: "APROBADA" as const }]]) }) });
    const r = validarMontos([CABB, "010001,A,Adm,35000", "010999,X,Adm,20000"].join("\n"), ctx, todos);
    const errores = r.incidencias.filter((i) => i.severidad === "ERROR").map((i) => i.mensaje);
    expect(errores).toEqual([
      expect.stringMatching(/planilla de noviembre de 2026 aprobada/),
      expect.stringMatching(/no está activo/),
    ]);
    expect(r.operaciones).toEqual([]);
  });

  it("con una planilla del mes en borrador, avisa que hay que recalcularla", () => {
    const ctx = contexto({ baseRap: baseRap({ planillasMes: new Map([["id-010001", { estado: "BORRADOR" as const }]]) }) });
    const r = validarMontos([CABB, "010001,A,Adm,35000"].join("\n"), ctx, todos);
    expect(r.incidencias.map((i) => i.mensaje).join(" ")).toMatch(/vuelva a calcularla para que tome la base nueva/);
  });

  it("si el RAP no va a mes vencido, la columna se ignora con un aviso (no es un tipo nuevo)", () => {
    const r = validarMontos([`${CABB},Cooperativa AUDI (COOP-AUDI)`, "010001,A,Adm,35000,500"].join("\n"), contexto(), todos);
    expect(r.columnasDesconocidas).toEqual([]);
    expect(r.incidencias.map((i) => i.mensaje).join(" ")).toMatch(/sólo se usa con el RAP a mes vencido/);
    expect(r.operaciones.every((o) => o.clase === "MONTO_PERIODO")).toBe(true);
  });

  it("al exportar va después del empleado, con la importada o la del sistema; no suma al total", () => {
    const ctx = contexto({ baseRap: baseRap() });
    const { columnas, filas, total } = armarMatriz(
      [
        { id: "id-010001", codigo: "010001", nombre: "A", departamento: "Adm" },
        { id: "id-010122", codigo: "010122", nombre: "B", departamento: "Adm" },
        { id: "id-010130", codigo: "010130", nombre: "C", departamento: "Adm" },
      ],
      TIPOS, ctx.estados, ctx.baseRap,
    );
    expect(columnas[3].etiqueta).toBe("Base RAP (mes anterior)");
    expect(filas.map((f) => f[3])).toEqual(["30000.00", "50000.00", ""]);
    expect(total.toFixed(2)).toBe("6774.39");
    // Ida y vuelta: lo exportado no cambia nada.
    const csv = [columnas.map((c) => c.etiqueta).join(","), ...filas.map((f) => f.join(","))].join("\n");
    expect(validarMontos(csv, ctx, todos).operaciones).toEqual([]);
  });
});