import { describe, it, expect } from "vitest";
import { money } from "@/lib/payroll/money";
import { consolidarPorEmpleado, hojasPlanillaDetallada, hojasPorDivision, tablaPlanillaDetallada, tablaResumenPlanilla, ubicacionDeLinea, type LineaPlanilla } from "./planilla-estructura";
import { columnasNumericas, valorCelda } from "./salida-celdas";
import { etiquetasNiveles, type Ubicacion } from "@/lib/organizacion/estructura";

const CONF = { id: "conf", nombre: "NOMINA CONFIDENCIAL" };
const MAY = { id: "may", nombre: "PAGSA MAYOREO" };
const TGU = { id: "tgu", nombre: "PAGSA TEGUCIGALPA" };

const linea = (nombre: string, division: typeof MAY, departamento: string, neto: number): LineaPlanilla => {
  const ubicacion: Ubicacion = { sucursal: CONF, division, departamento: { id: `${division.id}-${departamento}`, nombre: departamento } };
  const m = money(neto);
  // Devengado = salario + 0 + 0; deducciones 200 + 150 + 500 + 150 = 1,000; neto = devengado − 1,000.
  return {
    empleadoId: nombre, nombre, ubicacion, dias: 15,
    salario: m.plus(1000), horasExtra: money(0), otrosIngresos: money(0), devengado: m.plus(1000),
    ihss: money(200), rap: money(150), isr: money(500), vecinal: money(150), porTipo: new Map(),
    ausencias: money(0), incapacidad: money(0), deducciones: money(1000), neto: m, patronal: money(800),
  };
};

/** Las columnas cuando nadie tiene deducciones por empleado, ausencias ni incapacidad. */
const CABECERAS = ["Empleado", "Días trab.", "Salario", "Horas extra", "Otros ingresos", "Total devengado", "IHSS", "RAP", "ISR", "Imp. vecinal", "Total deducciones", "Neto a pagar"];

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

describe("cada división en su hoja", () => {
  const hojas = hojasPorDivision(LINEAS);

  it("una hoja por división y una última con el resumen", () => {
    expect(hojas.map((h) => h.nombre)).toEqual([
      "NOMINA CONFIDENCIAL / PAGSA MAYOREO",
      "NOMINA CONFIDENCIAL / PAGSA TEGUCIGALPA",
      "Resumen de toda la planilla",
    ]);
    expect(hojas.map((h) => h.pestana)).toEqual(["PAGSA MAYOREO", "PAGSA TEGUCIGALPA", "Resumen"]);
  });

  it("cada hoja lleva sólo su gente, por departamento, y cierra con su total", () => {
    const h = hojas[0];
    expect(h.datos.map((f) => f[0])).toEqual([
      "Administracion", "CARLOS MEJIA", "JUAN PEREZ", "Subtotal Administracion (2 empleados)",
      "Ventas", "FIDEL BULNES", "Subtotal Ventas (1 empleado)",
      "TOTAL PAGSA MAYOREO (3 empleados)",
    ]);
    expect(txt(h.datos.at(-1)![h.cabeceras.indexOf("Neto a pagar")])).toBe(txt("L 53,000.00"));
    expect(h.filas.at(-1)).toEqual({ tipo: "total", nivel: 0 });
  });

  it("nadie se queda fuera ni sale dos veces", () => {
    const empleados = hojas.slice(0, -1).flatMap((h) => h.datos.filter((_, i) => h.filas[i].tipo === "detalle").map((f) => f[0]));
    expect(empleados.sort()).toEqual(LINEAS.map((l) => l.nombre).sort());
  });

  it("el resumen conserva el total general, con las mismas columnas que el detalle", () => {
    const ultima = hojas.at(-1)!;
    expect(ultima.cabeceras).toEqual(["Sucursal / División", ...CABECERAS.slice(1)]);
    expect(ultima.datos.map((f) => f[0])).toEqual([
      "NOMINA CONFIDENCIAL", "PAGSA MAYOREO (3 empleados)", "PAGSA TEGUCIGALPA (3 empleados)",
      "Subtotal NOMINA CONFIDENCIAL (6 empleados)", "TOTAL GENERAL (6 empleados)",
    ]);
    expect(txt(ultima.datos.at(-1)![ultima.cabeceras.indexOf("Neto a pagar")])).toBe(txt("L 108,000.00"));
    expect(ultima.descripcion).toBe("Resumen: 2 divisiones, 6 empleados");
  });

  it("los sin división salen en su propia hoja", () => {
    const sinDivision = { ...linea("ANA PAZ", MAY, "Ventas", 1000), ubicacion: { sucursal: CONF, division: null, departamento: { id: "x", nombre: "Ventas" } } };
    expect(hojasPorDivision([...LINEAS, sinDivision]).map((h) => h.pestana)).toEqual(["PAGSA MAYOREO", "PAGSA TEGUCIGALPA", "Sin división", "Resumen"]);
  });

  it("una sucursal sin divisiones ocupa una hoja, y una sola hoja no lleva resumen", () => {
    const sola = { ...linea("ANA PAZ", MAY, "Ventas", 1000), ubicacion: { sucursal: TGU, division: null, departamento: { id: "x", nombre: "Ventas" } } };
    const r = hojasPorDivision([sola]);
    expect(r.map((h) => h.nombre)).toEqual(["PAGSA TEGUCIGALPA"]);
    expect(r[0].datos.at(-1)![0]).toBe("TOTAL PAGSA TEGUCIGALPA (1 empleado)");
  });

  it("sin líneas no hay hojas", () => {
    expect(hojasPorDivision([])).toEqual([]);
  });
});

describe("con la jerarquía de nómina", () => {
  const niveles = etiquetasNiveles(true);
  const sinEmpresa = { ...linea("ANA PAZ", MAY, "Ventas", 1000), ubicacion: { sucursal: CONF, division: null, departamento: { id: "x", nombre: "Ventas" } } };

  it("la hoja de quien no tiene empresa se nombra con esa palabra", () => {
    expect(hojasPorDivision([...LINEAS, sinEmpresa], niveles).map((h) => h.pestana)).toEqual(["PAGSA MAYOREO", "PAGSA TEGUCIGALPA", "Sin sucursal asignada", "Resumen"]);
  });

  it("el resumen titula sus columnas con Grupo y Sucursal, y la última hoja cuenta sucursales", () => {
    expect(tablaResumenPlanilla(LINEAS, niveles).cabeceras[0]).toBe("Grupo / Sucursal / Departamento");
    expect(hojasPorDivision(LINEAS, niveles).at(-1)!.descripcion).toBe("Resumen: 2 sucursales, 6 empleados");
    expect(hojasPlanillaDetallada(LINEAS, niveles)[1].cabeceras[0]).toBe("Grupo / Sucursal");
    expect(tablaPlanillaDetallada([...LINEAS, sinEmpresa], niveles).datos.map((f) => f[0])).toContain("Sin sucursal asignada");
  });

  it("cada hoja lleva el nombre y el RTN de su empresa; sin RTN, sólo el nombre", () => {
    const hojas = hojasPorDivision(LINEAS, niveles, new Map([["may", "08011999123456"]]));
    expect(hojas.map((h) => h.nombre)).toEqual([
      "NOMINA CONFIDENCIAL / PAGSA MAYOREO, RTN 08011999123456",
      "NOMINA CONFIDENCIAL / PAGSA TEGUCIGALPA",
      "Resumen de toda la planilla",
    ]);
    expect(hojas[0].pestana).toBe("PAGSA MAYOREO");
  });

  it("sin la opción, todo sigue diciendo Sucursal y División", () => {
    expect(tablaResumenPlanilla(LINEAS).cabeceras[0]).toBe("Sucursal / División / Departamento");
    expect(tablaPlanillaDetallada([...LINEAS, sinEmpresa]).datos.map((f) => f[0])).toContain("Sin división");
  });
});

describe("planilla detallada agrupada", () => {
  const t = tablaPlanillaDetallada(LINEAS);
  const fila = (texto: string) => t.datos.findIndex((f) => f[0].startsWith(`${texto} (`) || f[0] === texto);
  const col = (nombre: string) => t.cabeceras.indexOf(nombre);

  it("lleva encabezado, detalle y subtotal en cada nivel, y el total general al final", () => {
    expect(t.datos.map((f, i) => `${t.filas[i].tipo}/${t.filas[i].nivel}/${f[0]}`).slice(0, 7)).toEqual([
      "grupo/0/NOMINA CONFIDENCIAL",
      "grupo/1/PAGSA MAYOREO",
      "grupo/2/Administracion",
      "detalle/3/CARLOS MEJIA",
      "detalle/3/JUAN PEREZ",
      "subtotal/2/Subtotal Administracion (2 empleados)",
      "grupo/2/Ventas",
    ]);
    expect(t.filas.at(-1)).toEqual({ tipo: "total", nivel: 0 });
    expect(t.datos.at(-1)![0]).toBe("TOTAL GENERAL (6 empleados)");
  });

  it("sin período; con días trabajados, total devengado, total deducciones y neto a pagar", () => {
    expect(t.cabeceras).not.toContain("Período");
    expect(t.cabeceras).toEqual(CABECERAS);
    for (const c of ["Días trab.", "Total devengado", "Total deducciones", "Neto a pagar", "Imp. vecinal"]) expect(t.cabeceras).toContain(c);
    expect(t.datos[fila("JUAN PEREZ")][col("Días trab.")]).toBe("15");
    // Una columna sólo de números: Excel la suma.
    expect(columnasNumericas(t.cabeceras, t.datos)[col("Días trab.")]).toBe(true);
  });

  it("cada fila cuadra: las partes suman el devengado y las deducciones, y devengado − deducciones = neto", () => {
    const n = (f: string[], c: string) => valorCelda(f[col(c)]).valor as number;
    const deducciones = ["IHSS", "RAP", "ISR", "Imp. vecinal"];
    for (const [i, f] of t.datos.entries()) {
      if (t.filas[i].tipo === "grupo") continue;
      expect(n(f, "Salario") + n(f, "Horas extra") + n(f, "Otros ingresos")).toBeCloseTo(n(f, "Total devengado"), 2);
      expect(deducciones.reduce((s, c) => s + n(f, c), 0)).toBeCloseTo(n(f, "Total deducciones"), 2);
      expect(n(f, "Total devengado") - n(f, "Total deducciones")).toBeCloseTo(n(f, "Neto a pagar"), 2);
    }
  });

  it("los subtotales suman exactamente lo de abajo", () => {
    const neto = col("Neto a pagar");
    expect(txt(t.datos[fila("Subtotal Administracion")][neto])).toBe("L 38,000.00");
    expect(txt(t.datos[fila("Subtotal PAGSA MAYOREO")][neto])).toBe("L 53,000.00");
    expect(txt(t.datos[fila("Subtotal PAGSA TEGUCIGALPA")][neto])).toBe("L 55,000.00");
    expect(txt(t.datos[fila("Subtotal NOMINA CONFIDENCIAL")][neto])).toBe("L 108,000.00");
    expect(txt(t.datos.at(-1)![neto])).toBe("L 108,000.00");
    expect(t.datos[fila("Subtotal PAGSA MAYOREO")][0]).toBe("Subtotal PAGSA MAYOREO (3 empleados)");
  });

  it("ya no repite la sucursal como columna: es un nivel del árbol", () => {
    expect(t.cabeceras).not.toContain("Sucursal");
  });
});

describe("para imprimir: el detalle hasta el total de cada empresa, el resumen al final", () => {
  const [detalle, resumen, ...resto] = hojasPlanillaDetallada(LINEAS);
  const rotulos = (h: { datos: string[][] }) => h.datos.map((f) => f[0]);

  it("dos partes: detalle y resumen (la segunda empieza en otra página)", () => {
    expect(resto).toEqual([]);
    expect([detalle.nombre, detalle.pestana, resumen.nombre, resumen.pestana]).toEqual(["", "Detalle", "Resumen de la planilla", "Resumen"]);
  });

  it("el detalle cierra cada empresa con su total, sin el subtotal del grupo ni el total general", () => {
    expect(rotulos(detalle)).toContain("Subtotal PAGSA MAYOREO (3 empleados)");
    expect(rotulos(detalle).at(-1)).toBe("Subtotal PAGSA TEGUCIGALPA (3 empleados)");
    expect(rotulos(detalle).some((r) => r.startsWith("Subtotal NOMINA CONFIDENCIAL") || r.startsWith("TOTAL"))).toBe(false);
  });

  it("el resumen trae cada empresa, el subtotal del grupo y el total general, y no cuenta registros", () => {
    expect(rotulos(resumen)).toEqual([
      "NOMINA CONFIDENCIAL", "PAGSA MAYOREO (3 empleados)", "PAGSA TEGUCIGALPA (3 empleados)",
      "Subtotal NOMINA CONFIDENCIAL (6 empleados)", "TOTAL GENERAL (6 empleados)",
    ]);
    expect(resumen.filas.some((f) => f.tipo === "detalle")).toBe(false);
    expect(resumen.descripcion).toBe("Resumen: 2 divisiones, 6 empleados");
  });

  it("un grupo sin empresas conserva su subtotal en el detalle y es una fila del resumen", () => {
    const sola = { ...linea("ANA PAZ", MAY, "Ventas", 1000), ubicacion: { sucursal: TGU, division: null, departamento: { id: "x", nombre: "Ventas" } } };
    const [d, r] = hojasPlanillaDetallada([sola]);
    expect(rotulos(d).at(-1)).toBe("Subtotal PAGSA TEGUCIGALPA (1 empleado)");
    expect(rotulos(r)).toEqual(["PAGSA TEGUCIGALPA (1 empleado)", "TOTAL GENERAL (1 empleado)"]);
    expect(r.cabeceras[0]).toBe("Sucursal");
    expect(r.descripcion).toBe("Resumen: 1 sucursal, 1 empleado");
  });

  it("en pantalla va todo en una tabla: el detalle y, debajo, el resumen", () => {
    const t = tablaPlanillaDetallada(LINEAS);
    const i = t.datos.findIndex((f) => f[0] === "RESUMEN DE LA PLANILLA");
    expect(i).toBeGreaterThan(0);
    expect(t.datos.slice(0, i).some((f) => f[0].startsWith("TOTAL"))).toBe(false);
    expect(t.datos.slice(i + 1).map((f) => f[0])).toEqual(rotulos(resumen));
    expect(t.filas.filter((f) => f.tipo === "detalle")).toHaveLength(6);
  });

  it("sin líneas no hay nada que imprimir", () => {
    expect(hojasPlanillaDetallada([])).toEqual([]);
  });
});

describe("varias planillas en el mismo reporte", () => {
  const q1 = linea("JUAN PEREZ", MAY, "Administracion", 5000);
  const q2 = { ...linea("JUAN PEREZ", MAY, "Administracion", 6000), dias: 14 };

  it("una fila por persona: las dos quincenas se suman, días incluidos", () => {
    const [una, ...resto] = consolidarPorEmpleado([q1, q2]);
    expect(resto).toEqual([]);
    expect(una.dias).toBe(29);
    expect(una.neto.toFixed(2)).toBe("11000.00");
    expect(una.devengado.toFixed(2)).toBe("13000.00");
    const t = tablaPlanillaDetallada([q1, q2]);
    expect(t.datos.filter((_, i) => t.filas[i].tipo === "detalle").map((f) => [f[0], f[1]])).toEqual([["JUAN PEREZ", "29"]]);
    expect(t.datos.at(-1)![0]).toBe("TOTAL GENERAL (1 empleado)");
  });

  it("quien cambió de departamento sale en cada uno con lo suyo", () => {
    const otraArea = linea("JUAN PEREZ", MAY, "Ventas", 6000);
    expect(consolidarPorEmpleado([q1, otraArea])).toHaveLength(2);
  });

  it("no altera las líneas que recibe", () => {
    consolidarPorEmpleado([q1, q2]);
    expect(q1.dias).toBe(15);
    expect(q1.neto.toFixed(2)).toBe("5000.00");
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

describe("cada deducción en su columna, como en la planilla de la empresa", () => {
  const base = linea("ANA", MAY, "Ventas", 10000);
  const conTipos = (nombre: string, tipos: Record<string, number>, extra: Partial<LineaPlanilla> = {}): LineaPlanilla => {
    const l = linea(nombre, MAY, "Ventas", 10000);
    const porTipo = new Map(Object.entries(tipos).map(([k, v]) => [k, money(v)]));
    const suma = [...porTipo.values()].reduce((a, b) => a.plus(b), money(0));
    return { ...l, porTipo, deducciones: l.deducciones.plus(suma).plus(extra.ausencias ?? 0).plus(extra.incapacidad ?? 0),
      neto: l.neto.minus(suma).minus(extra.ausencias ?? 0).minus(extra.incapacidad ?? 0), ...extra };
  };

  it("una columna por cada tipo cobrado, por nombre; sin columna para lo que nadie paga", () => {
    const t = tablaPlanillaDetallada([conTipos("ANA", { "Préstamo RAP": 1399.41, "Cooperativa AUDI": 500 }), conTipos("LUIS", { "AFP Atlántida": 900 }), base]);
    expect(t.cabeceras).toEqual(["Empleado", "Días trab.", "Salario", "Horas extra", "Otros ingresos", "Total devengado", "IHSS", "RAP", "ISR", "Imp. vecinal",
      "AFP Atlántida", "Cooperativa AUDI", "Préstamo RAP", "Total deducciones", "Neto a pagar"]);
    const f = t.datos.find((x) => x[0] === "ANA")!;
    expect(txt(f[t.cabeceras.indexOf("Préstamo RAP")])).toBe(txt("L 1,399.41"));
    expect(txt(f[t.cabeceras.indexOf("AFP Atlántida")])).toBe(txt("L 0.00"));
  });

  it("ausencias e incapacidad, cada una sólo si alguien la tiene", () => {
    const t = tablaPlanillaDetallada([conTipos("ANA", {}, { ausencias: money(300) }), base]);
    expect(t.cabeceras).toContain("Ausencias");
    expect(t.cabeceras).not.toContain("Incapacidad");
    const u = tablaPlanillaDetallada([conTipos("ANA", {}, { incapacidad: money(500) })]);
    expect(u.cabeceras).toContain("Incapacidad");
    expect(u.cabeceras).not.toContain("Ausencias");
  });

  it("y la fila sigue cuadrando: las partes suman el total de deducciones", () => {
    const t = tablaPlanillaDetallada([conTipos("ANA", { "Préstamo RAP": 1399.41, "Cooperativa AUDI": 500 }, { ausencias: money(300) })]);
    const n = (f: string[], c: string) => valorCelda(f[t.cabeceras.indexOf(c)]).valor as number;
    const f = t.datos.find((x) => x[0] === "ANA")!;
    const partes = ["IHSS", "RAP", "ISR", "Imp. vecinal", "Cooperativa AUDI", "Préstamo RAP", "Ausencias"].reduce((s, c) => s + n(f, c), 0);
    expect(partes).toBeCloseTo(n(f, "Total deducciones"), 2);
  });

  it("al juntar las dos quincenas de una persona se suman también sus tipos", () => {
    const [una] = consolidarPorEmpleado([conTipos("ANA", { "Préstamo RAP": 1000 }), conTipos("ANA", { "Préstamo RAP": 1000, "Vales": 250 })]);
    expect(una.porTipo.get("Préstamo RAP")!.toFixed(2)).toBe("2000.00");
    expect(una.porTipo.get("Vales")!.toFixed(2)).toBe("250.00");
  });
});
