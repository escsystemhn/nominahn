import { describe, it, expect } from "vitest";
import { money } from "@/lib/payroll/money";
import { avisosDeDeducciones, columnasDeDeducciones, deduccionesPorNombre, leerDeduccionesGuardadas, resumirDeducciones } from "@/lib/payroll/deducciones-de-linea";
import { aplicarDeducciones, topesDelPeriodo } from "@/lib/payroll/deducciones";
import { ingresosDelAnio } from "@/lib/payroll/vecinal-anual";
import { calcularPlanilla, PARAMETROS_DEFAULT } from "@/lib/payroll/calculos-hn";

const linea = (o: Partial<Record<string, unknown>> = {}) => ({
  deducciones: null, cooperativa: 0, prestamos: 0, adelantos: 0, afpEmpleado: 0, otrosDeducciones: 0, ...o,
});

describe("lo que guarda cada línea de cada tipo", () => {
  it("junta dos deducciones del mismo tipo, deja fuera lo que no cobró y ordena por nombre", () => {
    expect(resumirDeducciones([
      { codigo: "PTMO-RAP", nombre: "Préstamo RAP", monto: money(1000) },
      { codigo: "COOP-AUDI", nombre: "Cooperativa AUDI", monto: money(500) },
      { codigo: "PTMO-RAP", nombre: "Préstamo RAP", monto: money(399.41) },
      { codigo: "VALES", nombre: "Vales", monto: money(0) },
    ])).toEqual([
      { codigo: "COOP-AUDI", nombre: "Cooperativa AUDI", monto: "500.00" },
      { codigo: "PTMO-RAP", nombre: "Préstamo RAP", monto: "1399.41" },
    ]);
  });
  it("lo guardado se lee; lo que no se entiende es como si no hubiera", () => {
    expect(leerDeduccionesGuardadas([{ codigo: "A", nombre: "Uno", monto: 5 }])).toEqual([{ codigo: "A", nombre: "Uno", monto: "5.00" }]);
    expect(leerDeduccionesGuardadas(null)).toBeNull();
    expect(leerDeduccionesGuardadas([{ codigo: 1 }])).toBeNull();
  });
});

describe("las deducciones de una línea, por nombre", () => {
  it("de lo guardado al calcular", () => {
    const m = deduccionesPorNombre(linea({ deducciones: [{ codigo: "AFP-ATL", nombre: "AFP Atlántida", monto: "900.00" }], afpEmpleado: 900 }));
    expect([...m.entries()].map(([k, v]) => `${k}=${v.toFixed(2)}`)).toEqual(["AFP Atlántida=900.00"]);
  });
  it("de una línea de antes: lo cobrado registrado, si cuadra con la línea", () => {
    const m = deduccionesPorNombre(linea({ prestamos: 1500 }), [{ nombre: "Préstamo Empresa", monto: 1500 }]);
    expect([...m.keys()]).toEqual(["Préstamo Empresa"]);
  });
  it("si no cuadra (una cuota fija de cada planilla no deja registro), por categoría", () => {
    const m = deduccionesPorNombre(linea({ prestamos: 1500, cooperativa: 400 }), [{ nombre: "Préstamo Empresa", monto: 1500 }]);
    expect([...m.entries()].map(([k, v]) => `${k}=${v.toFixed(2)}`)).toEqual(["Cooperativa=400.00", "Préstamos=1500.00"]);
  });
  it("las columnas: los tipos por nombre y las categorías de antes al final", () => {
    const a = deduccionesPorNombre(linea({ deducciones: [{ codigo: "V", nombre: "Vales", monto: "1" }, { codigo: "C", nombre: "Cooperativa AUDI", monto: "1" }] }));
    const b = deduccionesPorNombre(linea({ otrosDeducciones: 50 }));
    expect(columnasDeDeducciones([a, b])).toEqual(["Cooperativa AUDI", "Vales", "Otras deducciones"]);
  });
});

describe("lo cobrado de cada deducción, también de las de cada planilla", () => {
  it("el repartidor devuelve cada cobro, con y sin plazo", () => {
    const r = aplicarDeducciones([
      { id: "coop", monto: 500, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "COOPERATIVA" },
      { id: "prest", monto: 6000, saldo: 6000, cuotasMeses: 12, cuotasPagadas: 0, tipo: "PRESTAMO" },
      { id: "afp", monto: 900, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "AFP" },
    ]);
    expect(r.cobradas.map((c) => `${c.id}=${c.monto.toFixed(2)}`).sort()).toEqual(["afp=900.00", "coop=500.00", "prest=500.00"]);
    // Sólo el préstamo deja amortización: es lo que se devuelve al anular.
    expect(r.amortizaciones.map((a) => a.id)).toEqual(["prest"]);
  });
});

describe("lo asignado se cobra completo; el borrador avisa (decisión del cliente, 2026-11-21)", () => {
  // Oslin: quincena de 13,000, ISR 600 y AFP 300 → neto de ley 12,100; mínimo de 11,903.13 al mes.
  const topes = topesDelPeriodo(12100, 11903.13 / 2);
  const resumir = (r: ReturnType<typeof aplicarDeducciones>, nombres: Record<string, string>) =>
    resumirDeducciones(r.cobradas.map((c) => ({ codigo: c.id, nombre: nombres[c.id], monto: c.monto, asignado: c.cuota, tope: c.tope })));

  it("el préstamo de banco de la plantilla (2,076.09) se cobra completo y queda que el tope era 1,537.11", () => {
    const r = aplicarDeducciones([{ id: "PREATL", monto: 2076.09, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "PRESTAMO" }], topes);
    expect(r.prestamos.toFixed(2)).toBe("2076.09");
    const linea = resumir(r, { PREATL: "Ptamo. Atlántida" });
    expect(linea).toEqual([{ codigo: "PREATL", nombre: "Ptamo. Atlántida", monto: "2076.09", tope: "1537.11" }]);
    const avisos = avisosDeDeducciones(JSON.parse(JSON.stringify(linea)));
    expect(avisos.sobreTope.map((a) => `${a.nombre} ${a.monto.toFixed(2)} tope ${a.tope.toFixed(2)}`)).toEqual(["Ptamo. Atlántida 2076.09 tope 1537.11"]);
    expect(avisos.incompletas).toEqual([]);
  });

  it("sólo se corta lo que dejaría el salario en negativo, y se avisa cuánto tocaba", () => {
    const r = aplicarDeducciones([
      { id: "COOP", monto: 10000, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "COOPERATIVA" },
      { id: "VALES", monto: 3000, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "VOLUNTARIA" },
    ], topes);
    expect(r.total.toFixed(2)).toBe("12100.00");
    const linea = resumir(r, { COOP: "Coop. Audi", VALES: "Vales" });
    expect(linea.find((d) => d.codigo === "VALES")).toEqual({ codigo: "VALES", nombre: "Vales", monto: "2100.00", asignado: "3000.00" });
    expect(avisosDeDeducciones(linea).incompletas.map((a) => `${a.nombre} ${a.monto.toFixed(2)}/${a.asignado.toFixed(2)}`)).toEqual(["Vales 2100.00/3000.00"]);
  });

  it("una que no alcanzó nada también queda, en cero, para avisarla", () => {
    const r = aplicarDeducciones([
      { id: "COOP", monto: 12100, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "COOPERATIVA" },
      { id: "VALES", monto: 500, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "VOLUNTARIA" },
    ], topes);
    expect(resumir(r, { COOP: "Coop. Audi", VALES: "Vales" }).find((d) => d.codigo === "VALES")).toEqual({ codigo: "VALES", nombre: "Vales", monto: "0.00", asignado: "500.00" });
  });

  it("sin nada que avisar, la línea guarda sólo el monto (como antes)", () => {
    const r = aplicarDeducciones([{ id: "COOP", monto: 500, saldo: null, cuotasMeses: null, cuotasPagadas: 0, tipo: "COOPERATIVA" }], topes);
    expect(resumir(r, { COOP: "Coop. Audi" })).toEqual([{ codigo: "COOP", nombre: "Coop. Audi", monto: "500.00" }]);
  });
});

describe("impuesto vecinal anual", () => {
  it("lo ganado en el año: las planillas de cada mes y, donde no hay, lo importado; sin sumar dos veces", () => {
    const r = ingresosDelAnio(
      [{ mes: 11, bruto: money(10000) }, { mes: 11, bruto: money(10000) }, { mes: 12, bruto: money(20000) }],
      [{ mes: 1, monto: money(18000) }, { mes: 11, monto: money(99999) }],
    );
    expect(r.base.toFixed(2)).toBe("58000.00");
    expect(r.meses).toBe(3);
  });
  it("con el vecinal dado para el período, la planilla no calcula el doceavo", () => {
    const entrada = { salarioMensual: 60000, tipoPlanilla: "QUINCENAL" as const, diasPagables: 15, diasMes: 15, horasExtra: {}, bonificaciones: 0, otrosIngresos: 0, diasAusentes: 0, otrosDeducciones: 0, afpEmpleado: 0, aniosTrabajados: 3 };
    const calculado = calcularPlanilla(entrada, PARAMETROS_DEFAULT);
    expect(calculado.impuestoVecinal.isZero()).toBe(false);
    expect(calcularPlanilla({ ...entrada, vecinalDelPeriodo: 0 }, PARAMETROS_DEFAULT).impuestoVecinal.toFixed(2)).toBe("0.00");
    const confirmado = calcularPlanilla({ ...entrada, vecinalDelPeriodo: 486.25 }, PARAMETROS_DEFAULT);
    expect(confirmado.impuestoVecinal.toFixed(2)).toBe("486.25");
    // Y el neto lo refleja.
    expect(confirmado.salarioNeto.plus(486.25).minus(calcularPlanilla({ ...entrada, vecinalDelPeriodo: 0 }, PARAMETROS_DEFAULT).salarioNeto).abs().lessThan(0.01)).toBe(true);
  });
});
