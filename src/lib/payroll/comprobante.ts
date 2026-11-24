/**
 * El comprobante de pago: qué dice. Cómo se ve lo deciden sus dos salidas,
 * `comprobante-html.ts` (pantalla y correo) y `comprobante-pdf.ts` (descarga).
 *
 * Los importes llegan YA FORMATEADOS: quien construye la boleta tiene los
 * `Decimal` y decide cómo presentarlos; aquí no se hace aritmética.
 */

export interface DatosBoleta {
  /** Estado de la planilla: fuera de aprobada o pagada, el documento lo advierte. */
  estado?: string;
  empresa: string;
  empresaRtn: string;
  /** `null`: se llama igual que la empresa, o la línea no la guardó. */
  sucursal?: string | null;
  /**
   * Las líneas de ubicación del membrete, ya rotuladas y de lo general a lo particular:
   * «Grupo PAGSA», «Sucursal San Pedro Sula» (ver `ubicacionDeMembrete`). Sin ellas se
   * imprime «Sucursal …» con `sucursal`, como antes.
   */
  ubicacion?: string[];
  direccion?: string | null;
  telefono?: string | null;
  division?: string | null;
  departamento?: string | null;
  puesto?: string | null;
  nombreEmpleado: string;
  codigoEmpleado: string;
  identidad: string;
  periodo: string;
  tipoPlanilla: string;
  fechaPago?: string | null;
  diasTrabajados: string;
  horasExtra: string;
  /**
   * El sueldo mensual que regía en el período, formateado (pedido del 2026-11-24). No es
   * el «Salario base» de los ingresos, que es lo del período (la mitad en una quincena).
   */
  salarioMensual?: string | null;
  /** Pares [concepto, importe formateado], en el orden en que se imprimen. */
  ingresos: Array<[string, string]>;
  deducciones: Array<[string, string]>;
  totalBruto: string;
  totalDeducciones: string;
  salarioNeto: string;
  netoEnLetras?: string | null;
  emitido?: string;
}

const AVISOS: Record<string, { texto: string; marca: string }> = {
  BORRADOR: { texto: "Borrador: planilla sin confirmar. No es un comprobante de pago.", marca: "BORRADOR" },
  CALCULADA: { texto: "Planilla confirmada, todavía sin aprobar. No es un comprobante de pago.", marca: "SIN APROBAR" },
  ANULADA: { texto: "Planilla anulada. Este comprobante no tiene validez.", marca: "ANULADA" },
};

/**
 * Lo que debe advertir un comprobante de una planilla que aún no se paga o que se
 * anuló. Antes sólo se marcaba el borrador: uno de una planilla anulada se
 * imprimía igual que uno válido.
 */
export function avisoDeEstado(estado: string | undefined): { texto: string; marca: string } | null {
  return (estado && AVISOS[estado]) || null;
}

/** Sólo un comprobante vigente lleva dónde firmar: nadie debe firmar por un borrador. */
export const seFirma = (d: Pick<DatosBoleta, "estado">) => !avisoDeEstado(d.estado);

/**
 * Las líneas bajo el nombre de la empresa, en el orden en que se imprimen: primero
 * el grupo y la sucursal (pedido del 2026-11-14), luego RTN y contacto en una línea.
 */
export function lineasDeMembrete(d: DatosBoleta): string[] {
  const ubicacion = d.ubicacion ?? (d.sucursal ? [`Sucursal ${d.sucursal}`] : []);
  const contacto = [`RTN ${d.empresaRtn}`, d.direccion, d.telefono ? `Tel. ${d.telefono}` : null].filter(Boolean).join(" · ");
  return [...ubicacion, contacto];
}

/**
 * Los datos de la persona, por filas de hasta dos, sin los que no aplican. Van por
 * grupos porque se leen juntos: repartirlos de dos en dos en orden dejaba las horas
 * extra solas en una fila, lejos de los días trabajados.
 */
export function filasDelTrabajador(d: DatosBoleta): Array<Array<[string, string]>> {
  const grupos: Array<Array<[string, string | null | undefined]>> = [
    [["Código", d.codigoEmpleado], ["Identidad", d.identidad]],
    // El sueldo mensual bajo la identidad, en la línea de los días trabajados (pedido del 2026-11-24).
    [["Días trabajados", d.diasTrabajados], ["Sueldo mensual", d.salarioMensual]],
    // La división ya va en el membrete (como sucursal o división): aquí, el puesto.
    [["Puesto", d.puesto], ["Departamento", d.departamento]],
    [["Horas extra", Number(d.horasExtra) > 0 ? d.horasExtra : null]],
  ];
  const filas = grupos
    .map((g) => g.filter((f): f is [string, string] => !!f[1]))
    .filter((g) => g.length > 0);
  // Dos filas de un solo dato caben en una.
  const [a, b] = filas.slice(-2);
  if (filas.length >= 2 && a.length === 1 && b.length === 1) filas.splice(-2, 2, [...a, ...b]);
  return filas;
}

/**
 * Los mismos datos en la cuadrícula de cuatro columnas del PDF (el comprobante impreso).
 * Fija, no por orden de llegada, para que cada dato caiga siempre en su lugar: el sueldo
 * mensual bajo la identidad y en la línea de los días trabajados (pedido del 2026-11-24).
 * Cuatro y no tres para seguir en dos filas: una tercera no cabe en media hoja con todas
 * las deducciones. Un dato que no aplica deja su celda en blanco.
 */
export function cuadriculaDelTrabajador(d: DatosBoleta): Array<Array<[string, string] | null>> {
  const dato = (etiqueta: string, valor: string | null | undefined): [string, string] | null => (valor ? [etiqueta, valor] : null);
  return [
    [dato("Código", d.codigoEmpleado), dato("Identidad", d.identidad), dato("Puesto", d.puesto), dato("Departamento", d.departamento)],
    [dato("Días trabajados", d.diasTrabajados), dato("Sueldo mensual", d.salarioMensual), dato("Horas extra", Number(d.horasExtra) > 0 ? d.horasExtra : null), null],
  ].filter((fila) => fila.some(Boolean));
}

export const PIE_COMPROBANTE = "Si encuentra una diferencia, consulte a Recursos Humanos.";
