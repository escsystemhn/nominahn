import { describe, it, expect } from "vitest";
import { comparadorPlanilla, describirOrden, direccionPorOmision, leerVista, textoDireccion, textoVista, VISTA_POR_OMISION, type FilaOrdenable } from "@/lib/payroll/vista-planilla";
import { tablaPlanillaDetallada, type LineaPlanilla } from "@/lib/reportes/planilla-estructura";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { CERO, money } from "@/lib/payroll/money";

const f = (s: string) => new Date(`${s}T00:00:00Z`);
const GENTE: FilaOrdenable[] = [
  { nombre: "Dalia Bonilla", apellido: "Bonilla Dalia", codigo: "EMP-10", fechaIngreso: f("2012-01-23"), salario: 26000, bruto: 13000, deducciones: 450, neto: 12550 },
  { nombre: "Amparo García", apellido: "García Amparo", codigo: "EMP-9", fechaIngreso: f("2009-06-01"), salario: 20000, bruto: 10000, deducciones: 3899.41, neto: 6100.59 },
  { nombre: "Osmar Reyes", apellido: "Reyes Osmar", codigo: "EMP-2", fechaIngreso: f("2016-10-03"), salario: 26000, bruto: 13000, deducciones: 2976.09, neto: 10023.91 },
  { nombre: "Ramiro Acosta", apellido: "Acosta Ramiro", codigo: null, fechaIngreso: null, salario: 19000, bruto: 9500, deducciones: 1100, neto: 8400 },
];
const orden = (campo: Parameters<typeof comparadorPlanilla>[0], dir: "asc" | "desc") => [...GENTE].sort(comparadorPlanilla(campo, dir)).map((g) => g.nombre.split(" ")[0]);

describe("cómo se ve la planilla (pedido del 2026-11-23)", () => {
  it("la cookie: lo conocido se respeta; lo dañado o vacío, por omisión", () => {
    expect(leerVista(undefined)).toEqual(VISTA_POR_OMISION);
    expect(leerVista("orden=neto&ingresos=resumen")).toEqual({ orden: "neto", dir: "desc", ingresos: "resumen", deducciones: "todo" });
    expect(leerVista("orden=<script>&dir=arriba&deducciones=x")).toEqual(VISTA_POR_OMISION);
    const v = { orden: "apellido", dir: "desc", ingresos: "todo", deducciones: "resumen" } as const;
    expect(leerVista(textoVista(v))).toEqual(v);
  });

  it("al elegir un campo: los montos de mayor a menor; lo demás, del principio; y se dice con palabras", () => {
    expect(["antiguedad", "codigo", "neto"].map((c) => direccionPorOmision(c as "neto"))).toEqual(["asc", "asc", "desc"]);
    expect(textoDireccion("antiguedad", "asc")).toBe("Más antiguo primero");
    expect(textoDireccion("salario", "desc")).toBe("De mayor a menor");
    expect(textoDireccion("nombre", "desc")).toBe("De la Z a la A");
    expect(describirOrden({ orden: "neto", dir: "desc" })).toBe("por neto, de mayor a menor");
    expect(describirOrden({ orden: "codigo", dir: "asc" })).toBe("por código, de la A a la Z");
  });

  it("cada campo ordena en los dos sentidos; lo que no tiene dato va al final en los dos", () => {
    expect(orden("antiguedad", "asc")).toEqual(["Amparo", "Dalia", "Osmar", "Ramiro"]);
    expect(orden("antiguedad", "desc")).toEqual(["Osmar", "Dalia", "Amparo", "Ramiro"]);
    // «EMP-2» antes que «EMP-9» y «EMP-10»: el número se compara como número.
    expect(orden("codigo", "asc")).toEqual(["Osmar", "Amparo", "Dalia", "Ramiro"]);
    expect(orden("codigo", "desc")).toEqual(["Dalia", "Amparo", "Osmar", "Ramiro"]);
    expect(orden("apellido", "asc")).toEqual(["Ramiro", "Dalia", "Amparo", "Osmar"]);
    expect(orden("nombre", "desc")).toEqual(["Ramiro", "Osmar", "Dalia", "Amparo"]);
    expect(orden("neto", "desc")).toEqual(["Dalia", "Osmar", "Ramiro", "Amparo"]);
    expect(orden("deducciones", "asc")).toEqual(["Dalia", "Ramiro", "Osmar", "Amparo"]);
  });

  it("a igual valor, por antigüedad: el orden no cambia entre una carga y otra", () => {
    // Dalia y Osmar ganan lo mismo: Dalia entró antes.
    expect(orden("salario", "desc")).toEqual(["Dalia", "Osmar", "Amparo", "Ramiro"]);
    expect(orden("bruto", "asc")).toEqual(["Ramiro", "Amparo", "Dalia", "Osmar"]);
  });

  it("la planilla impresa sigue el orden de la pantalla", () => {
    const ubicacion = { sucursal: { id: "s", nombre: "Pagsa" }, division: null, departamento: { id: "d", nombre: "Administración" } };
    const linea = (empleadoId: string, nombre: string, ingreso: string, posicion?: number): LineaPlanilla => ({
      empleadoId, nombre, fechaIngreso: f(ingreso), posicion, ubicacion, dias: 15,
      salario: money(1000), horasExtra: CERO, otrosIngresos: CERO, devengado: money(1000), ihss: CERO, rap: CERO, isr: CERO, vecinal: CERO,
      porTipo: new Map(), ausencias: CERO, incapacidad: CERO, deducciones: CERO, neto: money(1000), patronal: CERO,
    });
    const nombres = (ls: LineaPlanilla[]) => tablaPlanillaDetallada(ls, etiquetasNiveles(false)).datos.map((r) => r[0].trim()).filter((x) => ["Alma", "Zoila", "Gelyn"].includes(x));
    expect(nombres([linea("1", "Alma", "2021-03-01", 0), linea("2", "Zoila", "2004-07-10", 2), linea("3", "Gelyn", "2012-09-20", 1)])).toEqual(["Alma", "Gelyn", "Zoila"]);
    // Sin el orden de la pantalla (desde Reportes), por antigüedad.
    expect(nombres([linea("1", "Alma", "2021-03-01"), linea("2", "Zoila", "2004-07-10"), linea("3", "Gelyn", "2012-09-20")])).toEqual(["Zoila", "Gelyn", "Alma"]);
  });
});
