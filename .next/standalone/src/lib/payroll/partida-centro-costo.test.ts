import { describe, it, expect } from "vitest";
import {
  generarPartidaContable,
  generarPartidaPorCentroCosto,
  CUENTAS,
  type DetalleParaPartida,
  type GrupoCentroCosto,
} from "./partida-contable";
import { money, CERO, type Money } from "./money";

/** Detalle con todo en cero salvo lo que interese al caso. */
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

/** Empleado corriente: sueldo, aportes patronales, retenciones y neto. */
function empleado(salario: number): DetalleParaPartida {
  const ihss = salario * 0.025;
  const rap = salario * 0.015;
  const isr = salario * 0.05;
  return detalle({
    salarioBase: salario,
    ihssEmpleado: ihss,
    ivmEmpleado: ihss / 2,
    rapEmpleado: rap,
    isr,
    ihssEmpleador: salario * 0.05,
    ivmEmpleador: salario * 0.035,
    rapEmpleador: rap,
    infop: salario * 0.01,
    reservaLaboral: salario * 0.04,
    salarioNeto: salario - ihss - rap - isr,
  });
}

const grupo = (
  codigo: string,
  nombre: string,
  detalles: DetalleParaPartida[],
  extra: Partial<GrupoCentroCosto> = {}
): GrupoCentroCosto => ({
  centroCostoId: codigo.toLowerCase(),
  codigo,
  nombre,
  detalles,
  ...extra,
});

/** Neto (debe − haber) de una cuenta en una lista de líneas. */
const netoDe = (lineas: Array<{ cuenta: string; debe: Money; haber: Money }>, cuenta: string): Money =>
  lineas
    .filter((l) => l.cuenta === cuenta)
    .reduce<Money>((acc, l) => acc.plus(l.debe).minus(l.haber), CERO);

describe("generarPartidaPorCentroCosto", () => {
  const PRODUCCION = [empleado(20000), empleado(15000)];
  const ADMIN = [empleado(30000)];
  const GRUPOS = [grupo("PROD", "Producción", PRODUCCION), grupo("ADM", "Administración", ADMIN)];

  /**
   * LA PROPIEDAD QUE IMPORTA. Un desglose que no reproduce el consolidado no es
   * un desglose: es un segundo asiento distinto. Se compara al céntimo, sin
   * tolerancia, igual que el cuadre del asiento principal.
   */
  it("la suma de los centros reproduce el consolidado, exacto", () => {
    const r = generarPartidaPorCentroCosto(GRUPOS);
    expect(r.conciliado).toBe(true);
    expect(r.diferenciaConciliacion.isZero()).toBe(true);
  });

  it("cuenta por cuenta, el desglose cuadra con el consolidado", () => {
    const consolidado = generarPartidaContable([...PRODUCCION, ...ADMIN]);
    const r = generarPartidaPorCentroCosto(GRUPOS);

    for (const cuenta of [
      CUENTAS.sueldos.cuenta,
      CUENTAS.patronalIhss.cuenta,
      CUENTAS.patronalRap.cuenta,
      CUENTAS.patronalInfop.cuenta,
    ]) {
      expect(
        netoDe(r.gastoPorCentro, cuenta).equals(netoDe(consolidado.lineas, cuenta)),
        `descuadre en la cuenta ${cuenta}`
      ).toBe(true);
    }
  });

  /**
   * Los pasivos NO se reparten. IHSS por pagar, ISR retenido y el neto por pagar
   * son obligaciones de la empresa frente a terceros; imputarlos a un área
   * sugeriría que Producción le debe algo al IHSS por separado, y no es cierto.
   */
  it("los pasivos quedan a nivel de empresa, sin centro de costo", () => {
    const r = generarPartidaPorCentroCosto(GRUPOS);
    const cuentasPasivo = r.pasivos.map((l) => l.cuenta);

    expect(cuentasPasivo).toContain(CUENTAS.sueldosPorPagar.cuenta);
    expect(cuentasPasivo).toContain(CUENTAS.isrPorPagar.cuenta);
    expect(cuentasPasivo).toContain(CUENTAS.ihssPorPagar.cuenta);

    // Y ninguno aparece repartido.
    const cuentasGasto = new Set(r.gastoPorCentro.map((l) => l.cuenta));
    expect(cuentasGasto.has(CUENTAS.sueldosPorPagar.cuenta)).toBe(false);
    expect(cuentasGasto.has(CUENTAS.isrPorPagar.cuenta)).toBe(false);
  });

  it("reparte el sueldo en la proporción real de cada centro", () => {
    const r = generarPartidaPorCentroCosto(GRUPOS);
    const prod = r.totalesPorCentro.find((t) => t.codigo === "PROD")!;
    const adm = r.totalesPorCentro.find((t) => t.codigo === "ADM")!;

    expect(prod.empleados).toBe(2);
    expect(adm.empleados).toBe(1);
    // Producción tiene 35.000 de sueldo frente a 30.000 de Administración.
    expect(netoDe(r.gastoPorCentro.filter((l) => l.centroCodigo === "PROD"), CUENTAS.sueldos.cuenta)
      .equals(money(35000))).toBe(true);
    expect(netoDe(r.gastoPorCentro.filter((l) => l.centroCodigo === "ADM"), CUENTAS.sueldos.cuenta)
      .equals(money(30000))).toBe(true);
  });

  it("cada línea de gasto sabe a qué centro pertenece", () => {
    const r = generarPartidaPorCentroCosto(GRUPOS);
    expect(r.gastoPorCentro.every((l) => l.centroCodigo && l.centroNombre)).toBe(true);
    expect(new Set(r.gastoPorCentro.map((l) => l.centroCodigo))).toEqual(new Set(["PROD", "ADM"]));
  });

  /**
   * Para las contabilidades que abren subcuenta por área en vez de llevar el
   * centro como dimensión aparte.
   */
  it("usa la subcuenta del centro cuando está definida", () => {
    const r = generarPartidaPorCentroCosto([
      grupo("PROD", "Producción", PRODUCCION, { cuentaGasto: "-01" }),
    ]);
    const sueldos = r.gastoPorCentro.find((l) => l.cuenta.startsWith(CUENTAS.sueldos.cuenta));
    expect(sueldos?.cuenta).toBe(`${CUENTAS.sueldos.cuenta}-01`);
  });

  it("una cuenta completa sustituye a la del plan general", () => {
    const r = generarPartidaPorCentroCosto([
      grupo("PROD", "Producción", PRODUCCION, { cuentaGasto: "610101" }),
    ]);
    expect(r.gastoPorCentro.some((l) => l.cuenta === "610101")).toBe(true);
  });

  it("los empleados sin centro asignado se agrupan igualmente", () => {
    const r = generarPartidaPorCentroCosto([
      { centroCostoId: null, codigo: "SIN-ASIGNAR", nombre: "Sin centro de costo", detalles: ADMIN },
    ]);
    expect(r.conciliado).toBe(true);
    expect(r.totalesPorCentro[0].centroCostoId).toBeNull();
  });

  it("un grupo vacío no genera líneas ni descuadra", () => {
    const r = generarPartidaPorCentroCosto([
      grupo("PROD", "Producción", PRODUCCION),
      grupo("VACIO", "Sin gente", []),
    ]);
    expect(r.conciliado).toBe(true);
    expect(r.totalesPorCentro.map((t) => t.codigo)).toEqual(["PROD"]);
  });

  it("sin ningún grupo no revienta", () => {
    const r = generarPartidaPorCentroCosto([]);
    expect(r.conciliado).toBe(true);
    expect(r.gastoPorCentro).toEqual([]);
  });

  it("respeta la opción de omitir provisiones", () => {
    const conProv = generarPartidaPorCentroCosto(
      [grupo("PROD", "Producción", [detalle({ salarioBase: 10000, provision13vo: 833.33, salarioNeto: 10000 })])],
      { incluirProvisiones: true }
    );
    const sinProv = generarPartidaPorCentroCosto(
      [grupo("PROD", "Producción", [detalle({ salarioBase: 10000, provision13vo: 833.33, salarioNeto: 10000 })])],
      { incluirProvisiones: false }
    );
    expect(conProv.gastoPorCentro.some((l) => l.cuenta === CUENTAS.gasto13vo.cuenta)).toBe(true);
    expect(sinProv.gastoPorCentro.some((l) => l.cuenta === CUENTAS.gasto13vo.cuenta)).toBe(false);
    expect(sinProv.conciliado).toBe(true);
  });

  /**
   * Un importe negativo en un solo centro genera su línea en el lado contrario.
   * Comparar sólo el Debe daría un descuadre falso; por eso la conciliación
   * trabaja sobre el NETO (debe − haber).
   */
  it("concilia aunque un centro traiga un importe negativo", () => {
    const r = generarPartidaPorCentroCosto([
      grupo("PROD", "Producción", [detalle({ salarioBase: 10000, salarioNeto: 10000 })]),
      grupo("ADM", "Administración", [detalle({ bonificaciones: -500, salarioNeto: -500 })]),
    ]);
    expect(r.conciliado).toBe(true);
    expect(r.anomalias.some((a) => a.includes("[ADM]"))).toBe(true);
  });

  it("con céntimos que no dividen exacto, sigue cuadrando", () => {
    const r = generarPartidaPorCentroCosto([
      grupo("A", "A", [detalle({ salarioBase: 3333.33, ihssEmpleador: 166.67, salarioNeto: 3333.33 })]),
      grupo("B", "B", [detalle({ salarioBase: 6666.67, ihssEmpleador: 333.33, salarioNeto: 6666.67 })]),
      grupo("C", "C", [detalle({ salarioBase: 0.01, ihssEmpleador: 0.01, salarioNeto: 0.01 })]),
    ]);
    expect(r.conciliado).toBe(true);
    expect(r.diferenciaConciliacion.toString()).toBe("0");
  });
});
