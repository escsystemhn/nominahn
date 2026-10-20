import { describe, it, expect } from "vitest";
import { generarPartidaContable, CUENTAS, CLAVES_GASTO, type DetalleParaPartida, type PlanCuentas, type ClaveCuenta } from "./partida-contable";
import {
  CATALOGO_POR_OMISION,
  CUENTA_POR_OMISION,
  TIPOS_PERMITIDOS,
  SECCIONES_MAPEO,
  NATURALEZA_NORMAL,
  construirArbol,
  validarCuenta,
  esContracuenta,
} from "./catalogo-contable";

function detalle(campos: Partial<DetalleParaPartida> = {}): DetalleParaPartida {
  return {
    salarioBase: 0, montoHorasExtra: 0, bonificaciones: 0, otrosIngresos: 0,
    ihssEmpleado: 0, rapEmpleado: 0, afpEmpleado: 0, isr: 0, impuestoVecinal: 0,
    cooperativa: 0, prestamos: 0, adelantos: 0, ausencias: 0, otrosDeducciones: 0,
    ihssEmpleador: 0, rapEmpleador: 0, infop: 0, reservaLaboral: 0, ivmEmpleado: 0, ivmEmpleador: 0,
    salarioNeto: 0, provision13vo: 0, provision14vo: 0, provisionVacaciones: 0,
    ...campos,
  };
}

const EMPLEADO = detalle({
  salarioBase: 20000, ihssEmpleado: 500, ivmEmpleado: 250, ihssEmpleador: 1000, ivmEmpleador: 700, isr: 1000, salarioNeto: 18500,
});

describe("plan de cuentas en el motor", () => {
  it("sin plan, usa el catálogo por omisión", () => {
    const p = generarPartidaContable([EMPLEADO]);
    const sueldos = p.lineas.find((l) => l.clave === "sueldos");
    expect(sueldos?.cuenta).toBe(CUENTAS.sueldos.cuenta);
    expect(sueldos?.nombre).toBe(CUENTAS.sueldos.nombre);
  });

  it("el plan del contador sustituye código y nombre", () => {
    const plan: PlanCuentas = { sueldos: { cuenta: "610101", nombre: "Gasto de Personal — Sueldos" } };
    const p = generarPartidaContable([EMPLEADO], { plan });
    const sueldos = p.lineas.find((l) => l.clave === "sueldos");
    expect(sueldos?.cuenta).toBe("610101");
    expect(sueldos?.nombre).toBe("Gasto de Personal — Sueldos");
  });

  it("lo que el plan no remapea cae al valor por omisión y el asiento sigue cuadrando", () => {
    const p = generarPartidaContable([EMPLEADO], { plan: { sueldos: { cuenta: "610101", nombre: "Sueldos" } } });
    expect(p.lineas.find((l) => l.clave === "isrPorPagar")?.cuenta).toBe(CUENTAS.isrPorPagar.cuenta);
    expect(p.cuadra).toBe(true);
  });
});

describe("catálogo por omisión", () => {
  const porCodigo = new Map(CATALOGO_POR_OMISION.map((f) => [f[0], f]));

  it("no repite códigos", () => {
    expect(porCodigo.size).toBe(CATALOGO_POR_OMISION.length);
  });

  it("toda cuenta madre existe y es de grupo", () => {
    for (const [codigo, , , , padre] of CATALOGO_POR_OMISION) {
      if (!padre) continue;
      const madre = porCodigo.get(padre);
      expect(madre, `madre de ${codigo}`).toBeDefined();
      expect(madre![5], `${padre} debe ser de grupo`).toBe(0);
    }
  });

  it("las contracuentas son las únicas con naturaleza contraria a su tipo", () => {
    const contra = CATALOGO_POR_OMISION.filter(([, , tipo, nat]) => esContracuenta(tipo, nat)).map((f) => f[0]);
    expect(contra.sort()).toEqual(["1111", "1202", "1204", "4102", "4103", "610205"].sort());
  });

  it("cada concepto del motor tiene una cuenta de detalle predeterminada del tipo permitido", () => {
    for (const clave of Object.keys(CUENTAS) as ClaveCuenta[]) {
      const codigo = CUENTA_POR_OMISION[clave];
      const fila = porCodigo.get(codigo);
      expect(fila, `${clave} → ${codigo}`).toBeDefined();
      expect(fila![5], `${codigo} debe ser de detalle`).toBe(1);
      expect(TIPOS_PERMITIDOS[clave], `${clave} admite ${fila![2]}`).toContain(fila![2]);
    }
  });

  it("el código por omisión del motor coincide con el del catálogo", () => {
    for (const clave of Object.keys(CUENTAS) as ClaveCuenta[]) {
      expect(CUENTAS[clave].cuenta, clave).toBe(CUENTA_POR_OMISION[clave]);
    }
  });

  it("los conceptos de gasto admiten gasto o costo y los pasivos sólo pasivo", () => {
    for (const clave of Object.keys(CUENTAS) as ClaveCuenta[]) {
      if (CLAVES_GASTO.has(clave)) expect(TIPOS_PERMITIDOS[clave]).toContain("GASTO");
      else if (clave === "prestamosEmpleados" || clave === "adelantosEmpleados") expect(TIPOS_PERMITIDOS[clave]).toEqual(["ACTIVO"]);
      else expect(TIPOS_PERMITIDOS[clave]).toEqual(["PASIVO"]);
    }
  });

  it("las secciones de la pantalla cubren todos los conceptos una sola vez", () => {
    const claves = SECCIONES_MAPEO.flatMap((s) => s.claves.map((k) => k.clave));
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves.sort()).toEqual((Object.keys(CUENTAS) as string[]).sort());
  });
});

describe("construirArbol", () => {
  const cuentas = CATALOGO_POR_OMISION.map(([codigo, nombre, tipo, naturaleza, padre, detalle], i) => ({
    id: String(i), codigo, nombre, tipo, naturaleza, padreCodigo: padre || null, esDetalle: detalle === 1, esSistema: true, activa: true,
  }));

  it("cuelga cada cuenta de su madre y asigna el nivel", () => {
    const arbol = construirArbol(cuentas);
    expect(arbol.map((n) => n.codigo)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const pasivos = arbol.find((n) => n.codigo === "2")!;
    const corriente = pasivos.hijos.find((n) => n.codigo === "21")!;
    const retenciones = corriente.hijos.find((n) => n.codigo === "2103")!;
    expect(retenciones.nivel).toBe(2);
    expect(retenciones.hijos.map((h) => h.codigo)).toContain("210307");
    expect(retenciones.hijos[0].nivel).toBe(3);
  });

  it("una cuenta cuya madre no existe queda como raíz, no desaparece", () => {
    const arbol = construirArbol([{ ...cuentas[0], codigo: "9", padreCodigo: "no-existe" }]);
    expect(arbol).toHaveLength(1);
  });
});

describe("validarCuenta", () => {
  const existentes = [
    { codigo: "61", esDetalle: false },
    { codigo: "6102", esDetalle: false },
    { codigo: "610201", esDetalle: true },
  ];

  it("acepta una subcuenta bien formada bajo un grupo", () => {
    expect(validarCuenta({ codigo: "610206", nombre: "Viáticos", tipo: "GASTO", naturaleza: "DEUDORA", padreCodigo: "6102", esDetalle: true }, existentes)).toEqual([]);
  });

  it("rechaza colgar de una cuenta de detalle", () => {
    const e = validarCuenta({ codigo: "61020101", nombre: "X", tipo: "GASTO", naturaleza: "DEUDORA", padreCodigo: "610201", esDetalle: true }, existentes);
    expect(e.join(" ")).toMatch(/es de detalle/);
  });

  it("rechaza una madre inexistente, el código vacío y la autorreferencia", () => {
    expect(validarCuenta({ codigo: "7", nombre: "X", tipo: "GASTO", naturaleza: "DEUDORA", padreCodigo: "99", esDetalle: false }, existentes).join(" ")).toMatch(/no existe/);
    expect(validarCuenta({ codigo: " ", nombre: "X", tipo: "GASTO", naturaleza: "DEUDORA", esDetalle: true }, existentes).join(" ")).toMatch(/obligatorio/);
    expect(validarCuenta({ codigo: "61", nombre: "X", tipo: "GASTO", naturaleza: "DEUDORA", padreCodigo: "61", esDetalle: false }, existentes).join(" ")).toMatch(/propia madre/);
  });

  it("la naturaleza normal de cada tipo es la de Gestión360", () => {
    expect(NATURALEZA_NORMAL).toEqual({ ACTIVO: "DEUDORA", PASIVO: "ACREEDORA", PATRIMONIO: "ACREEDORA", INGRESO: "ACREEDORA", COSTO: "DEUDORA", GASTO: "DEUDORA" });
  });
});
