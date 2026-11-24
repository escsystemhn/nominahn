/**
 * Cómo se ve la planilla en pantalla (pedido de Edbin, 2026-11-23): por qué campo se
 * ordenan los empleados dentro de cada departamento, y si los ingresos y las deducciones
 * van con todas sus columnas o resumidos en su total. Se recuerda en este navegador
 * (cookie) y la planilla impresa sigue el mismo orden. PURO.
 */

import { compararPorAntiguedad } from "@/lib/empleados/antiguedad";

export const COOKIE_VISTA_PLANILLA = "g360_planilla_vista";

type TipoCampo = "fecha" | "texto" | "monto";

export const CAMPOS_ORDEN = [
  { clave: "antiguedad", etiqueta: "Antigüedad", tipo: "fecha" },
  { clave: "codigo", etiqueta: "Código", tipo: "texto" },
  { clave: "nombre", etiqueta: "Nombre", tipo: "texto" },
  { clave: "apellido", etiqueta: "Apellido", tipo: "texto" },
  { clave: "salario", etiqueta: "Salario", tipo: "monto" },
  { clave: "bruto", etiqueta: "Ingresos (bruto)", tipo: "monto" },
  { clave: "deducciones", etiqueta: "Deducciones", tipo: "monto" },
  { clave: "neto", etiqueta: "Neto", tipo: "monto" },
] as const satisfies ReadonlyArray<{ clave: string; etiqueta: string; tipo: TipoCampo }>;

export type CampoOrden = (typeof CAMPOS_ORDEN)[number]["clave"];
export type Direccion = "asc" | "desc";
/** «todo»: cada columna; «resumen»: sólo el total del grupo. */
export type Detalle = "todo" | "resumen";

export interface VistaPlanilla {
  orden: CampoOrden;
  dir: Direccion;
  ingresos: Detalle;
  deducciones: Detalle;
}

export const VISTA_POR_OMISION: VistaPlanilla = { orden: "antiguedad", dir: "asc", ingresos: "todo", deducciones: "todo" };

const tipoDe = (c: CampoOrden): TipoCampo => CAMPOS_ORDEN.find((x) => x.clave === c)!.tipo;
export const esCampoOrden = (v: unknown): v is CampoOrden => CAMPOS_ORDEN.some((c) => c.clave === v);

/** Al elegir un campo: los montos, de mayor a menor; lo demás, del principio. */
export function direccionPorOmision(c: CampoOrden): Direccion {
  return tipoDe(c) === "monto" ? "desc" : "asc";
}

/** Cómo se dice la dirección según el campo. */
export function textoDireccion(c: CampoOrden, dir: Direccion): string {
  const tipo = tipoDe(c);
  if (tipo === "fecha") return dir === "asc" ? "Más antiguo primero" : "Más reciente primero";
  if (tipo === "monto") return dir === "desc" ? "De mayor a menor" : "De menor a mayor";
  return dir === "asc" ? "De la A a la Z" : "De la Z a la A";
}

/** «por antigüedad, más antiguo primero»: para la línea que explica la tabla. */
export function describirOrden(v: Pick<VistaPlanilla, "orden" | "dir">): string {
  const campo = CAMPOS_ORDEN.find((c) => c.clave === v.orden)!.etiqueta.toLowerCase();
  const sentido = textoDireccion(v.orden, v.dir);
  // Sólo la primera letra: «de la A a la Z», no «de la a a la z».
  return `por ${campo}, ${sentido.charAt(0).toLowerCase()}${sentido.slice(1)}`;
}

/** La cookie: «orden=neto&dir=desc&ingresos=resumen&deducciones=todo». Lo que no se entienda, por omisión. */
export function leerVista(valor: string | null | undefined): VistaPlanilla {
  const p = new URLSearchParams(valor ?? "");
  const orden = p.get("orden");
  const dir = p.get("dir");
  const det = (x: string | null): Detalle => (x === "resumen" ? "resumen" : "todo");
  return {
    orden: esCampoOrden(orden) ? orden : VISTA_POR_OMISION.orden,
    dir: dir === "asc" || dir === "desc" ? dir : esCampoOrden(orden) ? direccionPorOmision(orden) : VISTA_POR_OMISION.dir,
    ingresos: det(p.get("ingresos")),
    deducciones: det(p.get("deducciones")),
  };
}

export function textoVista(v: VistaPlanilla): string {
  return new URLSearchParams({ orden: v.orden, dir: v.dir, ingresos: v.ingresos, deducciones: v.deducciones }).toString();
}

/** Lo que hace falta de cada línea para ordenarla. */
export interface FilaOrdenable {
  nombre: string;
  fechaIngreso?: Date | string | null;
  codigo?: string | null;
  /** «Apellidos Nombres», para ordenar por apellido. */
  apellido?: string | null;
  salario?: number | null;
  bruto?: number | null;
  deducciones?: number | null;
  neto?: number | null;
}

const texto = (a: string | null | undefined, b: string | null | undefined) =>
  // Sin dato, al final; «EMP-9» antes que «EMP-10».
  !a ? (!b ? 0 : 1) : !b ? -1 : a.localeCompare(b, "es", { sensitivity: "base", numeric: true });

/**
 * El orden de las líneas. A igualdad, por antigüedad y luego por nombre, para que el
 * orden no cambie entre una carga y otra. Lo que no tiene dato va al final en las dos
 * direcciones.
 */
export function comparadorPlanilla(campo: CampoOrden, dir: Direccion): (a: FilaOrdenable, b: FilaOrdenable) => number {
  const signo = dir === "asc" ? 1 : -1;
  const desempate = (a: FilaOrdenable, b: FilaOrdenable) => compararPorAntiguedad(a, b);
  if (campo === "antiguedad") {
    return (a, b) => {
      const sinA = !a.fechaIngreso, sinB = !b.fechaIngreso;
      if (sinA || sinB) return sinA === sinB ? texto(a.nombre, b.nombre) : sinA ? 1 : -1;
      return signo * compararPorAntiguedad(a, b);
    };
  }
  if (campo === "codigo" || campo === "nombre" || campo === "apellido") {
    return (a, b) => {
      const va = a[campo], vb = b[campo];
      if (!va || !vb) return texto(va, vb) || desempate(a, b);
      return signo * texto(va, vb) || desempate(a, b);
    };
  }
  return (a, b) => {
    const va = a[campo], vb = b[campo];
    const sinA = va === null || va === undefined, sinB = vb === null || vb === undefined;
    if (sinA || sinB) return sinA === sinB ? desempate(a, b) : sinA ? 1 : -1;
    return signo * (va - vb) || desempate(a, b);
  };
}
