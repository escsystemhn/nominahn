/**
 * «Exportar estructura» (pedido de Edbin, 2026-11-18): la organización por grupos y
 * sucursales —o por sucursales y divisiones sin la jerarquía de nómina— con sus
 * departamentos y, según el detalle pedido, sus puestos o cada empleado.
 *
 * Sale como cualquier reporte (visor, Excel y PDF) con filas agrupadas y sangría. Con
 * más de un grupo, el Excel lleva una pestaña de resumen y otra por grupo, y el PDF
 * empieza cada grupo en página nueva.
 *
 * El departamento manda: es él quien dice el grupo y la sucursal de la persona (como en
 * la planilla), así que un empleado se cuenta donde está su departamento.
 */

import type { NivelesEstructura } from "@/lib/organizacion/estructura";
import { formatoIdentidad } from "@/lib/empleados/identidad";
import type { HojaReporte, MetaFila } from "./salida-celdas";

export const DETALLES_ESTRUCTURA = ["departamentos", "puestos", "empleados"] as const;
export type DetalleEstructura = (typeof DETALLES_ESTRUCTURA)[number];

export function leerDetalle(valor: string | null | undefined): DetalleEstructura {
  return DETALLES_ESTRUCTURA.includes(valor as DetalleEstructura) ? (valor as DetalleEstructura) : "departamentos";
}

export const NOMBRE_DETALLE: Record<DetalleEstructura, string> = {
  departamentos: "Hasta departamentos",
  puestos: "Con los puestos",
  empleados: "Con los empleados",
};

export interface GrupoEst { id: string; nombre: string; codigo: string | null; rtn: string | null; activo: boolean }
export interface DivisionEst { id: string; nombre: string; codigo: string | null; rtn: string | null; sucursalId: string; activo: boolean }
export interface DepartamentoEst { id: string; nombre: string; codigo: string | null; sucursalId: string; divisionId: string | null; activo: boolean }
export interface PuestoEst { id: string; nombre: string; departamentoId: string; activo: boolean }
export interface EmpleadoEst {
  codigo: string;
  nombre: string;
  departamentoId: string;
  puestoId: string | null;
  /** Ya en palabras: «Quincenal», «Activo». */
  frecuencia: string;
  ingreso: string;
  estado: string;
  /** Sólo llegan con `empleados.pii`. */
  identidad?: string | null;
  salario?: string;
}

export interface DatosEstructura {
  grupos: GrupoEst[];
  divisiones: DivisionEst[];
  departamentos: DepartamentoEst[];
  puestos: PuestoEst[];
  empleados: EmpleadoEst[];
}

export interface OpcionesEstructura {
  detalle: DetalleEstructura;
  niveles: NivelesEstructura;
  conDivisiones: boolean;
  /** Identidad y salario en el detalle de empleados. */
  vePII: boolean;
}

export interface TablaEstructura {
  titulo: string;
  cabeceras: string[];
  datos: string[][];
  filas: MetaFila[];
  hojas?: HojaReporte[];
  totales: { grupos: number; divisiones: number; departamentos: number; puestos: number; empleados: number };
}

/** RTN para leer: 0501-1999-000099. Además, con guiones Excel no lo vuelve número ni le quita el cero. */
export function formatoRtn(v: string | null | undefined): string {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : (v ?? "").trim();
}

const porNombre = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

interface NodoDepartamento { depto: DepartamentoEst; puestos: PuestoEst[]; empleados: EmpleadoEst[] }
interface NodoDivision { division: DivisionEst | null; departamentos: NodoDepartamento[] }
interface NodoGrupo { grupo: GrupoEst; divisiones: NodoDivision[] }

const empleadosDe = (ds: NodoDepartamento[]) => ds.reduce((n, d) => n + d.empleados.length, 0);
const puestosDe = (ds: NodoDepartamento[]) => ds.reduce((n, d) => n + d.puestos.length, 0);
const deptosDe = (g: NodoGrupo) => g.divisiones.flatMap((v) => v.departamentos);

/**
 * El árbol grupo → sucursal → departamento. Lo inactivo sólo aparece si todavía tiene
 * personas contadas (si no, ensuciaría la estructura vigente con lo que ya no existe).
 */
function armarArbol(d: DatosEstructura, conDivisiones: boolean): NodoGrupo[] {
  const puestosPor = new Map<string, PuestoEst[]>();
  for (const p of d.puestos) puestosPor.set(p.departamentoId, [...(puestosPor.get(p.departamentoId) ?? []), p]);
  const empleadosPor = new Map<string, EmpleadoEst[]>();
  for (const e of d.empleados) empleadosPor.set(e.departamentoId, [...(empleadosPor.get(e.departamentoId) ?? []), e]);

  const nodoDepto = (depto: DepartamentoEst): NodoDepartamento => ({
    depto,
    puestos: (puestosPor.get(depto.id) ?? []).filter((p) => p.activo).sort(porNombre),
    empleados: (empleadosPor.get(depto.id) ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })),
  });
  const vigente = (n: NodoDepartamento) => n.depto.activo || n.empleados.length > 0;

  const arbol: NodoGrupo[] = [];
  for (const grupo of [...d.grupos].sort(porNombre)) {
    const deptos = d.departamentos.filter((x) => x.sucursalId === grupo.id).sort(porNombre).map(nodoDepto).filter(vigente);
    let divisiones: NodoDivision[];
    if (!conDivisiones) {
      divisiones = [{ division: null, departamentos: deptos }];
    } else {
      divisiones = d.divisiones
        .filter((v) => v.sucursalId === grupo.id)
        .sort(porNombre)
        .map((division) => ({ division, departamentos: deptos.filter((x) => x.depto.divisionId === division.id) }))
        .filter((n) => n.division!.activo || empleadosDe(n.departamentos) > 0);
      const sueltos = deptos.filter((x) => !x.depto.divisionId || !d.divisiones.some((v) => v.id === x.depto.divisionId));
      if (sueltos.length > 0) divisiones.push({ division: null, departamentos: sueltos });
    }
    const nodo = { grupo, divisiones };
    if (grupo.activo || empleadosDe(deptosDe(nodo)) > 0) arbol.push(nodo);
  }
  return arbol;
}

export function tablaEstructura(d: DatosEstructura, o: OpcionesEstructura): TablaEstructura {
  const { niveles, conDivisiones, detalle, vePII } = o;
  const arbol = armarArbol(d, conDivisiones);
  const conEmpleados = detalle === "empleados";

  const rotulo = conDivisiones
    ? `${niveles.sucursalCorta} / ${niveles.division} / Departamento`
    : `${niveles.sucursalCorta} / Departamento`;
  const cabecerasConteo = [detalle === "puestos" ? `${rotulo} / Puesto` : rotulo, "Código", "RTN", "Departamentos", "Puestos", "Empleados"];
  const cabecerasEmpleados = [`${rotulo} / Empleado`, "Código", "Puesto", "Frecuencia", "Ingreso", "Estado", ...(vePII ? ["Identidad", "Salario base"] : [])];
  const ancho = conEmpleados ? cabecerasEmpleados.length : cabecerasConteo.length;
  const vacias = (n: number) => Array.from({ length: n }, () => "");

  /** Encabezado de un nivel. En el detalle de empleados, los conteos van en la misma celda del nombre. */
  const filaNivel = (nombre: string, codigo: string | null, rtn: string, deptos: NodoDepartamento[]) => {
    if (conEmpleados) {
      const partes = [nombre, rtn && `RTN ${rtn}`, plural(empleadosDe(deptos), "empleado", "empleados")].filter(Boolean);
      return [partes.join(" · "), ...vacias(ancho - 1)];
    }
    return [nombre, codigo ?? "", rtn, String(deptos.length), String(puestosDe(deptos)), String(empleadosDe(deptos))];
  };

  /** Las filas de un grupo (sin el total general). `nivelBase` 0 en la tabla completa. */
  function filasGrupo(g: NodoGrupo): { datos: string[][]; filas: MetaFila[] } {
    const datos: string[][] = [];
    const filas: MetaFila[] = [];
    const push = (fila: string[], meta: MetaFila) => { datos.push(fila); filas.push(meta); };

    push(filaNivel(g.grupo.nombre, g.grupo.codigo, formatoRtn(g.grupo.rtn), deptosDe(g)), { tipo: "grupo", nivel: 0 });
    for (const v of g.divisiones) {
      let nivelDepto = 1;
      if (conDivisiones) {
        const propio = formatoRtn(v.division?.rtn);
        // Sin RTN propio, la sucursal usa el del grupo: se dice, para que no parezca que no tiene.
        const rtn = propio || (v.division && g.grupo.rtn ? `${formatoRtn(g.grupo.rtn)} (del grupo)` : "");
        push(filaNivel(v.division?.nombre ?? niveles.sinDivision, v.division?.codigo ?? null, v.division ? rtn : "", v.departamentos), { tipo: "grupo", nivel: 1 });
        nivelDepto = 2;
      }
      for (const n of v.departamentos) {
        const vacio = n.empleados.length === 0;
        if (detalle === "departamentos") {
          push([n.depto.nombre, n.depto.codigo ?? "", "", "", String(n.puestos.length), String(n.empleados.length)], { tipo: "detalle", nivel: nivelDepto });
          continue;
        }
        if (detalle === "puestos") {
          push([n.depto.nombre, n.depto.codigo ?? "", "", "", String(n.puestos.length), String(n.empleados.length)], { tipo: "grupo", nivel: nivelDepto });
          for (const p of n.puestos) {
            push([p.nombre, "", "", "", "", String(n.empleados.filter((e) => e.puestoId === p.id).length)], { tipo: "detalle", nivel: nivelDepto + 1 });
          }
          const sinPuesto = n.empleados.filter((e) => !e.puestoId || !n.puestos.some((p) => p.id === e.puestoId)).length;
          if (sinPuesto > 0) push(["Sin puesto asignado", "", "", "", "", String(sinPuesto)], { tipo: "detalle", nivel: nivelDepto + 1 });
          continue;
        }
        push([`${n.depto.nombre} · ${vacio ? "sin empleados" : plural(n.empleados.length, "empleado", "empleados")}`, ...vacias(ancho - 1)], { tipo: "grupo", nivel: nivelDepto });
        const puestoDe = new Map(n.puestos.map((p) => [p.id, p.nombre]));
        for (const e of n.empleados) {
          push(
            [e.nombre, e.codigo, (e.puestoId && puestoDe.get(e.puestoId)) || "Sin puesto", e.frecuencia, e.ingreso, e.estado,
              ...(vePII ? [formatoIdentidad(e.identidad), e.salario ?? ""] : [])],
            { tipo: "detalle", nivel: nivelDepto + 1 },
          );
        }
      }
    }
    return { datos, filas };
  }

  const totales = {
    grupos: arbol.length,
    divisiones: conDivisiones ? arbol.reduce((n, g) => n + g.divisiones.filter((v) => v.division).length, 0) : 0,
    departamentos: arbol.reduce((n, g) => n + deptosDe(g).length, 0),
    puestos: arbol.reduce((n, g) => n + puestosDe(deptosDe(g)), 0),
    empleados: arbol.reduce((n, g) => n + empleadosDe(deptosDe(g)), 0),
  };
  const filaTotal = (nombre: string, deptos: NodoDepartamento[]) =>
    conEmpleados
      ? [nombre, ...vacias(ancho - 2), plural(empleadosDe(deptos), "empleado", "empleados")]
      : [nombre, "", "", String(deptos.length), String(puestosDe(deptos)), String(empleadosDe(deptos))];
  const todos = arbol.flatMap(deptosDe);

  const datos: string[][] = [];
  const filas: MetaFila[] = [];
  for (const g of arbol) {
    const parte = filasGrupo(g);
    datos.push(...parte.datos);
    filas.push(...parte.filas);
  }
  datos.push(filaTotal("TOTAL GENERAL", todos));
  filas.push({ tipo: "total", nivel: 0 });

  const titulo = conDivisiones
    ? `Estructura por ${niveles.sucursales.toLowerCase()} y ${niveles.divisiones.toLowerCase()}`
    : `Estructura por ${niveles.sucursales.toLowerCase()} y departamentos`;

  // Por partes sólo si hay más de un grupo: primero el resumen y después cada grupo.
  let hojas: HojaReporte[] | undefined;
  if (arbol.length > 1) {
    const resumen: { datos: string[][]; filas: MetaFila[] } = { datos: [], filas: [] };
    for (const g of arbol) {
      resumen.datos.push([g.grupo.nombre, g.grupo.codigo ?? "", formatoRtn(g.grupo.rtn), String(deptosDe(g).length), String(puestosDe(deptosDe(g))), String(empleadosDe(deptosDe(g)))]);
      resumen.filas.push({ tipo: conDivisiones ? "grupo" : "detalle", nivel: 0 });
      if (!conDivisiones) continue;
      for (const v of g.divisiones) {
        resumen.datos.push([v.division?.nombre ?? niveles.sinDivision, v.division?.codigo ?? "", formatoRtn(v.division?.rtn), String(v.departamentos.length), String(puestosDe(v.departamentos)), String(empleadosDe(v.departamentos))]);
        resumen.filas.push({ tipo: "detalle", nivel: 1 });
      }
    }
    resumen.datos.push(["TOTAL GENERAL", "", "", String(todos.length), String(puestosDe(todos)), String(empleadosDe(todos))]);
    resumen.filas.push({ tipo: "total", nivel: 0 });
    hojas = [
      {
        nombre: "Resumen",
        pestana: "Resumen",
        descripcion: [
          plural(totales.grupos, niveles.sucursal.toLowerCase(), niveles.sucursales.toLowerCase()),
          conDivisiones ? plural(totales.divisiones, niveles.division.toLowerCase(), niveles.divisiones.toLowerCase()) : "",
          plural(totales.departamentos, "departamento", "departamentos"),
          plural(totales.empleados, "empleado", "empleados"),
        ].filter(Boolean).join(", "),
        cabeceras: [conDivisiones ? `${niveles.sucursalCorta} / ${niveles.division}` : niveles.sucursalCorta, "Código", "RTN", "Departamentos", "Puestos", "Empleados"],
        ...resumen,
      },
      ...arbol.map((g) => {
        const parte = filasGrupo(g);
        return {
          nombre: g.grupo.rtn ? `${g.grupo.nombre}, RTN ${formatoRtn(g.grupo.rtn)}` : g.grupo.nombre,
          pestana: g.grupo.nombre,
          descripcion: plural(empleadosDe(deptosDe(g)), "empleado", "empleados"),
          cabeceras: conEmpleados ? cabecerasEmpleados : cabecerasConteo,
          datos: [...parte.datos, filaTotal(`TOTAL ${g.grupo.nombre}`, deptosDe(g))],
          filas: [...parte.filas, { tipo: "total" as const, nivel: 0 }],
        };
      }),
    ];
  }

  return { titulo, cabeceras: conEmpleados ? cabecerasEmpleados : cabecerasConteo, datos, filas, hojas, totales };
}
