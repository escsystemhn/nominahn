/**
 * Reportes de planilla agrupados por la estructura organizacional
 * (Sucursal → División → Departamento → Empleado), con subtotales por nivel.
 * PURO: recibe las líneas ya cargadas y devuelve la tabla del reporte.
 */

import { agruparPorEstructura, aplanarEstructura, etiquetasNiveles, type GrupoEstructura, type NivelesEstructura, type Ubicacion, type Unidad } from "@/lib/organizacion/estructura";
import { aNumero, CERO, sumarPor, type Money } from "@/lib/payroll/money";
import { columnasDeDeducciones } from "@/lib/payroll/deducciones-de-linea";
import { formatCurrency } from "@/lib/utils";
import type { HojaReporte, MetaFila } from "./salida-celdas";
import { compararPorAntiguedad } from "@/lib/empleados/antiguedad";

/**
 * Una línea de planilla ya resumida para el reporte. Lo devengado y lo deducido van
 * con sus partes, de modo que cada fila se pueda comprobar a mano: salario + horas
 * extra + otros ingresos = total devengado; la suma de las deducciones = total
 * deducciones; devengado − deducciones = neto a pagar.
 */
export interface LineaPlanilla {
  empleadoId: string;
  nombre: string;
  /** Para ordenar por antigüedad (`compararPorAntiguedad`); sin ella, va al final del departamento. */
  fechaIngreso?: Date | null;
  /**
   * Puesto en el orden que eligió quien imprime (el de la pantalla de la planilla). Sin él,
   * por antigüedad.
   */
  posicion?: number;
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
  isr: Money;
  vecinal: Money;
  /** Las deducciones por empleado, por nombre de tipo, AFP incluida (`deduccionesPorNombre`). */
  porTipo: Map<string, Money>;
  /** Descuento por ausencias. */
  ausencias: Money;
  /** Los días de incapacidad que paga el IHSS. */
  incapacidad: Money;
  deducciones: Money;
  neto: Money;
  patronal: Money;
}

const SUMABLES = ["salario", "horasExtra", "otrosIngresos", "devengado", "ihss", "rap", "isr", "vecinal", "ausencias", "incapacidad", "deducciones", "neto", "patronal"] as const;

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
    if (!actual) { porClave.set(clave, { ...l, porTipo: new Map(l.porTipo) }); continue; }
    actual.dias += l.dias;
    for (const k of SUMABLES) actual[k] = actual[k].plus(l[k]);
    for (const [nombre, monto] of l.porTipo) actual.porTipo.set(nombre, (actual.porTipo.get(nombre) ?? CERO).plus(monto));
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

/** Una columna de montos de la planilla detallada. */
export interface ColumnaDetalle {
  titulo: string;
  valor: (l: LineaPlanilla) => Money;
}

/**
 * Columnas de la planilla detallada, según lo que traen las líneas: cada deducción por su
 * tipo (como en la planilla de la empresa), el vecinal sólo si alguien lo paga, y ausencias
 * e incapacidad sólo si alguien las tiene. Sin período: cada fila es una persona (ver
 * `consolidarPorEmpleado`) y el período va en el subtítulo del reporte.
 */
export function columnasDetalle(lineas: readonly LineaPlanilla[], ordenTipos: readonly string[] = []): ColumnaDetalle[] {
  const hay = (f: (l: LineaPlanilla) => Money) => lineas.some((l) => !f(l).isZero());
  return [
    { titulo: "Salario", valor: (l) => l.salario },
    { titulo: "Horas extra", valor: (l) => l.horasExtra },
    { titulo: "Otros ingresos", valor: (l) => l.otrosIngresos },
    { titulo: "Total devengado", valor: (l) => l.devengado },
    { titulo: "IHSS", valor: (l) => l.ihss },
    { titulo: "RAP", valor: (l) => l.rap },
    { titulo: "ISR", valor: (l) => l.isr },
    ...(hay((l) => l.vecinal) ? [{ titulo: "Imp. vecinal", valor: (l: LineaPlanilla) => l.vecinal }] : []),
    ...columnasDeDeducciones(lineas.map((l) => l.porTipo), ordenTipos).map((nombre) => ({ titulo: nombre, valor: (l: LineaPlanilla) => l.porTipo.get(nombre) ?? CERO })),
    ...(hay((l) => l.ausencias) ? [{ titulo: "Ausencias", valor: (l: LineaPlanilla) => l.ausencias }] : []),
    ...(hay((l) => l.incapacidad) ? [{ titulo: "Incapacidad", valor: (l: LineaPlanilla) => l.incapacidad }] : []),
    { titulo: "Total deducciones", valor: (l) => l.deducciones },
    { titulo: "Neto a pagar", valor: (l) => l.neto },
  ];
}

export const cabecerasDetalle = (cols: readonly ColumnaDetalle[]) => ["Empleado", "Días trab.", ...cols.map((c) => c.titulo)];

const montosDetalle = (ls: LineaPlanilla[], cols: readonly ColumnaDetalle[]) => cols.map((c) => L(sumarPor(ls, c.valor)));
const vacias = (cols: readonly ColumnaDetalle[]) => cols.map(() => "");

/** «15», «14.5»: los días pueden traer medio día. */
const dias = (n: number) => String(Math.round(n * 100) / 100);
const cuantos = (ls: LineaPlanilla[]) => {
  const n = personas(ls);
  return `${n} ${n === 1 ? "empleado" : "empleados"}`;
};

/** Dentro de cada departamento, en el orden de la pantalla de la planilla (`posicion`) o, si no lo trae, por antigüedad. */
const porNombre = (lineas: LineaPlanilla[]) =>
  [...lineas].sort((a, b) => (a.posicion ?? Number.MAX_SAFE_INTEGER) - (b.posicion ?? Number.MAX_SAFE_INTEGER) || compararPorAntiguedad(a, b));

/**
 * Las filas de unos grupos, con encabezado y subtotal en cada uno, y su total al final.
 * Cuántos empleados va en el rótulo del subtotal: la columna de días queda sólo con
 * números, para que el Excel la pueda sumar.
 */
function tablaDetalle(grupos: GrupoEstructura<LineaPlanilla>[], lineas: LineaPlanilla[], rotuloTotal: string, cols: readonly ColumnaDetalle[]): TablaAgrupada {
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const e of aplanarEstructura(grupos)) {
    if (e.tipo === "grupo") {
      datos.push([e.grupo.nombre, "", ...vacias(cols)]);
    } else if (e.tipo === "detalle") {
      datos.push([e.item.nombre, dias(e.item.dias), ...montosDetalle([e.item], cols)]);
    } else {
      datos.push([`Subtotal ${e.grupo.nombre} (${cuantos(e.grupo.items)})`, "", ...montosDetalle(e.grupo.items, cols)]);
    }
    filas.push({ tipo: e.tipo, nivel: e.nivel });
  }
  if (lineas.length) {
    datos.push([`${rotuloTotal} (${cuantos(lineas)})`, "", ...montosDetalle(lineas, cols)]);
    filas.push({ tipo: "total", nivel: 0 });
  }
  return { cabeceras: cabecerasDetalle(cols), datos, filas };
}

const tieneEmpresas = (g: GrupoEstructura<LineaPlanilla>) => g.hijos.some((h) => h.nivel === "DIVISION");

/**
 * El detalle hasta el total de cada empresa (división): departamentos con su subtotal
 * y la empresa con el suyo. El subtotal del grupo (sucursal) y el total general van en
 * el resumen de la última página. Un grupo sin empresas conserva su subtotal: ahí él
 * es la empresa.
 */
function filasDetalle(grupos: GrupoEstructura<LineaPlanilla>[], cols: readonly ColumnaDetalle[]): Omit<TablaAgrupada, "cabeceras"> {
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const e of aplanarEstructura(grupos)) {
    if (e.tipo === "subtotal" && e.grupo.nivel === "SUCURSAL" && tieneEmpresas(e.grupo)) continue;
    if (e.tipo === "grupo") datos.push([e.grupo.nombre, "", ...vacias(cols)]);
    else if (e.tipo === "detalle") datos.push([e.item.nombre, dias(e.item.dias), ...montosDetalle([e.item], cols)]);
    else datos.push([`Subtotal ${e.grupo.nombre} (${cuantos(e.grupo.items)})`, "", ...montosDetalle(e.grupo.items, cols)]);
    filas.push({ tipo: e.tipo, nivel: e.nivel });
  }
  return { datos, filas };
}

/**
 * Resumen para la última página, con las mismas columnas que el detalle: cada empresa
 * con su total, el subtotal de su grupo y el total general. Un grupo sin empresas es
 * una sola fila.
 */
export function tablaResumenPorEmpresa(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE, columnas?: readonly ColumnaDetalle[]): TablaAgrupada {
  const consolidadas = consolidarPorEmpleado(lineas);
  const cols = columnas ?? columnasDetalle(consolidadas);
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const g of agrupar(porNombre(consolidadas), niveles)) {
    // Cada fila del resumen es un total, no un registro: así no se cuentan como empleados.
    if (!tieneEmpresas(g)) {
      datos.push([`${g.nombre} (${cuantos(g.items)})`, "", ...montosDetalle(g.items, cols)]);
      filas.push({ tipo: "subtotal", nivel: 0 });
      continue;
    }
    datos.push([g.nombre, "", ...vacias(cols)]);
    filas.push({ tipo: "grupo", nivel: 0 });
    for (const empresa of g.hijos) {
      datos.push([`${empresa.nombre} (${cuantos(empresa.items)})`, "", ...montosDetalle(empresa.items, cols)]);
      filas.push({ tipo: "subtotal", nivel: 1 });
    }
    datos.push([`Subtotal ${g.nombre} (${cuantos(g.items)})`, "", ...montosDetalle(g.items, cols)]);
    filas.push({ tipo: "subtotal", nivel: 0 });
  }
  if (consolidadas.length) {
    datos.push([`TOTAL GENERAL (${cuantos(consolidadas)})`, "", ...montosDetalle(consolidadas, cols)]);
    filas.push({ tipo: "total", nivel: 0 });
  }
  // Las filas son grupos y empresas, no empleados: la primera columna lo dice.
  const primera = agrupar(consolidadas, niveles).some(tieneEmpresas) ? `${niveles.sucursalCorta} / ${niveles.division}` : niveles.sucursalCorta;
  return { cabeceras: [primera, ...cabecerasDetalle(cols).slice(1)], datos, filas };
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
export function tablaPlanillaDetallada(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE, ordenTipos: readonly string[] = []): TablaAgrupada {
  const consolidadas = consolidarPorEmpleado(lineas);
  const cols = columnasDetalle(consolidadas, ordenTipos);
  const detalle = filasDetalle(agrupar(porNombre(consolidadas), niveles), cols);
  if (!lineas.length) return { cabeceras: cabecerasDetalle(cols), ...detalle };
  const resumen = tablaResumenPorEmpresa(lineas, niveles, cols);
  return {
    cabeceras: cabecerasDetalle(cols),
    datos: [...detalle.datos, ["RESUMEN DE LA PLANILLA", "", ...vacias(cols)], ...resumen.datos],
    filas: [...detalle.filas, { tipo: "grupo", nivel: 0 }, ...resumen.filas],
  };
}

/** Para imprimir: el detalle hasta el total de cada empresa y, en la última página, el resumen. */
export function hojasPlanillaDetallada(lineas: LineaPlanilla[], niveles: NivelesEstructura = NIVELES_BASE, ordenTipos: readonly string[] = []): HojaReporte[] {
  if (!lineas.length) return [];
  const consolidadas = consolidarPorEmpleado(lineas);
  const cols = columnasDetalle(consolidadas, ordenTipos);
  const detalle = filasDetalle(agrupar(porNombre(consolidadas), niveles), cols);
  return [
    { nombre: "", pestana: "Detalle", cabeceras: cabecerasDetalle(cols), ...detalle },
    { nombre: "Resumen de la planilla", pestana: "Resumen", descripcion: descripcionResumen(lineas, niveles), ...tablaResumenPorEmpresa(lineas, niveles, cols) },
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
  rtns: ReadonlyMap<string, string> = new Map(),
  ordenTipos: readonly string[] = []
): HojaReporte[] {
  const hojas: HojaReporte[] = [];
  const consolidadas = consolidarPorEmpleado(lineas);
  // Las mismas columnas en todas las hojas, para que se puedan comparar.
  const cols = columnasDetalle(consolidadas, ordenTipos);
  for (const sucursal of agrupar(porNombre(consolidadas), niveles)) {
    const conDivisiones = sucursal.hijos.some((h) => h.nivel === "DIVISION");
    if (!conDivisiones) {
      hojas.push({ nombre: sucursal.nombre, pestana: sucursal.nombre, ...tablaDetalle(sucursal.hijos, sucursal.items, `TOTAL ${sucursal.nombre}`, cols) });
      continue;
    }
    for (const division of sucursal.hijos) {
      const rtn = division.id ? rtns.get(division.id) : undefined;
      hojas.push({
        nombre: `${sucursal.nombre} / ${division.nombre}${rtn ? `, RTN ${rtn}` : ""}`,
        pestana: division.nombre,
        ...tablaDetalle(division.hijos, division.items, `TOTAL ${division.nombre}`, cols),
      });
    }
  }
  // El total general sólo en la última página: cada hoja cierra con el total de su empresa.
  if (hojas.length > 1) {
    hojas.push({ nombre: "Resumen de toda la planilla", pestana: "Resumen", descripcion: descripcionResumen(lineas, niveles), ...tablaResumenPorEmpresa(lineas, niveles, cols) });
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
