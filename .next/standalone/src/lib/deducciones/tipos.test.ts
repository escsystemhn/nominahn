import { describe, it, expect } from "vitest";
import {
  CATEGORIAS, esCategoriaAsignable, etiquetaCategoria, leerCategoria, noEsDeduccionPorEmpleado, normalizarCodigo,
  partirCabecera, sugerirCategoria, sugerirCodigo,
} from "@/lib/deducciones/tipos";
import { leerDatosTipo, leerMontoHabitual } from "@/lib/deducciones/tipos-bd";

describe("categorías de deducción", () => {
  it("no ofrece crear de ley ni de impuesto, pero sabe nombrarlas", () => {
    expect(CATEGORIAS.some((c) => c.valor === ("LEGAL" as string) || c.valor === ("IMPUESTO" as string))).toBe(false);
    expect(esCategoriaAsignable("LEGAL")).toBe(false);
    expect(etiquetaCategoria("LEGAL")).toBe("De ley");
    expect(etiquetaCategoria("VOLUNTARIA")).toBe("Descuento autorizado");
  });
  it("la lista desplegable de Excel cabe en 255 caracteres y sus valores no llevan comas", () => {
    const lista = CATEGORIAS.map((c) => c.etiqueta);
    expect(lista.join(",").length + 2).toBeLessThanOrEqual(255);
    expect(lista.every((e) => !e.includes(","))).toBe(true);
  });
  it("lee la categoría escrita como etiqueta, valor interno o sinónimo, sin tildes ni mayúsculas", () => {
    expect(leerCategoria("Préstamo de la empresa")).toBe("PRESTAMO");
    expect(leerCategoria("prestamo")).toBe("PRESTAMO");
    expect(leerCategoria("COOPERATIVA")).toBe("COOPERATIVA");
    expect(leerCategoria("pension alimenticia (judicial)")).toBe("PENSION_ALIMENTICIA");
    expect(leerCategoria("Seguro")).toBe("VOLUNTARIA");
    expect(leerCategoria("Descuento autorizado")).toBe("VOLUNTARIA");
    expect(leerCategoria("De ley")).toBeNull();
    expect(leerCategoria("")).toBeNull();
  });
  it("propone la categoría por el nombre: un préstamo de banco o del RAP no es de la empresa", () => {
    expect(sugerirCategoria("Coop AUDI")).toBe("COOPERATIVA");
    expect(sugerirCategoria("Préstamo empresa")).toBe("PRESTAMO");
    expect(sugerirCategoria("Ptmo RAP")).toBe("VOLUNTARIA");
    expect(sugerirCategoria("Préstamo BAC")).toBe("VOLUNTARIA");
    expect(sugerirCategoria("CxC Préstamo")).toBe("VOLUNTARIA");
    expect(sugerirCategoria("AFP Atlántida")).toBe("AFP");
    expect(sugerirCategoria("Pensión alimenticia")).toBe("PENSION_ALIMENTICIA");
    expect(sugerirCategoria("Anticipo de salario")).toBe("ADELANTO");
    expect(sugerirCategoria("Seguro médico")).toBe("VOLUNTARIA");
  });
  it("reconoce columnas que no son deducciones por empleado", () => {
    expect(noEsDeduccionPorEmpleado("Total deducciones")).toMatch(/total/);
    expect(noEsDeduccionPorEmpleado("Sueldo")).toMatch(/total|dato/);
    expect(noEsDeduccionPorEmpleado("IHSS")).toMatch(/ley/);
    expect(noEsDeduccionPorEmpleado("Imp. Vecinal")).toMatch(/ley/);
    expect(noEsDeduccionPorEmpleado("Ptmo RAP")).toBeNull();
    expect(noEsDeduccionPorEmpleado("Coop ELGA")).toBeNull();
  });
});

describe("códigos", () => {
  it("normaliza y propone códigos cortos y libres", () => {
    expect(normalizarCodigo("coop elga ñ")).toBe("COOP-ELGA-N");
    expect(sugerirCodigo("Cooperativa ELGA", new Set())).toBe("COOP-ELGA");
    expect(sugerirCodigo("Seguro médico", new Set())).toBe("SEG-MED");
    expect(sugerirCodigo("Cooperativa ELGA", new Set(["COOP-ELGA"]))).toBe("COOP-ELGA-2");
    expect(sugerirCodigo("Préstamo del banco", new Set())).toBe("PTMO-BANCO");
  });
  it("parte «Nombre (CÓDIGO)» y deja el nombre solo cuando no hay código", () => {
    expect(partirCabecera("Cooperativa ELGA (COOP-ELGA)")).toEqual({ nombre: "Cooperativa ELGA", codigo: "COOP-ELGA" });
    expect(partirCabecera("Seg. Méd.")).toEqual({ nombre: "Seg. Méd.", codigo: null });
    expect(partirCabecera("Seguro (familiar)")).toEqual({ nombre: "Seguro (familiar)", codigo: null });
    expect(sugerirCategoria("Ptmo BANCATLAN")).toBe("VOLUNTARIA");
  });
});

describe("datos de un tipo nuevo", () => {
  it("vacíos opcionales no son error (la ventana vieja mandaba null y fallaba)", () => {
    const r = leerDatosTipo({ nombre: "Seguro médico", codigo: "seg-med", tipo: "VOLUNTARIA", montoFijo: null, descripcion: null });
    expect(r).toEqual({ ok: true, valor: { nombre: "Seguro médico", codigo: "SEG-MED", tipo: "VOLUNTARIA", montoFijo: null, descripcion: null } });
  });
  it("monto habitual con coma decimal o miles; cero es «sin monto»", () => {
    expect(leerMontoHabitual("1.000,50")).toEqual({ ok: true, valor: "1000.50" });
    expect(leerMontoHabitual("0")).toEqual({ ok: true, valor: null });
    expect(leerMontoHabitual("abc").ok).toBe(false);
  });
  it("errores en palabras: sin nombre, código inválido, categoría de ley", () => {
    expect(leerDatosTipo({ nombre: "", codigo: "X", tipo: "OTRO" })).toMatchObject({ ok: false, error: expect.stringMatching(/nombre/) });
    expect(leerDatosTipo({ nombre: "Coop", codigo: "", tipo: "OTRO" })).toMatchObject({ ok: false, error: expect.stringMatching(/código/) });
    expect(leerDatosTipo({ nombre: "Coop", codigo: "C1", tipo: "LEGAL" })).toMatchObject({ ok: false, error: expect.stringMatching(/categoría/) });
  });
});
