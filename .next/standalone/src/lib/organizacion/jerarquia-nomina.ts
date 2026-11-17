/**
 * Jerarquía de nómina: Frecuencia → Grupo → Sucursal → Departamento → Empleados.
 *
 * No hay tablas nuevas: es otra forma de leer la estructura que ya existe. El
 * grupo es la `Sucursal` («Nómina Confidencial»), la empresa es la `Division`
 * («PAGSA») y la frecuencia es el `tipoPlanilla` de cada persona. Así las
 * planillas, los reportes y el alcance por sucursal siguen funcionando igual.
 *
 * Módulo puro. Una frecuencia es un filtro y no una rama real: el mismo
 * departamento puede tener gente quincenal y mensual, y cada árbol lleva sólo la
 * suya. Las ramas sin nadie de esa frecuencia no aparecen.
 */

import type { TipoPlanilla } from "@prisma/client";
import { Money } from "@/lib/payroll/money";
import { agruparPorEstructura, etiquetasNiveles, type GrupoEstructura } from "./estructura";

export interface EmpleadoParaJerarquia {
  id: string;
  codigo: string;
  nombre: string;
  puesto: string | null;
  estado: string;
  tipoPlanilla: TipoPlanilla;
  salarioBase: Money;
  grupo: { id: string; nombre: string; descripcion: string | null };
  empresa: { id: string; nombre: string; rtn: string | null } | null;
  departamento: { id: string; nombre: string };
}

export type NivelNomina = "FRECUENCIA" | "GRUPO" | "EMPRESA" | "DEPARTAMENTO";

export interface PersonaNomina {
  id: string;
  codigo: string;
  nombre: string;
  puesto: string | null;
  estado: string;
  /** Sólo con permiso de datos personales y salariales. */
  salarioBase?: string;
}

export interface NodoNomina {
  /** Ruta de ids, igual en todas las frecuencias: al cambiar de nómina se conserva la rama elegida. */
  clave: string;
  nivel: NivelNomina;
  nombre: string;
  /** RTN de la empresa o descripción del grupo. */
  detalle: string | null;
  cantidad: number;
  /** Sólo con permiso de datos personales y salariales. */
  totalSalarios?: string;
  hijos: NodoNomina[];
  /** Sólo en los departamentos; los niveles superiores los reúnen de sus hijos. */
  personas: PersonaNomina[];
}

export interface FrecuenciaNomina {
  tipo: TipoPlanilla;
  etiqueta: string;
  raiz: NodoNomina;
}

export const CLAVE_RAIZ = "raiz";
export const SIN_EMPRESA = etiquetasNiveles(true).sinDivision;

const FRECUENCIAS: ReadonlyArray<{ tipo: TipoPlanilla; etiqueta: string; titulo: string }> = [
  { tipo: "QUINCENAL", etiqueta: "Quincenal", titulo: "Nómina quincenal" },
  { tipo: "MENSUAL", etiqueta: "Mensual", titulo: "Nómina mensual" },
  { tipo: "SEMANAL", etiqueta: "Semanal", titulo: "Nómina semanal" },
];

const NIVELES = { SUCURSAL: "GRUPO", DIVISION: "EMPRESA", DEPARTAMENTO: "DEPARTAMENTO" } as const;

function total(items: EmpleadoParaJerarquia[], conSalarios: boolean): { totalSalarios?: string } {
  if (!conSalarios) return {};
  return { totalSalarios: items.reduce((suma, e) => suma.plus(e.salarioBase), new Money(0)).toFixed(2) };
}

function detalleDe(g: GrupoEstructura<EmpleadoParaJerarquia>): string | null {
  const primero = g.items[0];
  if (g.nivel === "SUCURSAL") return primero.grupo.descripcion;
  if (g.nivel === "DIVISION" && primero.empresa?.rtn) return `RTN ${primero.empresa.rtn}`;
  return null;
}

function aPersona(e: EmpleadoParaJerarquia, conSalarios: boolean): PersonaNomina {
  return {
    id: e.id,
    codigo: e.codigo,
    nombre: e.nombre,
    puesto: e.puesto,
    estado: e.estado,
    ...(conSalarios ? { salarioBase: e.salarioBase.toFixed(2) } : {}),
  };
}

function aNodo(g: GrupoEstructura<EmpleadoParaJerarquia>, padre: string, conSalarios: boolean): NodoNomina {
  const clave = `${padre}/${g.id ?? "sin-empresa"}`;
  const esDepartamento = g.nivel === "DEPARTAMENTO";
  return {
    clave,
    nivel: NIVELES[g.nivel],
    nombre: g.nombre,
    detalle: detalleDe(g),
    cantidad: g.items.length,
    ...total(g.items, conSalarios),
    hijos: g.hijos.map((h) => aNodo(h, clave, conSalarios)),
    personas: esDepartamento
      ? [...g.items].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((e) => aPersona(e, conSalarios))
      : [],
  };
}

/**
 * Un árbol por frecuencia. Quincenal y mensual siempre están, aunque vacías,
 * porque son las dos que se conmutan; semanal sólo si alguien la tiene, para que
 * esas personas no desaparezcan de la vista.
 */
export function construirJerarquiaNomina(empleados: EmpleadoParaJerarquia[], conSalarios: boolean): FrecuenciaNomina[] {
  return FRECUENCIAS.flatMap(({ tipo, etiqueta, titulo }) => {
    const propios = empleados.filter((e) => e.tipoPlanilla === tipo);
    if (tipo === "SEMANAL" && propios.length === 0) return [];
    const grupos = agruparPorEstructura(propios, (e) => ({ sucursal: e.grupo, division: e.empresa, departamento: e.departamento }), SIN_EMPRESA);
    return [{
      tipo,
      etiqueta,
      raiz: {
        clave: CLAVE_RAIZ,
        nivel: "FRECUENCIA" as const,
        nombre: titulo,
        detalle: null,
        cantidad: propios.length,
        ...total(propios, conSalarios),
        hijos: grupos.map((g) => aNodo(g, "", conSalarios)),
        personas: [],
      },
    }];
  });
}
