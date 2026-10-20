/**
 * Armado del comprobante de pago a partir de una línea de planilla.
 *
 * Vive aquí y no en cada ruta porque la boleta se emite desde DOS sitios —la
 * descarga del empleado (`/api/mis-boletas/[id]`) y el envío por correo
 * (`/api/planillas/[id]/email`)— y ambas deben producir exactamente el mismo
 * documento. Antes cada una construía su propio objeto con tres cifras.
 *
 * Los conceptos en cero no se imprimen: una boleta con diez líneas a L 0.00 es
 * más difícil de leer que una con las tres que aplican.
 */

import { money, aNumero, type MoneyInput } from "./money";
import { formatCurrency, formatDate, nombreCompleto } from "@/lib/utils";
import type { DatosBoleta } from "@/lib/email/send";

/** Campos de PlanillaDetalle que necesita la boleta. */
export interface DetalleBoleta {
  salarioBase: MoneyInput;
  montoHorasExtra: MoneyInput;
  bonificaciones: MoneyInput;
  otrosIngresos: MoneyInput;
  ihssEmpleado: MoneyInput;
  ivmEmpleado: MoneyInput;
  rapEmpleado: MoneyInput;
  afpEmpleado: MoneyInput;
  isr: MoneyInput;
  impuestoVecinal: MoneyInput;
  cooperativa: MoneyInput;
  prestamos: MoneyInput;
  adelantos: MoneyInput;
  ausencias: MoneyInput;
  /** Opcionales: las planillas anteriores a las incapacidades no los traen. */
  incapacidad?: MoneyInput | null;
  diasIncapacidadIhss?: number | null;
  otrosDeducciones: MoneyInput;
  totalBruto: MoneyInput;
  totalDeducciones: MoneyInput;
  salarioNeto: MoneyInput;
  diasTrabajados: MoneyInput;
  horasExtra: MoneyInput;
  /** El IHSS del empleado es su monto fijo pactado. Opcional: planillas viejas no lo traen. */
  ihssFijo?: boolean;
}

export interface ContextoBoleta {
  empresa: { nombre: string; rtn: string };
  empleado: {
    codigo: string;
    identidad: string | null;
    primerNombre: string;
    segundoNombre?: string | null;
    primerApellido: string;
    segundoApellido?: string | null;
  };
  planilla: { tipo: string; fechaInicio: Date; fechaFin: Date };
}

/** Una línea de la boleta, omitida cuando el importe es cero. */
function linea(nombre: string, valor: MoneyInput): Array<[string, string]> {
  return money(valor).isZero() ? [] : [[nombre, formatCurrency(aNumero(valor))]];
}

export function construirBoleta(detalle: DetalleBoleta, ctx: ContextoBoleta): DatosBoleta {
  // El IHSS se guarda como total EM+IVM; en la boleta se muestra desglosado
  // porque son dos regímenes distintos y el trabajador los ve así en su cuenta.
  //
  // Con monto fijo NO: su reparto EM/IVM es proporcional y sirve a los reportes
  // al IHSS, pero en la boleta dos cifras que no salen de ningún porcentaje sólo
  // invitan a reclamar. Una línea que dice lo que es resulta más honesta.
  const emEmpleado = money(detalle.ihssEmpleado).minus(money(detalle.ivmEmpleado));
  const lineasIHSS = detalle.ihssFijo
    ? linea("IHSS — monto fijo", detalle.ihssEmpleado)
    : [
        ...linea("IHSS — Enfermedad y Maternidad", emEmpleado),
        ...linea("IHSS — Invalidez, Vejez y Muerte", detalle.ivmEmpleado),
      ];

  return {
    empresa: ctx.empresa.nombre,
    empresaRtn: ctx.empresa.rtn,
    nombreEmpleado: nombreCompleto(ctx.empleado),
    codigoEmpleado: ctx.empleado.codigo,
    identidad: ctx.empleado.identidad ?? "—",
    periodo: `${formatDate(ctx.planilla.fechaInicio)} al ${formatDate(ctx.planilla.fechaFin)}`,
    tipoPlanilla: ctx.planilla.tipo,
    diasTrabajados: money(detalle.diasTrabajados).toFixed(0),
    horasExtra: money(detalle.horasExtra).toFixed(2),

    ingresos: [
      ...linea("Salario base", detalle.salarioBase),
      ...linea("Horas extraordinarias", detalle.montoHorasExtra),
      ...linea("Bonificaciones", detalle.bonificaciones),
      ...linea("Otros ingresos", detalle.otrosIngresos),
    ],

    deducciones: [
      ...lineasIHSS,
      ...linea("RAP", detalle.rapEmpleado),
      ...linea("AFP", detalle.afpEmpleado),
      ...linea("ISR retenido", detalle.isr),
      ...linea("Impuesto vecinal", detalle.impuestoVecinal),
      ...linea("Cooperativa", detalle.cooperativa),
      ...linea("Préstamos", detalle.prestamos),
      ...linea("Adelantos", detalle.adelantos),
      ...linea("Ausencias", detalle.ausencias),
      ...linea(detalle.diasIncapacidadIhss ? `Incapacidad IHSS (${detalle.diasIncapacidadIhss} ${detalle.diasIncapacidadIhss === 1 ? "día" : "días"})` : "Incapacidad IHSS", detalle.incapacidad ?? 0),
      ...linea("Otras deducciones", detalle.otrosDeducciones),
    ],

    totalBruto: formatCurrency(aNumero(detalle.totalBruto)),
    totalDeducciones: formatCurrency(aNumero(detalle.totalDeducciones)),
    salarioNeto: formatCurrency(aNumero(detalle.salarioNeto)),
  };
}

/** Campos que la boleta necesita de PlanillaDetalle, para el `select` de Prisma. */
export const SELECT_BOLETA = {
  salarioBase: true,
  montoHorasExtra: true,
  bonificaciones: true,
  otrosIngresos: true,
  ihssEmpleado: true,
  ivmEmpleado: true,
  rapEmpleado: true,
  afpEmpleado: true,
  isr: true,
  impuestoVecinal: true,
  cooperativa: true,
  prestamos: true,
  adelantos: true,
  ausencias: true,
  incapacidad: true,
  diasIncapacidadIhss: true,
  otrosDeducciones: true,
  totalBruto: true,
  totalDeducciones: true,
  salarioNeto: true,
  diasTrabajados: true,
  horasExtra: true,
  ihssFijo: true,
} as const;
