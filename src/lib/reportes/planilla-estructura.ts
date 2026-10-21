/**
 * Reportes de planilla agrupados por la estructura organizacional
 * (Sucursal → División → Departamento → Empleado), con subtotales por nivel.
 * PURO: recibe las líneas ya cargadas y devuelve la tabla del reporte.
 */

import { agruparPorEstructura, aplanarEstructura, type GrupoEstructura, type Ubicacion, type Unidad } from "@/lib/organizacion/estructura";
import { aNumero, sumarPor, type Money } from "@/lib/payroll/money";
import { formatCurrency } from "@/lib/utils";
import type { MetaFila } from "./salida-celdas";

/** Una línea de planilla ya resumida para el reporte. */
export interface LineaPlanilla {
  empleadoId: string;
  nombre: string;
  periodo: string;
  ubicacion: Ubicacion;
  bruto: Money;
  ihss: Money;
  rap: Money;
  afp: Money;
  isr: Money;
  otras: Money;
  ausencias: Money;
  deducciones: Money;
  neto: Money;
  patronal: Money;
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

const L = (m: Money) => formatCurrency(aNumero(m));
const personas = (lineas: LineaPlanilla[]) => new Set(lineas.map((l) => l.empleadoId)).size;

/** Detalle por empleado, con encabezado y subtotal en cada sucursal, división y departamento. */
export function tablaPlanillaDetallada(lineas: LineaPlanilla[]): TablaAgrupada {
  const cabeceras = ["Empleado", "Período", "Bruto", "IHSS", "RAP", "AFP", "ISR", "Otras Ded.", "Ausencias", "Neto"];
  const montos = (ls: LineaPlanilla[]) => [
    L(sumarPor(ls, (l) => l.bruto)), L(sumarPor(ls, (l) => l.ihss)), L(sumarPor(ls, (l) => l.rap)),
    L(sumarPor(ls, (l) => l.afp)), L(sumarPor(ls, (l) => l.isr)), L(sumarPor(ls, (l) => l.otras)),
    L(sumarPor(ls, (l) => l.ausencias)), L(sumarPor(ls, (l) => l.neto)),
  ];
  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  const ordenadas = [...lineas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.periodo.localeCompare(b.periodo));
  for (const e of aplanarEstructura(agruparPorEstructura(ordenadas, (l) => l.ubicacion))) {
    if (e.tipo === "grupo") {
      datos.push([e.grupo.nombre, ...cabeceras.slice(1).map(() => "")]);
    } else if (e.tipo === "detalle") {
      datos.push([e.item.nombre, e.item.periodo, ...montos([e.item])]);
    } else {
      datos.push([`Subtotal ${e.grupo.nombre}`, `${personas(e.grupo.items)} empleado(s)`, ...montos(e.grupo.items)]);
    }
    filas.push({ tipo: e.tipo, nivel: e.nivel });
  }
  if (lineas.length) {
    datos.push(["TOTAL GENERAL", `${personas(lineas)} empleado(s)`, ...montos(lineas)]);
    filas.push({ tipo: "total", nivel: 0 });
  }
  return { cabeceras, datos, filas };
}

/**
 * Resumen: una fila por sucursal, división y departamento con sus totales, en
 * forma de árbol (cada nivel antes de su contenido), y el total general.
 */
export function tablaResumenPlanilla(lineas: LineaPlanilla[]): TablaAgrupada {
  const cabeceras = ["Sucursal / División / Departamento", "Empleados", "Bruto", "Deducciones", "Neto", "Costo Patronal"];
  const fila = (nombre: string, ls: LineaPlanilla[]) => [
    nombre, String(personas(ls)),
    L(sumarPor(ls, (l) => l.bruto)), L(sumarPor(ls, (l) => l.deducciones)),
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
  for (const g of agruparPorEstructura(lineas, (l) => l.ubicacion)) visitar(g, 0);
  if (lineas.length) {
    datos.push(fila("TOTAL GENERAL", lineas));
    filas.push({ tipo: "total", nivel: 0 });
  }
  return { cabeceras, datos, filas };
}
