import { describe, it, expect } from "vitest";
import { Money } from "@/lib/payroll/money";
import { construirJerarquiaNomina, SIN_EMPRESA, type EmpleadoParaJerarquia, type NodoNomina } from "./jerarquia-nomina";
import { aplicarCambioOpciones, etiquetasNiveles } from "./estructura";

const GRUPO = { id: "conf", nombre: "Nómina Confidencial", descripcion: "Gerencias" };
const PAGSA = { id: "pagsa", nombre: "PAGSA", rtn: "08011999123456" };
const MAYOREO = { id: "may", nombre: "Mayoreo", rtn: null };
const ADM = { id: "adm", nombre: "Administración" };
const OPE = { id: "ope", nombre: "Operaciones" };

let n = 0;
const emp = (
  nombre: string,
  empresa: EmpleadoParaJerarquia["empresa"],
  departamento: EmpleadoParaJerarquia["departamento"],
  tipoPlanilla: EmpleadoParaJerarquia["tipoPlanilla"],
  salario: string
): EmpleadoParaJerarquia => ({
  id: `e${++n}`, codigo: `EMP-${n}`, nombre, puesto: null, estado: "ACTIVO", tipoPlanilla,
  salarioBase: new Money(salario), grupo: GRUPO, empresa, departamento,
});

const PLANTILLA = [
  emp("Zoila Mejía", PAGSA, ADM, "QUINCENAL", "20000.10"),
  emp("Ana Paz", PAGSA, ADM, "QUINCENAL", "10000.20"),
  emp("Luis Flores", PAGSA, OPE, "MENSUAL", "15000.00"),
  emp("Rosa Núñez", MAYOREO, ADM, "QUINCENAL", "12000.00"),
];

const texto = (nodo: NodoNomina, nivel = 0): string[] => [
  "  ".repeat(nivel) + `${nodo.nombre} (${nodo.cantidad})`,
  ...nodo.hijos.flatMap((h) => texto(h, nivel + 1)),
];
const frecuencia = (lista: ReturnType<typeof construirJerarquiaNomina>, tipo: string) => lista.find((f) => f.tipo === tipo)!;

describe("jerarquía de nómina", () => {
  const arbol = construirJerarquiaNomina(PLANTILLA, true);

  it("reproduce Frecuencia → Grupo → Empresa → Departamento", () => {
    expect(texto(frecuencia(arbol, "QUINCENAL").raiz)).toEqual([
      "Nómina quincenal (3)",
      "  Nómina Confidencial (3)",
      "    Mayoreo (1)",
      "      Administración (1)",
      "    PAGSA (2)",
      "      Administración (2)",
    ]);
  });

  it("cada frecuencia lleva sólo a su gente", () => {
    expect(texto(frecuencia(arbol, "MENSUAL").raiz)).toEqual([
      "Nómina mensual (1)",
      "  Nómina Confidencial (1)",
      "    PAGSA (1)",
      "      Operaciones (1)",
    ]);
  });

  it("suma los salarios sin perder centavos y da el RTN y la descripción", () => {
    const { raiz } = frecuencia(arbol, "QUINCENAL");
    const grupo = raiz.hijos[0];
    const pagsa = grupo.hijos[1];
    expect(raiz.totalSalarios).toBe("42000.30");
    expect(pagsa.totalSalarios).toBe("30000.30");
    expect(pagsa.detalle).toBe("RTN 08011999123456");
    expect(grupo.detalle).toBe("Gerencias");
    expect(grupo.hijos[0].detalle).toBeNull();
  });

  it("ordena a las personas y sólo las pone en los departamentos", () => {
    const { raiz } = frecuencia(arbol, "QUINCENAL");
    const pagsa = raiz.hijos[0].hijos[1];
    expect(pagsa.personas).toEqual([]);
    expect(pagsa.hijos[0].personas.map((p) => p.nombre)).toEqual(["Ana Paz", "Zoila Mejía"]);
  });

  it("sin permiso no entrega ningún salario", () => {
    const sinPermiso = JSON.stringify(construirJerarquiaNomina(PLANTILLA, false));
    expect(sinPermiso).not.toContain("salarioBase");
    expect(sinPermiso).not.toContain("totalSalarios");
    expect(sinPermiso).not.toContain("20000");
  });

  it("la clave de una rama es la misma en las dos frecuencias", () => {
    const mensual = construirJerarquiaNomina([emp("A", PAGSA, ADM, "MENSUAL", "1")], true);
    const quincenal = construirJerarquiaNomina([emp("B", PAGSA, ADM, "QUINCENAL", "1")], true);
    expect(frecuencia(mensual, "MENSUAL").raiz.hijos[0].hijos[0].hijos[0].clave)
      .toBe(frecuencia(quincenal, "QUINCENAL").raiz.hijos[0].hijos[0].hijos[0].clave);
  });

  it("quincenal y mensual existen aunque estén vacías; semanal sólo si alguien la tiene", () => {
    expect(construirJerarquiaNomina([], true).map((f) => f.tipo)).toEqual(["QUINCENAL", "MENSUAL"]);
    const conSemanal = construirJerarquiaNomina([emp("A", PAGSA, ADM, "SEMANAL", "1")], true);
    expect(conSemanal.map((f) => f.tipo)).toEqual(["QUINCENAL", "MENSUAL", "SEMANAL"]);
    expect(frecuencia(conSemanal, "SEMANAL").raiz.cantidad).toBe(1);
  });

  it("nombra la rama de los departamentos sin empresa", () => {
    const lista = construirJerarquiaNomina([emp("A", PAGSA, ADM, "MENSUAL", "1"), emp("B", null, OPE, "MENSUAL", "1")], true);
    const empresas = frecuencia(lista, "MENSUAL").raiz.hijos[0].hijos;
    expect(empresas.map((e) => e.nombre)).toEqual(["PAGSA", SIN_EMPRESA]);
    expect(new Set(empresas.map((e) => e.clave)).size).toBe(2);
  });
});

describe("opciones de la estructura", () => {
  const nada = { divisiones: false, jerarquia: false };
  const todo = { divisiones: true, jerarquia: true };

  it("encender la jerarquía enciende las divisiones", () => {
    expect(aplicarCambioOpciones(nada, { jerarquia: true })).toEqual(todo);
  });
  it("apagar las divisiones apaga la jerarquía", () => {
    expect(aplicarCambioOpciones(todo, { divisiones: false })).toEqual(nada);
  });
  it("apagar la jerarquía conserva las divisiones", () => {
    expect(aplicarCambioOpciones(todo, { jerarquia: false })).toEqual({ divisiones: true, jerarquia: false });
  });
  it("encender las divisiones no enciende la jerarquía", () => {
    expect(aplicarCambioOpciones(nada, { divisiones: true })).toEqual({ divisiones: true, jerarquia: false });
  });
  it("cambia el nombre de los niveles sólo con la jerarquía", () => {
    expect(etiquetasNiveles(true).divisiones).toBe("Empresas");
    expect(etiquetasNiveles(false).divisiones).toBe("Divisiones");
  });
});
