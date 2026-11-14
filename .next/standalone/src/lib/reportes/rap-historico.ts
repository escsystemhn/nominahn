/**
 * Planilla RAP HISTÓRICA: lo que de verdad se descontó en las planillas del período,
 * por empleado. Es lo que se le paga al RAP, a diferencia de la proyectada, que estima
 * sobre el salario de hoy y no sabe de comisiones ni de mes vencido. PURO.
 *
 * La base declarada de cada mes es lo devengado en ese mes (salario ordinario de sus
 * planillas) o, a mes vencido, la base con que se calculó (ver `rap-mes-vencido.ts`).
 */

import { CERO, money, sumar, type Money, type MoneyInput } from "@/lib/payroll/money";

export interface LineaRapReporte {
  empleadoId: string;
  nombre: string;
  rapNro: string;
  /** Mes de la planilla, «AAAA-MM» (por su fecha final). */
  mes: string;
  salarioBase: MoneyInput;
  rapEmpleado: MoneyInput;
  rapEmpleador: MoneyInput;
  reservaLaboral: MoneyInput;
}

export interface FilaRapReporte {
  empleadoId: string;
  nombre: string;
  rapNro: string;
  /** Salario ordinario devengado en las planillas del período. */
  salario: Money;
  /** Base sobre la que se calculó el RAP de los meses del período. */
  base: Money;
  rapEmpleado: Money;
  rapEmpleador: Money;
  reserva: Money;
  /** Lo que se le entera al RAP: las dos partes del RAP y la Reserva. */
  total: Money;
}

/** Lo que un finiquito tomó del RAP al salir (ver `rapPendienteAlSalir`). */
export interface FiniquitoRap {
  empleadoId: string;
  nombre: string;
  rapNro: string;
  /** Base que se declara con el finiquito: la de los meses que no salieron en planillas. */
  base: MoneyInput;
  rapEmpleado: MoneyInput;
  rapEmpleador: MoneyInput;
  reserva: MoneyInput;
}

/**
 * Una fila por empleado. `baseDeMes` da la base de un mes a mes vencido; `null` quiere
 * decir que ese mes el RAP fue sobre lo devengado en él. Lo que tomaron los finiquitos
 * va en filas propias, «(finiquito)», para que se vea de dónde salió.
 */
export function filasRapHistorico(
  lineas: readonly LineaRapReporte[],
  baseDeMes: (empleadoId: string, mes: string) => Money | null,
  finiquitos: readonly FiniquitoRap[] = []
): { filas: FilaRapReporte[]; totales: Omit<FilaRapReporte, "empleadoId" | "nombre" | "rapNro"> } {
  const porEmpleado = new Map<string, { fila: FilaRapReporte; salarioPorMes: Map<string, Money> }>();
  for (const l of lineas) {
    const actual = porEmpleado.get(l.empleadoId) ?? {
      fila: {
        empleadoId: l.empleadoId, nombre: l.nombre, rapNro: l.rapNro,
        salario: CERO, base: CERO, rapEmpleado: CERO, rapEmpleador: CERO, reserva: CERO, total: CERO,
      },
      salarioPorMes: new Map<string, Money>(),
    };
    const f = actual.fila;
    f.salario = f.salario.plus(money(l.salarioBase));
    f.rapEmpleado = f.rapEmpleado.plus(money(l.rapEmpleado));
    f.rapEmpleador = f.rapEmpleador.plus(money(l.rapEmpleador));
    f.reserva = f.reserva.plus(money(l.reservaLaboral));
    actual.salarioPorMes.set(l.mes, (actual.salarioPorMes.get(l.mes) ?? CERO).plus(money(l.salarioBase)));
    porEmpleado.set(l.empleadoId, actual);
  }

  const filas = [...porEmpleado.values()].map(({ fila, salarioPorMes }) => {
    let base = CERO;
    for (const [mes, salario] of salarioPorMes) base = base.plus(baseDeMes(fila.empleadoId, mes) ?? salario);
    return { ...fila, base, total: sumar(fila.rapEmpleado, fila.rapEmpleador, fila.reserva) };
  });
  for (const f of finiquitos) {
    const rapEmpleado = money(f.rapEmpleado), rapEmpleador = money(f.rapEmpleador), reserva = money(f.reserva);
    filas.push({
      empleadoId: f.empleadoId, nombre: `${f.nombre} (finiquito)`, rapNro: f.rapNro,
      salario: CERO, base: money(f.base), rapEmpleado, rapEmpleador, reserva, total: sumar(rapEmpleado, rapEmpleador, reserva),
    });
  }
  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const suma = (k: "salario" | "base" | "rapEmpleado" | "rapEmpleador" | "reserva" | "total") => sumar(...filas.map((f) => f[k]));
  return {
    filas,
    totales: { salario: suma("salario"), base: suma("base"), rapEmpleado: suma("rapEmpleado"), rapEmpleador: suma("rapEmpleador"), reserva: suma("reserva"), total: suma("total") },
  };
}
