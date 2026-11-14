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
    // La división ya va en el membrete (como sucursal o división): aquí, el puesto.
    [["Puesto", d.puesto], ["Departamento", d.departamento]],
    [["Días trabajados", d.diasTrabajados], ["Horas extra", Number(d.horasExtra) > 0 ? d.horasExtra : null]],
  ];
  const filas = grupos
    .map((g) => g.filter((f): f is [string, string] => !!f[1]))
    .filter((g) => g.length > 0);
  // Dos filas de un solo dato caben en una.
  const [a, b] = filas.slice(-2);
  if (filas.length >= 2 && a.length === 1 && b.length === 1) filas.splice(-2, 2, [...a, ...b]);
  return filas;
}

export const PIE_COMPROBANTE = "Si encuentra una diferencia, consulte a Recursos Humanos.";
