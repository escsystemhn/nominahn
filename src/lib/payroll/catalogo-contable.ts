/**
 * Catálogo contable: definiciones PURAS compartidas por el servidor y las
 * pantallas (no importa Prisma).
 *
 * Misma estructura que el plan de cuentas de Gestión360: seis tipos NIIF, dos
 * naturalezas, árbol por código de la cuenta madre, cuentas de grupo (no reciben
 * asientos) y de detalle. El catálogo por omisión es el de Gestión360 ampliado
 * con las subcuentas que necesita una nómina hondureña: cada concepto del motor
 * (`CUENTAS`) tiene su cuenta de detalle predeterminada.
 */

import { CUENTAS, type ClaveCuenta } from "./partida-contable";

export type TipoCuenta = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "COSTO" | "GASTO";
export type Naturaleza = "DEUDORA" | "ACREEDORA";

export const TIPOS: { v: TipoCuenta; l: string; prefijo: string; naturaleza: Naturaleza; pista: string }[] = [
  { v: "ACTIVO", l: "Activo", prefijo: "1xxx", naturaleza: "DEUDORA", pista: "Recursos controlados por la empresa (NIC 1)" },
  { v: "PASIVO", l: "Pasivo", prefijo: "2xxx", naturaleza: "ACREEDORA", pista: "Obligaciones presentes de la empresa (NIC 37)" },
  { v: "PATRIMONIO", l: "Patrimonio", prefijo: "3xxx", naturaleza: "ACREEDORA", pista: "Participación residual en los activos (NIC 1)" },
  { v: "INGRESO", l: "Ingreso", prefijo: "4xxx", naturaleza: "ACREEDORA", pista: "Incrementos en beneficios económicos (NIIF 15)" },
  { v: "COSTO", l: "Costo", prefijo: "5xxx", naturaleza: "DEUDORA", pista: "Costo de los bienes o servicios vendidos" },
  { v: "GASTO", l: "Gasto", prefijo: "6xxx", naturaleza: "DEUDORA", pista: "Decrementos en beneficios económicos (NIC 1)" },
];

export const ETIQUETA_TIPO: Record<TipoCuenta, string> = {
  ACTIVO: "Activo", PASIVO: "Pasivo", PATRIMONIO: "Patrimonio", INGRESO: "Ingreso", COSTO: "Costo", GASTO: "Gasto",
};

export const ETIQUETA_NATURALEZA: Record<Naturaleza, string> = { DEUDORA: "Deudora", ACREEDORA: "Acreedora" };

/** Naturaleza normal de cada tipo. Una cuenta con la contraria es una CONTRACUENTA. */
export const NATURALEZA_NORMAL: Record<TipoCuenta, Naturaleza> = {
  ACTIVO: "DEUDORA", PASIVO: "ACREEDORA", PATRIMONIO: "ACREEDORA", INGRESO: "ACREEDORA", COSTO: "DEUDORA", GASTO: "DEUDORA",
};

export interface CuentaCatalogo {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  padreCodigo?: string | null;
  esDetalle: boolean;
  esSistema: boolean;
  activa: boolean;
}

export interface NodoCatalogo extends CuentaCatalogo {
  hijos: NodoCatalogo[];
  nivel: number;
}

/** Árbol para la pantalla: raíces ordenadas por código, hijos colgados de `padreCodigo`. */
export function construirArbol(cuentas: CuentaCatalogo[]): NodoCatalogo[] {
  const ordenadas = [...cuentas].sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
  const mapa = new Map<string, NodoCatalogo>();
  for (const c of ordenadas) mapa.set(c.codigo, { ...c, hijos: [], nivel: 0 });
  const raices: NodoCatalogo[] = [];
  for (const c of ordenadas) {
    const nodo = mapa.get(c.codigo)!;
    const padre = c.padreCodigo ? mapa.get(c.padreCodigo) : undefined;
    if (padre && padre !== nodo) padre.hijos.push(nodo);
    else raices.push(nodo);
  }
  const asignarNivel = (nodos: NodoCatalogo[], nivel: number) => {
    for (const n of nodos) {
      n.nivel = nivel;
      asignarNivel(n.hijos, nivel + 1);
    }
  };
  asignarNivel(raices, 0);
  return raices;
}

export const CODIGO_CUENTA = /^[A-Za-z0-9.\-_]{1,20}$/;

export interface DatosCuenta {
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  padreCodigo?: string | null;
  esDetalle: boolean;
  activa?: boolean;
}

/**
 * Validación de forma de una cuenta, compartida por la API y el formulario.
 * Las comprobaciones contra la base (código repetido, madre inexistente) las
 * hace la capa de datos.
 */
export function validarCuenta(d: DatosCuenta, existentes: Pick<CuentaCatalogo, "codigo" | "esDetalle">[] = []): string[] {
  const errores: string[] = [];
  const codigo = d.codigo.trim();
  if (!codigo) errores.push("El código es obligatorio.");
  else if (!CODIGO_CUENTA.test(codigo)) errores.push("El código admite letras, números, punto, guión y guión bajo (hasta 20).");
  if (!d.nombre.trim()) errores.push("El nombre es obligatorio.");
  if (!(d.tipo in NATURALEZA_NORMAL)) errores.push("Tipo de cuenta desconocido.");
  if (d.naturaleza !== "DEUDORA" && d.naturaleza !== "ACREEDORA") errores.push("Naturaleza desconocida.");
  const padre = d.padreCodigo?.trim();
  if (padre) {
    if (padre === codigo) errores.push("Una cuenta no puede ser su propia madre.");
    const p = existentes.find((x) => x.codigo === padre);
    if (existentes.length > 0 && !p) errores.push(`La cuenta madre ${padre} no existe.`);
    else if (p?.esDetalle) errores.push(`La cuenta madre ${padre} es de detalle: sólo una cuenta de grupo puede tener subcuentas.`);
  }
  return errores;
}

/** ¿La naturaleza elegida es la contraria a la normal del tipo? (contracuenta) */
export function esContracuenta(tipo: TipoCuenta, naturaleza: Naturaleza): boolean {
  return NATURALEZA_NORMAL[tipo] !== naturaleza;
}

// ─── Catálogo por omisión ─────────────────────────────────────────────────────

type Fila = [codigo: string, nombre: string, tipo: TipoCuenta, naturaleza: Naturaleza, padre: string, esDetalle: 0 | 1];

/**
 * Plan de cuentas de ejemplo (NIIF para PYMES, Honduras): el de Gestión360 con
 * las subcuentas de nómina que la planilla necesita. Se siembra como «de
 * sistema» cuando el catálogo está vacío; el contador lo renombra, lo amplía o
 * remapea los conceptos a su propio catálogo.
 */
export const CATALOGO_POR_OMISION: Fila[] = [
  ["1", "ACTIVOS", "ACTIVO", "DEUDORA", "", 0],
  ["11", "Activo Corriente", "ACTIVO", "DEUDORA", "1", 0],
  ["1101", "Caja General", "ACTIVO", "DEUDORA", "11", 1],
  ["1102", "Bancos", "ACTIVO", "DEUDORA", "11", 1],
  ["1103", "Cuentas por Cobrar - Clientes", "ACTIVO", "DEUDORA", "11", 1],
  ["1104", "ISV Acreditable", "ACTIVO", "DEUDORA", "11", 1],
  ["1105", "Inventarios", "ACTIVO", "DEUDORA", "11", 1],
  ["1106", "Anticipo a Proveedores", "ACTIVO", "DEUDORA", "11", 1],
  ["1111", "(-) Estimación para Cuentas Incobrables", "ACTIVO", "ACREEDORA", "11", 1],
  ["1112", "Gastos Pagados por Anticipado", "ACTIVO", "DEUDORA", "11", 1],
  ["1113", "Pagos a Cuenta de ISR", "ACTIVO", "DEUDORA", "11", 1],
  ["1114", "Otras Cuentas por Cobrar", "ACTIVO", "DEUDORA", "11", 0],
  ["111401", "Préstamos a Empleados", "ACTIVO", "DEUDORA", "1114", 1],
  ["111402", "Adelantos de Salario a Empleados", "ACTIVO", "DEUDORA", "1114", 1],
  ["12", "Activo No Corriente", "ACTIVO", "DEUDORA", "1", 0],
  ["1201", "Propiedad, Planta y Equipo", "ACTIVO", "DEUDORA", "12", 1],
  ["1202", "(-) Depreciación Acumulada", "ACTIVO", "ACREEDORA", "12", 1],
  ["1203", "Activos Intangibles", "ACTIVO", "DEUDORA", "12", 1],
  ["1204", "(-) Amortización Acumulada de Intangibles", "ACTIVO", "ACREEDORA", "12", 1],

  ["2", "PASIVOS", "PASIVO", "ACREEDORA", "", 0],
  ["21", "Pasivo Corriente", "PASIVO", "ACREEDORA", "2", 0],
  ["2101", "Cuentas por Pagar - Proveedores", "PASIVO", "ACREEDORA", "21", 1],
  ["2102", "ISV por Pagar", "PASIVO", "ACREEDORA", "21", 1],
  ["2103", "Retenciones y Aportes por Pagar", "PASIVO", "ACREEDORA", "21", 0],
  ["210301", "IHSS-EM por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210302", "IHSS-IVM por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210303", "RAP por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210304", "INFOP por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210305", "Reserva Laboral RAP por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210306", "AFP por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210307", "ISR Retenido por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210308", "Impuesto Vecinal por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210309", "Cooperativa por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["210310", "Otras Deducciones por Pagar", "PASIVO", "ACREEDORA", "2103", 1],
  ["2104", "Anticipos de Clientes", "PASIVO", "ACREEDORA", "21", 1],
  ["2105", "Mercadería Recibida No Facturada", "PASIVO", "ACREEDORA", "21", 1],
  ["2106", "Provisión para Prestaciones Laborales", "PASIVO", "ACREEDORA", "21", 0],
  ["210601", "Décimo Tercer Mes por Pagar", "PASIVO", "ACREEDORA", "2106", 1],
  ["210602", "Décimo Cuarto Mes por Pagar", "PASIVO", "ACREEDORA", "2106", 1],
  ["210603", "Vacaciones por Pagar", "PASIVO", "ACREEDORA", "2106", 1],
  ["2109", "ISR por Pagar", "PASIVO", "ACREEDORA", "21", 1],
  ["2110", "Préstamos Bancarios C/P", "PASIVO", "ACREEDORA", "21", 1],
  ["2111", "Sueldos y Salarios por Pagar", "PASIVO", "ACREEDORA", "21", 1],
  ["22", "Pasivo No Corriente", "PASIVO", "ACREEDORA", "2", 0],
  ["2201", "Préstamos Bancarios L/P", "PASIVO", "ACREEDORA", "22", 1],

  ["3", "PATRIMONIO", "PATRIMONIO", "ACREEDORA", "", 0],
  ["31", "Capital", "PATRIMONIO", "ACREEDORA", "3", 0],
  ["3101", "Capital Social", "PATRIMONIO", "ACREEDORA", "31", 1],
  ["3102", "Reserva Legal", "PATRIMONIO", "ACREEDORA", "31", 1],
  ["32", "Resultados", "PATRIMONIO", "ACREEDORA", "3", 0],
  ["3201", "Utilidades Retenidas", "PATRIMONIO", "ACREEDORA", "32", 1],
  ["3301", "Utilidad del Ejercicio", "PATRIMONIO", "ACREEDORA", "32", 1],

  ["4", "INGRESOS", "INGRESO", "ACREEDORA", "", 0],
  ["41", "Ingresos Operativos", "INGRESO", "ACREEDORA", "4", 0],
  ["4101", "Ventas de Mercancías", "INGRESO", "ACREEDORA", "41", 1],
  ["4102", "(-) Descuentos sobre Ventas", "INGRESO", "DEUDORA", "41", 1],
  ["4103", "Devoluciones sobre Ventas", "INGRESO", "DEUDORA", "41", 1],
  ["4104", "Ingresos por Servicios", "INGRESO", "ACREEDORA", "41", 1],
  ["42", "Otros Ingresos", "INGRESO", "ACREEDORA", "4", 0],
  ["4201", "Otros Ingresos", "INGRESO", "ACREEDORA", "42", 1],
  ["4202", "Ingresos Financieros", "INGRESO", "ACREEDORA", "42", 1],
  ["4203", "Ganancia por Diferencial Cambiario", "INGRESO", "ACREEDORA", "42", 1],

  ["5", "COSTOS", "COSTO", "DEUDORA", "", 0],
  ["51", "Costo de Ventas", "COSTO", "DEUDORA", "5", 0],
  ["5101", "Costo de Ventas", "COSTO", "DEUDORA", "51", 1],
  ["5102", "Mano de Obra Directa", "COSTO", "DEUDORA", "51", 1],

  ["6", "GASTOS OPERATIVOS", "GASTO", "DEUDORA", "", 0],
  ["61", "Gastos de Administración", "GASTO", "DEUDORA", "6", 0],
  ["6101", "Gastos de Administración", "GASTO", "DEUDORA", "61", 1],
  ["6102", "Sueldos y Salarios", "GASTO", "DEUDORA", "61", 0],
  ["610201", "Sueldos y Salarios Ordinarios", "GASTO", "DEUDORA", "6102", 1],
  ["610202", "Horas Extra", "GASTO", "DEUDORA", "6102", 1],
  ["610203", "Bonificaciones", "GASTO", "DEUDORA", "6102", 1],
  ["610204", "Otros Ingresos Laborales", "GASTO", "DEUDORA", "6102", 1],
  ["610205", "(-) Descuentos por Ausencias", "GASTO", "ACREEDORA", "6102", 1],
  ["6103", "Alquiler de Local", "GASTO", "DEUDORA", "61", 1],
  ["6104", "Servicios Públicos", "GASTO", "DEUDORA", "61", 1],
  ["6105", "Gasto por Garantías", "GASTO", "DEUDORA", "61", 1],
  ["6106", "Aportaciones Patronales", "GASTO", "DEUDORA", "61", 0],
  ["610601", "Aporte Patronal IHSS-EM", "GASTO", "DEUDORA", "6106", 1],
  ["610602", "Aporte Patronal IHSS-IVM", "GASTO", "DEUDORA", "6106", 1],
  ["610603", "Aporte Patronal RAP", "GASTO", "DEUDORA", "6106", 1],
  ["610604", "Aporte Patronal INFOP", "GASTO", "DEUDORA", "6106", 1],
  ["610605", "Aporte Patronal Reserva Laboral (RAP)", "GASTO", "DEUDORA", "6106", 1],
  ["6107", "Merma y Faltantes de Inventario", "GASTO", "DEUDORA", "61", 1],
  ["6108", "Fletes y Gastos de Compra", "GASTO", "DEUDORA", "61", 1],
  ["6109", "Gasto por Provisión de Prestaciones", "GASTO", "DEUDORA", "61", 0],
  ["610901", "Provisión Décimo Tercer Mes", "GASTO", "DEUDORA", "6109", 1],
  ["610902", "Provisión Décimo Cuarto Mes", "GASTO", "DEUDORA", "6109", 1],
  ["610903", "Provisión Vacaciones", "GASTO", "DEUDORA", "6109", 1],
  ["6110", "Gasto de Depreciación", "GASTO", "DEUDORA", "61", 1],
  ["6111", "Honorarios Profesionales", "GASTO", "DEUDORA", "61", 1],
  ["6112", "Servicios Contratados", "GASTO", "DEUDORA", "61", 1],
  ["62", "Gastos de Ventas", "GASTO", "DEUDORA", "6", 0],
  ["6201", "Gastos de Ventas", "GASTO", "DEUDORA", "62", 1],
  ["7", "GASTOS FINANCIEROS", "GASTO", "DEUDORA", "", 0],
  ["71", "Gastos Financieros", "GASTO", "DEUDORA", "7", 0],
  ["7101", "Intereses y Comisiones Bancarias", "GASTO", "DEUDORA", "71", 1],
  ["7102", "Pérdida por Diferencial Cambiario", "GASTO", "DEUDORA", "71", 1],
  ["8", "IMPUESTO SOBRE LA RENTA", "GASTO", "DEUDORA", "", 0],
  ["81", "Impuesto sobre la Renta", "GASTO", "DEUDORA", "8", 0],
  ["8101", "Gasto por Impuesto sobre la Renta", "GASTO", "DEUDORA", "81", 1],
];

/**
 * Cuenta de detalle del catálogo de ejemplo que recibe cada concepto de la nómina:
 * es el código por omisión del motor, para que no existan dos listas.
 */
export const CUENTA_POR_OMISION: Record<ClaveCuenta, string> = Object.fromEntries(
  (Object.keys(CUENTAS) as ClaveCuenta[]).map((k) => [k, CUENTAS[k].cuenta])
) as Record<ClaveCuenta, string>;

/** Referencia legible (coincide con el motor; lo comprueban las pruebas). */
export const CUENTA_POR_OMISION_REFERENCIA: Record<ClaveCuenta, string> = {
  sueldos: "610201",
  horasExtra: "610202",
  bonificaciones: "610203",
  otrosIngresos: "610204",
  patronalIhss: "610601",
  patronalIvm: "610602",
  patronalRap: "610603",
  patronalInfop: "610604",
  patronalReservaLab: "610605",
  gasto13vo: "610901",
  gasto14vo: "610902",
  gastoVacaciones: "610903",
  descuentoAusencias: "610205",
  ihssPorPagar: "210301",
  ivmPorPagar: "210302",
  rapPorPagar: "210303",
  infopPorPagar: "210304",
  reservaLabPorPagar: "210305",
  afpPorPagar: "210306",
  isrPorPagar: "210307",
  impVecinalPorPagar: "210308",
  cooperativaPorPagar: "210309",
  otrasDeducciones: "210310",
  prestamosEmpleados: "111401",
  adelantosEmpleados: "111402",
  provision13Pagar: "210601",
  provision14Pagar: "210602",
  provisionVacPagar: "210603",
  sueldosPorPagar: "2111",
};

/**
 * Tipos de cuenta que admite cada concepto. Sin esto se podía mandar «Sueldos»
 * a un pasivo: los libros cuadran igual (partida doble) y el error sólo aparece
 * en los estados financieros. Costos y gastos se admiten indistintamente porque
 * cada catálogo decide si la mano de obra es costo o gasto.
 */
const GASTO_O_COSTO: TipoCuenta[] = ["GASTO", "COSTO"];
export const TIPOS_PERMITIDOS: Record<ClaveCuenta, TipoCuenta[]> = {
  sueldos: GASTO_O_COSTO,
  horasExtra: GASTO_O_COSTO,
  bonificaciones: GASTO_O_COSTO,
  otrosIngresos: GASTO_O_COSTO,
  patronalIhss: GASTO_O_COSTO,
  patronalIvm: GASTO_O_COSTO,
  patronalRap: GASTO_O_COSTO,
  patronalInfop: GASTO_O_COSTO,
  patronalReservaLab: GASTO_O_COSTO,
  gasto13vo: GASTO_O_COSTO,
  gasto14vo: GASTO_O_COSTO,
  gastoVacaciones: GASTO_O_COSTO,
  // Reduce el gasto de sueldos: contracuenta de gasto, o un ingreso si el catálogo lo lleva así.
  descuentoAusencias: ["GASTO", "COSTO", "INGRESO"],
  ihssPorPagar: ["PASIVO"],
  ivmPorPagar: ["PASIVO"],
  rapPorPagar: ["PASIVO"],
  infopPorPagar: ["PASIVO"],
  reservaLabPorPagar: ["PASIVO"],
  afpPorPagar: ["PASIVO"],
  isrPorPagar: ["PASIVO"],
  impVecinalPorPagar: ["PASIVO"],
  cooperativaPorPagar: ["PASIVO"],
  otrasDeducciones: ["PASIVO"],
  // Recuperación de lo prestado: abona la cuenta por cobrar al empleado.
  prestamosEmpleados: ["ACTIVO"],
  adelantosEmpleados: ["ACTIVO"],
  provision13Pagar: ["PASIVO"],
  provision14Pagar: ["PASIVO"],
  provisionVacPagar: ["PASIVO"],
  sueldosPorPagar: ["PASIVO"],
};

/** Nombre del concepto tal como lo conoce el contador, y a qué tarea pertenece. */
export const CLAVES_ORDENADAS: ClaveCuenta[] = Object.keys(CUENTAS) as ClaveCuenta[];

export interface SeccionMapeo {
  id: string;
  titulo: string;
  ayuda: string;
  /** Ejemplo del asiento con las cuentas asignadas; `a(clave)` devuelve «código nombre». */
  ejemplo: (a: (clave: ClaveCuenta) => string) => string[];
  claves: { clave: ClaveCuenta; etiqueta: string; detalle: string }[];
}

/**
 * Las claves agrupadas por lo que el contador HACE, no por tipo de cuenta: quien
 * configura piensa «¿a dónde va el ISR que retengo?», no «¿qué pasivos tengo?».
 */
export const SECCIONES_MAPEO: SeccionMapeo[] = [
  {
    id: "sueldos",
    titulo: "Sueldos e ingresos del empleado",
    ayuda: "El gasto de la planilla. Es lo único que se reparte por centro de costo.",
    ejemplo: (a) => [
      `Planilla aprobada → Débito ${a("sueldos")} por el salario ordinario, ${a("horasExtra")} por las extras y ${a("bonificaciones")} por los bonos`,
      `Ausencia injustificada → Crédito ${a("descuentoAusencias")} (reduce el gasto de sueldos)`,
    ],
    claves: [
      { clave: "sueldos", etiqueta: "Sueldos y salarios ordinarios", detalle: "Salario base del período, proporcional a los días con derecho a salario." },
      { clave: "horasExtra", etiqueta: "Horas extra", detalle: "Recargos del Art. 330: diurna, nocturna y feriado." },
      { clave: "bonificaciones", etiqueta: "Bonificaciones", detalle: "Bonos por evaluación de desempeño aplicados en la planilla." },
      { clave: "otrosIngresos", etiqueta: "Otros ingresos laborales", detalle: "Otros pagos gravables al empleado." },
      { clave: "descuentoAusencias", etiqueta: "Descuentos por ausencias", detalle: "Días no trabajados sin justificar, descontados al doble. Crédito contra el gasto." },
    ],
  },
  {
    id: "patronales",
    titulo: "Aportes patronales",
    ayuda: "Lo que la empresa paga a las instituciones además del sueldo.",
    ejemplo: (a) => [
      `Planilla aprobada → Débito ${a("patronalIhss")}, ${a("patronalIvm")}, ${a("patronalRap")}, ${a("patronalInfop")} y ${a("patronalReservaLab")} · Crédito su «por pagar»`,
    ],
    claves: [
      { clave: "patronalIhss", etiqueta: "Aporte patronal IHSS-EM", detalle: "5 % sobre el salario hasta el techo (Enfermedad y Maternidad)." },
      { clave: "patronalIvm", etiqueta: "Aporte patronal IHSS-IVM", detalle: "3.5 % hasta el techo (Invalidez, Vejez y Muerte)." },
      { clave: "patronalRap", etiqueta: "Aporte patronal RAP", detalle: "1.5 % sobre el excedente del piso, hasta el techo (FOVIIF)." },
      { clave: "patronalInfop", etiqueta: "Aporte patronal INFOP", detalle: "1 % del salario, sin techo." },
      { clave: "patronalReservaLab", etiqueta: "Fondo de Reserva Laboral", detalle: "4 % patronal al RAP (Decreto 47-2024), topado en tres salarios mínimos." },
    ],
  },
  {
    id: "retenciones",
    titulo: "Retenciones y aportes por pagar",
    ayuda: "Lo retenido al empleado y lo aportado por la empresa, pendiente de enterar a cada institución.",
    ejemplo: (a) => [
      `Planilla aprobada → Crédito ${a("ihssPorPagar")} (parte del empleado más la patronal), ${a("rapPorPagar")}, ${a("isrPorPagar")}, ${a("impVecinalPorPagar")}…`,
      `Al pagar al IHSS → Débito ${a("ihssPorPagar")} · Crédito Bancos`,
    ],
    claves: [
      { clave: "ihssPorPagar", etiqueta: "IHSS-EM por pagar", detalle: "Cuota del empleado más el aporte patronal del régimen EM." },
      { clave: "ivmPorPagar", etiqueta: "IHSS-IVM por pagar", detalle: "Cuota del empleado más el aporte patronal del régimen IVM." },
      { clave: "rapPorPagar", etiqueta: "RAP por pagar", detalle: "Aporte del empleado más el patronal al fondo de vivienda." },
      { clave: "infopPorPagar", etiqueta: "INFOP por pagar", detalle: "Aporte patronal pendiente de enterar." },
      { clave: "reservaLabPorPagar", etiqueta: "Reserva laboral RAP por pagar", detalle: "Aporte patronal del 4 % pendiente de enterar al RAP." },
      { clave: "afpPorPagar", etiqueta: "AFP por pagar", detalle: "Aportes voluntarios retenidos para la administradora de pensiones." },
      { clave: "isrPorPagar", etiqueta: "ISR retenido por pagar", detalle: "Impuesto sobre la renta retenido en planilla, pendiente de declarar al SAR." },
      { clave: "impVecinalPorPagar", etiqueta: "Impuesto vecinal por pagar", detalle: "Impuesto personal municipal retenido, pendiente de enterar a la alcaldía." },
      { clave: "cooperativaPorPagar", etiqueta: "Cooperativa por pagar", detalle: "Cuotas retenidas a favor de la cooperativa de empleados." },
      { clave: "otrasDeducciones", etiqueta: "Otras deducciones por pagar", detalle: "Cualquier otra retención a favor de un tercero." },
    ],
  },
  {
    id: "prestamos",
    titulo: "Préstamos y adelantos",
    ayuda: "Lo que la empresa prestó o adelantó al empleado y recupera por planilla.",
    ejemplo: (a) => [
      `Cuota descontada → Crédito ${a("prestamosEmpleados")} o ${a("adelantosEmpleados")}: recupera la cuenta por cobrar al empleado`,
    ],
    claves: [
      { clave: "prestamosEmpleados", etiqueta: "Préstamos a empleados", detalle: "Cuenta por cobrar que se abona con cada cuota descontada." },
      { clave: "adelantosEmpleados", etiqueta: "Adelantos de salario", detalle: "Cuenta por cobrar que se abona al descontar el adelanto." },
    ],
  },
  {
    id: "prestaciones",
    titulo: "Provisiones de prestaciones",
    ayuda: "El décimo tercero, el décimo cuarto y las vacaciones que se van ganando cada período.",
    ejemplo: (a) => [
      `Provisión del período → Débito ${a("gasto13vo")}, ${a("gasto14vo")} y ${a("gastoVacaciones")} · Crédito ${a("provision13Pagar")}, ${a("provision14Pagar")} y ${a("provisionVacPagar")}`,
      `Al pagar el décimo se usa lo provisionado`,
    ],
    claves: [
      { clave: "gasto13vo", etiqueta: "Gasto por décimo tercer mes", detalle: "Provisión mensual del aguinaldo (Decreto 112-82)." },
      { clave: "gasto14vo", etiqueta: "Gasto por décimo cuarto mes", detalle: "Provisión mensual del décimo cuarto (Decreto 135-94)." },
      { clave: "gastoVacaciones", etiqueta: "Gasto por vacaciones", detalle: "Provisión de los días de vacaciones devengados (Art. 346)." },
      { clave: "provision13Pagar", etiqueta: "Décimo tercer mes por pagar", detalle: "Pasivo acumulado hasta que se paga en diciembre." },
      { clave: "provision14Pagar", etiqueta: "Décimo cuarto mes por pagar", detalle: "Pasivo acumulado hasta que se paga en junio." },
      { clave: "provisionVacPagar", etiqueta: "Vacaciones por pagar", detalle: "Pasivo acumulado por vacaciones devengadas y no gozadas." },
    ],
  },
  {
    id: "neto",
    titulo: "Neto a pagar",
    ayuda: "Lo que se le debe al empleado al cerrar la planilla, hasta que se paga.",
    ejemplo: (a) => [
      `Planilla aprobada → Crédito ${a("sueldosPorPagar")} por el neto; al pagar → Débito ${a("sueldosPorPagar")} · Crédito Bancos`,
    ],
    claves: [
      { clave: "sueldosPorPagar", etiqueta: "Sueldos por pagar (neto)", detalle: "Neto a pagar a los empleados de la planilla." },
    ],
  },
];
