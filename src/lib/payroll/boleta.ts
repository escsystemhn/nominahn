/**
 * Armado del comprobante de pago a partir de una línea de planilla.
 *
 * Vive aquí y no en cada ruta porque la boleta se emite desde TRES salidas —la
 * vista en pantalla y el PDF (`/api/mis-boletas/[id]`) y el envío por correo
 * (`/api/planillas/[id]/email`)— y todas deben decir exactamente lo mismo. Antes
 * cada una construía su propio objeto con tres cifras.
 *
 * Los conceptos en cero no se imprimen: una boleta con diez líneas a L 0.00 es
 * más difícil de leer que una con las tres que aplican.
 */

import { money, aNumero, type MoneyInput } from "./money";
import type { DatosBoleta } from "./comprobante";
import { montoALetras } from "@/lib/documentos/numero-letras";
import { formatCurrency, formatDate, formatDateTime, nombreCompleto } from "@/lib/utils";

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

interface SucursalBoleta {
  id?: string;
  nombre: string;
  direccion?: string | null;
  telefono?: string | null;
  /** RTN del grupo (jerarquía de nómina), que heredan sus unidades. */
  rtn?: string | null;
}

/** Dónde estaba la persona al pagarle. Las líneas muy antiguas no lo guardaron. */
export interface UbicacionBoleta {
  sucursal?: SucursalBoleta | null;
  division?: { nombre: string; rtn?: string | null } | null;
  departamento?: { nombre: string } | null;
  /** Texto guardado en la línea desde el 2026-11-14; antes, null. */
  puesto?: string | null;
}

export interface ContextoBoleta {
  empresa: { nombre: string; rtn: string; direccion?: string | null; telefono?: string | null };
  empleado: {
    codigo: string;
    identidad: string | null;
    primerNombre: string;
    segundoNombre?: string | null;
    primerApellido: string;
    segundoApellido?: string | null;
    sucursal?: SucursalBoleta | null;
    departamento?: { nombre: string } | null;
    puesto?: { nombre: string } | null;
  };
  planilla: { tipo: string; fechaInicio: Date; fechaFin: Date; fechaPago?: Date | null; estado?: string };
  /** La de la línea de planilla: un período cerrado no cambia si la persona se traslada. */
  ubicacion?: UbicacionBoleta;
  /**
   * Jerarquía de nómina encendida: la sucursal del modelo es el «Grupo» y la división,
   * la «Sucursal» (así lo usa el cliente: Grupo PAGSA → San Pedro Sula). Apagada: «Sucursal» y «División».
   */
  jerarquia?: boolean;
  /** Sólo para probar: por omisión, ahora. */
  emitido?: Date;
}

/** Lo que la boleta consulta de la sucursal. */
const SUCURSAL_BOLETA = { select: { id: true, nombre: true, direccion: true, telefono: true, rtn: true } } as const;

/** Lo que la boleta consulta de la línea de planilla, además de sus montos. */
export const UBICACION_BOLETA = {
  sucursal: SUCURSAL_BOLETA,
  division: { select: { nombre: true, rtn: true } },
  departamento: { select: { nombre: true } },
} as const;

/** Lo que la boleta consulta del empleado. */
export const EMPLEADO_BOLETA = {
  id: true, codigo: true, identidad: true,
  primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
  sucursal: SUCURSAL_BOLETA,
  departamento: { select: { nombre: true } },
  // Sólo para líneas que no guardaron el puesto (anteriores al 2026-11-14).
  puesto: { select: { nombre: true } },
} as const;

export const EMPRESA_BOLETA = { select: { nombre: true, rtn: true, direccion: true, telefono: true } } as const;

const TIPO_PLANILLA: Record<string, string> = { SEMANAL: "Planilla semanal", QUINCENAL: "Planilla quincenal", MENSUAL: "Planilla mensual" };

/** Una línea de la boleta, omitida cuando el importe es cero. */
function linea(nombre: string, valor: MoneyInput): Array<[string, string]> {
  return money(valor).isZero() ? [] : [[nombre, formatCurrency(aNumero(valor))]];
}

/** «14.5», no «15»: redondear los días de una media jornada cambia lo que se pagó. */
function cantidad(valor: MoneyInput): string {
  return money(valor).toDecimalPlaces(2).toString();
}

/** «Grupo PAGSA» y no «Grupo Grupo PAGSA»: el nombre ya puede traer la palabra. */
function rotular(etiqueta: string, nombre: string): string {
  return nombre.trim().toLowerCase().startsWith(`${etiqueta.toLowerCase()} `) ? nombre.trim() : `${etiqueta} ${nombre.trim()}`;
}

/**
 * Las líneas de ubicación bajo el nombre de la empresa, de lo general a lo particular.
 * Con la jerarquía de nómina: «Grupo PAGSA», «Sucursal San Pedro Sula». Sin ella:
 * «Sucursal …», «División …». La sucursal que se llama igual que la empresa se omite.
 */
export function ubicacionDeMembrete(sucursal: string | null, division: string | null, jerarquia: boolean): string[] {
  const [primero, segundo] = jerarquia ? ["Grupo", "Sucursal"] : ["Sucursal", "División"];
  return [sucursal ? rotular(primero, sucursal) : null, division ? rotular(segundo, division) : null].filter((l): l is string => !!l);
}

/**
 * Quién paga, para el encabezado: la unidad si tiene RTN propio, si no su grupo si lo
 * tiene, y si no la empresa principal. Las unidades de Grupo PAGSA comparten el RTN del
 * grupo; las de «Confidencial» tienen cada una el suyo (pedido de Edbin, 2026-11-16).
 */
export function entidadLegal(
  empresa: { nombre: string; rtn: string },
  grupo: { nombre: string; rtn?: string | null } | null,
  unidad: { nombre: string; rtn?: string | null } | null
): { nombre: string; rtn: string } {
  if (unidad?.rtn) return { nombre: unidad.nombre, rtn: unidad.rtn };
  if (grupo?.rtn) return { nombre: grupo.nombre, rtn: grupo.rtn };
  return { nombre: empresa.nombre, rtn: empresa.rtn };
}

/** Mismo trato que el reporte: lo de la línea primero; si no lo guardó, lo actual del empleado. */
export function sucursalDeBoleta(ubicacion: UbicacionBoleta | undefined, empleado: ContextoBoleta["empleado"]): SucursalBoleta | null {
  return ubicacion?.sucursal ?? empleado.sucursal ?? null;
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

  const sucursal = sucursalDeBoleta(ctx.ubicacion, ctx.empleado);
  const departamento = ctx.ubicacion?.departamento ?? ctx.empleado.departamento;
  const neto = money(detalle.salarioNeto);
  const entidad = entidadLegal(ctx.empresa, sucursal, ctx.ubicacion?.division ?? null);
  const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  // Una instalación con una sola sucursal suele llamarla igual que la empresa; y el grupo
  // que ya encabeza el comprobante (por su RTN) no se repite debajo.
  const sucursalVisible = sucursal && !igual(sucursal.nombre, ctx.empresa.nombre) && !igual(sucursal.nombre, entidad.nombre) ? sucursal.nombre : null;
  const divisionNombre = ctx.ubicacion?.division?.nombre ?? null;
  const division = divisionNombre && !igual(divisionNombre, entidad.nombre) ? divisionNombre : null;

  return {
    estado: ctx.planilla.estado,
    empresa: entidad.nombre,
    empresaRtn: entidad.rtn,
    sucursal: sucursalVisible,
    ubicacion: ubicacionDeMembrete(sucursalVisible, division, !!ctx.jerarquia),
    direccion: sucursal?.direccion || ctx.empresa.direccion || null,
    telefono: sucursal?.telefono || ctx.empresa.telefono || null,
    division,
    departamento: departamento?.nombre ?? null,
    // El de la línea; una línea anterior al 2026-11-14 no lo guardó y muestra el actual.
    puesto: ctx.ubicacion?.puesto ?? ctx.empleado.puesto?.nombre ?? null,
    nombreEmpleado: nombreCompleto(ctx.empleado),
    codigoEmpleado: ctx.empleado.codigo,
    identidad: ctx.empleado.identidad ?? "—",
    periodo: `${formatDate(ctx.planilla.fechaInicio)} al ${formatDate(ctx.planilla.fechaFin)}`,
    tipoPlanilla: TIPO_PLANILLA[ctx.planilla.tipo] ?? ctx.planilla.tipo,
    fechaPago: ctx.planilla.fechaPago ? formatDate(ctx.planilla.fechaPago) : null,
    diasTrabajados: cantidad(detalle.diasTrabajados),
    horasExtra: cantidad(detalle.horasExtra),

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
    // Un neto negativo se imprime en cifras, pero no tiene forma de leerse en letras.
    netoEnLetras: neto.isNegative() ? null : montoALetras(aNumero(detalle.salarioNeto)),
    emitido: formatDateTime(ctx.emitido ?? new Date()),
  };
}

/** «comprobante-EMP-0001-2026-08-31.pdf». El código lo escriben los usuarios y va en un encabezado. */
export function nombreArchivoComprobante(codigo: string, fechaFin: Date): string {
  const limpio = codigo.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "empleado";
  return `comprobante-${limpio}-${fechaFin.toISOString().slice(0, 10)}.pdf`;
}
