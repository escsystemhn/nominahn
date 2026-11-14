/**
 * Reportes de planilla agrupados por la estructura organizacional
 * (Sucursal → División → Departamento → Empleado), con subtotales por nivel.
 * PURO: recibe las líneas ya cargadas y devuelve la tabla del reporte.
 */

import { agruparPorEstructura, aplanarEstructura, etiquetasNiveles, type GrupoEstructura, type NivelesEstructura, type Ubicacion, type Unidad } from "@/lib/organizacion/estructura";
import { aNumero, sumarPor, type Money } from "@/lib/payroll/money";
import { formatCurrency } from "@/lib/utils";
import type { HojaReporte, MetaFila } from "./salida-celdas";

/**
 * Una línea de planilla ya resumida para el reporte. Lo devengado y lo deducido van
 * con sus partes, de modo que cada fila se pueda comprobar a mano: salario + horas
 * extra + otros ingresos = total devengado; la suma de las deducciones = total
 * deducciones; devengado − deducciones = neto a pagar.
 */
export interface LineaPlanilla {
  empleadoId: string;
  nombre: string;
  ubicacion: Ubicacion;
  /** Días efectivamente trabajados (sin ausencias ni incapacidad a cargo del IHSS). */
  dias: number;
  /** Salario ordinario del período, por los días con derecho a salario. */
  salario: Money;
  horasExtra: Money;
  /** Bonificaciones y otros ingresos. */
  otrosIngresos: Money;
  devengado: Money;
  ihss: Money;
  rap: Money;
  afp: Money;
  isr: Money;
  vecinal: Money;
  /** Cooperativa, préstamos, adelantos y demás deducciones por empleado. */
  otras: Money;
  /** Descuento por ausencias y por los días de incapacidad que paga el IHSS. */
  ausencias: Money;
  deducciones: Money;
  neto: Money;
  patronal: Money;
}

const SUMABLES = ["salario", "horasExtra", "otrosIngresos", "devengado", "ihss", "rap", "afp", "isr", "vecinal", "otras", "ausencias", "deducciones", "neto", "patronal"] as const;

/**
 * Una fila por persona y lugar: si el reporte abarca varias planillas (las dos
 * quincenas del mes), se suman. Sin columna de período, dos filas iguales de la misma
 * persona serían imposibles de distinguir. Si cambió de departamento entre una y otra,
 * sale en cada uno con lo que ganó allí.
 */
export function consolidarPorEmpleado(lineas: readonly LineaPlanilla[]): LineaPlanilla[] {
  const porClave = new Map<string, LineaPlanilla>();
  for (const l of lineas) {
    const u = l.ubicacion;
    const clave = [l.empleadoId, u.sucursal.id, u.division?.id ?? "", u.departamento.id].join("|");
    const actual = porClave.get(clave);
    if (!actual) { porClave.set(clave, { ...l }); continue; }
    actual.dias += l.dias;
    for (const k of SUMABLES) actual[k] = actual[k].plus(l[k]);
  }
  return [...porClave.values()];
}

export interface TablaAgrupada {
  cabeceras: string[];
  datos: string[][];
  filas: MetaFila[];
}

/**
 * Dónde estaba la persona al pagarse: la ubicación guardada en la línea; si la
 * línea es anterior a esas columnas, la actual del empleado. Con las divisiones
 * apagadas no hay división, y el reporte agrupa Sucursal → Departamento.
 */
export function ubicacionDeLinea(
  d: {
    sucursal?: Unidad | null;
    division?: Unidad | null;
    departamento?: Unidad | null;
    empleado: { sucursal: Unidad; departamento: Unidad & { division?: Unidad | null } };
  },
  conDivisiones: boolean
): Ubicacion {
  const guardada = d.departamento && d.sucursal;
  const sucursal = guardada ? d.sucursal! : d.empleado.sucursal;
  const departamento = guardada ? d.departamento! : d.empleado.departamento;
  const division = guardada ? d.division ?? null : d.empleado.departamento.division ?? null;
  return {
    sucursal: { id: sucursal.id, nombre: sucursal.nombre },
    division: conDivisiones && division ? { id: division.id, nombre: division.nombre } : null,
    departamento: { id: departamento.id, nombre: departamento.nombre },
  };
}

const NIVELES_BASE = etiquetasNiveles(false);
const agrupar = (lineas: LineaPlanilla[], niveles: NivelesEstructura) => agruparPorEstructura(lineas, (l) => l.ubicacion, niveles.sinDivision);

const L = (m: Money) => formatCurrency(aNumero(m));
const personas = (lineas: LineaPlanilla[]) => new Set(lineas.map((l) => l.empleadoId)).size;

/**
 * Columnas de la planilla detallada. Sin período: cada fila es una persona (ver
 * `consolidarPorEmpleado`) y el período va en el subtítulo del reporte.
 */
export const CABECERAS_DETALLE = [
  "Empleado", "Días trab.", "Salario", "Horas extra", "Otros ingresos", "Total devengado",
  "IHSS", "RAP", "AFP", "ISR", "Imp. vecinal", "Otras ded.", "Ausencias e incap.", "Total deducciones", "Neto a pagar",
];

const montosDetalle = (ls: LineaPlanilla[]) => [
  L(sumarPor(ls, (l) => l.salario)), L(sumarPor(ls, (l) => l.horasExtra)), L(sumarPor(ls, (l) => l.otrosIngresos)),
  L(sumarPor(ls, (l) => l.devengado)),
  L(sumarPor(ls, (l) => l.ihss)), L(sumarPor(ls, (l) => l.rap)), L(sumarPor(ls, (l) => l.afp)), L(sumarPor(ls, (l) => l.isr)),
  L(sumarPor(ls, (l) => l.vecinal)), L(sumarPor(ls, (l) => l.otras)), L(sumarPor(ls, (l) => l.ausencias)),
  L(sumarPor(ls, (l) => l.deducciones)), L(sumarPor(ls, (l) => l.neto)),
];

/** «15», «14.5»: los días pueden traer medio día. */
const dias = (n: number) => String(Math.round(n * 100) / 100);
const cuantos = (ls: LineaPlanilla[]) => {
  const n = personas(ls);
  return `${n} ${n === 1 ? "empleado" : "empleados"}`;
};

const porNombre = (lineas: LineaPlanilla[]) => [...lineas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

/**
 * Las filas de unos grupos, con encabezado y subtotal en cada uno, y su total al final.
 * Cuántos empleados va en el rótulo del subtotal: la columna de días queda sólo con
 * números, para que el Excel la pueda sumar.
 */
function tablaDetalle(grupos: GrupoEstructura<LineaPlanilla>[], lineas: LineaPlanilla[], rotuloTotal: string): TablaAgrupada {
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const e of aplanarEstructura(grupos)) {
    if (e.tipo === "grupo") {
      datos.push([e.grupo.nombre, ...CABECERAS_DETALLE.slice(1).map(() => "")]);
    } else if (e.tipo === "detalle") {
      datos.push([e.item.nombre, dias(e.item.dias), ...montosDetalle([e.item])]);
    } else {
      datos.push([`Subtotal ${e.grupo.nombre} (${cuantos(e.grupo.items)})`, "", ...montosDetalle(e.grupo.items)]);
    }
    filas.push({ tipo: e.tipo, nivel: e.nivel });
  }
  if (lineas.length) {
    datos.push([`${rotuloTotal} (${cuantos(lineas)})`, "", ...montosDetalle(lineas)]);
    filas.push({ tipo: "total", nivel: 0 });
  }
  return { cabeceras: CABECERAS_DETALLE, datos, filas };
}

const tieneEmpresas = (g: GrupoEstructura<LineaPlanilla>) => g.hijos.some((h) => h.nivel === "DIVISION");

/**
 * El detalle hasta el total de cada empresa (división): departamentos con su subtotal
 * y la empresa con el suyo. El subtotal del grupo (sucursal) y el total general van en
 * el resumen de la última página. Un grupo sin empresas conserva su subtotal: ahí él
 * es la empresa.
 */
function filasDetalle(grupos: GrupoEstructura<LineaPlanilla>[]): Omit<TablaAgrupada, "cabeceras"> {
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const e of aplanarEstructura(grupos)) {
    if (e.tipo === "subtotal" && e.grupo.nivel === "SUCURSAL" && tieneEmpresas(e.grupo)) continue;
    if (e.tipo === "grupo") datos.push([e.grupo.nombre, ...CABECERAS_DETALLE.slice(1).map(() => "")]);
    else if (e.tipo === "detalle") datos.push([e.item.nombre, dias(e.item.dias), ...montosDetalle([e.item])]);
    else datos.push([`Subtotal ${e.grupo.nombre} (${cuantos(e.grupo.items)})`, "", ...montosDetalle(e.grupo.items)]);
    filas.push({ tipo: e.tipo, nivel: e.nivel });
  }
  return { datos, filas };
}

/**
 * Resumen para la última página, con las mismas columnas que el detalle: cada empresa
 * con su total, el subtotal de su grupo y el total general. Un grupo sin empresas es
 * una sola fila.
 */
export function tablaResumenPorEmpresa(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE): TablaAgrupada {
  const consolidadas = consolidarPorEmpleado(lineas);
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const g of agrupar(porNombre(consolidadas), niveles)) {
    // Cada fila del resumen es un total, no un registro: así no se cuentan como empleados.
    if (!tieneEmpresas(g)) {
      datos.push([`${g.nombre} (${cuantos(g.items)})`, "", ...montosDetalle(g.items)]);
      filas.push({ tipo: "subtotal", nivel: 0 });
      continue;
    }
    datos.push([g.nombre, ...CABECERAS_DETALLE.slice(1).map(() => "")]);
    filas.push({ tipo: "grupo", nivel: 0 });
    for (const empresa of g.hijos) {
      datos.push([`${empresa.nombre} (${cuantos(empresa.items)})`, "", ...montosDetalle(empresa.items)]);
      filas.push({ tipo: "subtotal", nivel: 1 });
    }
    datos.push([`Subtotal ${g.nombre} (${cuantos(g.items)})`, "", ...montosDetalle(g.items)]);
    filas.push({ tipo: "subtotal", nivel: 0 });
  }
  if (consolidadas.length) {
    datos.push([`TOTAL GENERAL (${cuantos(consolidadas)})`, "", ...montosDetalle(consolidadas)]);
    filas.push({ tipo: "total", nivel: 0 });
  }
  // Las filas son grupos y empresas, no empleados: la primera columna lo dice.
  const primera = agrupar(consolidadas, niveles).some(tieneEmpresas) ? `${niveles.sucursalCorta} / ${niveles.division}` : niveles.sucursalCorta;
  return { cabeceras: [primera, ...CABECERAS_DETALLE.slice(1)], datos, filas };
}

/** «2 empresas, 10 empleados»: lo que dice el resumen debajo del título, en vez de contar registros. */
function descripcionResumen(lineas: LineaPlanilla[], niveles: NivelesEstructura): string {
  const grupos = agrupar(lineas, niveles);
  const empresas = grupos.reduce((n, g) => n + (tieneEmpresas(g) ? g.hijos.length : 1), 0);
  const conEmpresas = grupos.some(tieneEmpresas);
  const singular = (conEmpresas ? niveles.division : niveles.sucursalCorta).toLowerCase();
  const plural = conEmpresas ? niveles.divisiones.toLowerCase() : `${singular}${singular.endsWith("l") ? "es" : "s"}`;
  return `Resumen: ${empresas} ${empresas === 1 ? singular : plural}, ${cuantos(lineas)}`;
}

/**
 * Para ver en pantalla y en CSV: el detalle y, al final, el resumen, en una sola tabla.
 * Para imprimir (PDF y Excel) se usa `hojasPlanillaDetallada`, que pone el resumen en
 * su propia página.
 */
export function tablaPlanillaDetallada(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE): TablaAgrupada {
  const detalle = filasDetalle(agrupar(porNombre(consolidarPorEmpleado(lineas)), niveles));
  if (!lineas.length) return { cabeceras: CABECERAS_DETALLE, ...detalle };
  const resumen = tablaResumenPorEmpresa(lineas, niveles);
  return {
    cabeceras: CABECERAS_DETALLE,
    datos: [...detalle.datos, ["RESUMEN DE LA PLANILLA", ...CABECERAS_DETALLE.slice(1).map(() => "")], ...resumen.datos],
    filas: [...detalle.filas, { tipo: "grupo", nivel: 0 }, ...resumen.filas],
  };
}

/** Para imprimir: el detalle hasta el total de cada empresa y, en la última página, el resumen. */
export function hojasPlanillaDetallada(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE): HojaReporte[] {
  if (!lineas.length) return [];
  const detalle = filasDetalle(agrupar(porNombre(consolidarPorEmpleado(lineas)), niveles));
  return [
    { nombre: "", pestana: "Detalle", cabeceras: CABECERAS_DETALLE, ...detalle },
    { nombre: "Resumen de la planilla", pestana: "Resumen", descripcion: descripcionResumen(lineas, niveles), ...tablaResumenPorEmpresa(lineas, niveles) },
  ];
}

/**
 * La nómina para imprimir cada división en su hoja: una por división, con sus
 * departamentos y su total, y una última con el resumen de toda la planilla, para
 * que el total general siga a la vista. Una sucursal que no usa divisiones ocupa una
 * sola hoja: nadie se queda fuera de lo impreso. `rtns` da el RTN de cada división
 * para la cabecera de su hoja; la que no lo tiene sale sólo con su nombre.
 */
export function hojasPorDivision(
  lineas: LineaPlanilla[],
  niveles: NivelesEstructura = NIVELES_BASE,
  rtns: ReadonlyMap<string, string> = new Map()
): HojaReporte[] {
  const hojas: HojaReporte[] = [];
  for (const sucursal of agrupar(porNombre(consolidarPorEmpleado(lineas)), niveles)) {
    const conDivisiones = sucursal.hijos.some((h) => h.nivel === "DIVISION");
    if (!conDivisiones) {
      hojas.push({ nombre: sucursal.nombre, pestana: sucursal.nombre, ...tablaDetalle(sucursal.hijos, sucursal.items, `TOTAL ${sucursal.nombre}`) });
      continue;
    }
    for (const division of sucursal.hijos) {
      const rtn = division.id ? rtns.get(division.id) : undefined;
      hojas.push({
        nombre: `${sucursal.nombre} / ${division.nombre}${rtn ? `, RTN ${rtn}` : ""}`,
        pestana: division.nombre,
        ...tablaDetalle(division.hijos, division.items, `TOTAL ${division.nombre}`),
      });
    }
  }
  // El total general sólo en la última página: cada hoja cierra con el total de su empresa.
  if (hojas.length > 1) {
    hojas.push({ nombre: "Resumen de toda la planilla", pestana: "Resumen", descripcion: descripcionResumen(lineas, niveles), ...tablaResumenPorEmpresa(lineas, niveles) });
  }
  return hojas;
}

/**
 * Resumen: una fila por sucursal, división y departamento con sus totales, en
 * forma de árbol (cada nivel antes de su contenido), y el total general.
 */
export function tablaResumenPlanilla(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE): TablaAgrupada {
  const cabeceras = [`${niveles.sucursalCorta} / ${niveles.division} / Departamento`, "Empleados", "Total devengado", "Total deducciones", "Neto a pagar", "Costo patronal"];
  const fila = (nombre: string, ls: LineaPlanilla[]) => [
    nombre, String(personas(ls)),
    L(sumarPor(ls, (l) => l.devengado)), L(sumarPor(ls, (l) => l.deducciones)),
    L(sumarPor(ls, (l) => l.neto)), L(sumarPor(ls, (l) => l.patronal)),
  ];
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  const visitar = (g: GrupoEstructura<LineaPlanilla>, nivel: number) => {
    datos.push(fila(g.nombre, g.items));
    // Los departamentos son las hojas del resumen; los niveles de arriba, sus subtotales.
    filas.push({ tipo: g.hijos.length ? "subtotal" : "detalle", nivel });
    for (const h of g.hijos) visitar(h, nivel + 1);
  };
  for (const g of agrupar(lineas, niveles)) visitar(g, 0);
  if (lineas.length) {
    datos.push(fila("TOTAL GENERAL", lineas));
    filas.push({ tipo: "total", nivel: 0 });
  }
  return { cabeceras, datos, filas };
}
