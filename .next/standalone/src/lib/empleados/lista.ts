/**
 * La lista de Empleados: su filtro y su orden, en un solo lugar. Los usan la lista y las
 * flechas ‹ › de la ficha y de Editar, que recorren a los empleados en el MISMO orden y con
 * los MISMOS filtros con que se veía la lista (pedido de Edbin, 2026-11-16). La lista le pasa
 * a la ficha sus filtros en `?lista=` (búsqueda, sucursal, orden; no la página).
 */
import type { EstadoEmpleado, Prisma, PrismaClient } from "@prisma/client";
import { conAlcance, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { leerOrden, type Orden } from "@/lib/http/orden";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";

export const COLUMNAS_LISTA = [
  "codigo", "empleado", "sucursal", "division", "departamento", "puesto", "jefe",
  "frecuencia", "contrato", "ingreso", "antiguedad", "estado",
  "salario", "salida", "nacimiento", "identidad",
] as const;
export type ColumnaLista = (typeof COLUMNAS_LISTA)[number];

/** Ordenar por un dato personal también lo revela (quién gana más, quién es mayor): sólo con `empleados.pii`. */
const ORDEN_PII: ReadonlySet<ColumnaLista> = new Set(["salario", "salida", "nacimiento", "identidad"]);

export interface ParamsLista {
  search?: string;
  sucursalId?: string;
  /** La división del departamento: la «sucursal» con la jerarquía de nómina. */
  divisionId?: string;
  /** Un `EstadoEmpleado` o `VIGENTES` (todos menos los dados de baja). */
  estado?: string;
  orden?: string;
  dir?: string;
}

const CLAVES: readonly (keyof ParamsLista)[] = ["search", "sucursalId", "divisionId", "estado", "orden", "dir"];

const ESTADOS: readonly EstadoEmpleado[] = ["ACTIVO", "VACACIONES", "PERMISO", "SUSPENDIDO", "INACTIVO"];
export const ESTADO_VIGENTES = "VIGENTES";

/** El filtro de estado; un valor desconocido no filtra (antes llegaba crudo a Prisma y respondía 500). */
export function filtroEstado(estado: string | null | undefined): Prisma.EmpleadoWhereInput {
  if (estado === ESTADO_VIGENTES) return { estado: { not: "INACTIVO" } };
  return ESTADOS.includes(estado as EstadoEmpleado) ? { estado: estado as EstadoEmpleado } : {};
}

export function ordenDeConsulta({ campo, dir }: Orden<ColumnaLista>): Prisma.EmpleadoOrderByWithRelationInput[] {
  const principal: Record<ColumnaLista, Prisma.EmpleadoOrderByWithRelationInput[]> = {
    codigo: [{ codigo: dir }],
    empleado: [{ primerApellido: dir }, { primerNombre: dir }],
    sucursal: [{ sucursal: { nombre: dir } }],
    division: [{ departamento: { division: { nombre: dir } } }],
    departamento: [{ departamento: { nombre: dir } }],
    puesto: [{ puesto: { nombre: dir } }],
    jefe: [{ supervisor: { primerApellido: dir } }, { supervisor: { primerNombre: dir } }],
    frecuencia: [{ tipoPlanilla: dir }],
    contrato: [{ tipoContrato: dir }],
    salario: [{ salarioBase: dir }],
    ingreso: [{ fechaIngreso: dir }],
    // Más antigüedad es un ingreso más viejo.
    antiguedad: [{ fechaIngreso: dir === "asc" ? "desc" : "asc" }],
    estado: [{ estado: dir }],
    salida: [{ fechaSalida: { sort: dir, nulls: "last" } }],
    nacimiento: [{ fechaNacimiento: dir }],
    identidad: [{ identidad: { sort: dir, nulls: "last" } }],
  };
  // El `id` desempata: sin él, dos filas iguales pueden saltar de una página a otra.
  return [...principal[campo], { id: "asc" }];
}

/** El orden pedido; sin permiso para ver datos personales, tampoco se ordena por ellos. */
export function ordenLista(sp: ParamsLista, vePII: boolean): Orden<ColumnaLista> {
  return leerOrden(sp, vePII ? COLUMNAS_LISTA : COLUMNAS_LISTA.filter((c) => !ORDEN_PII.has(c)), { campo: "empleado", dir: "asc" });
}

/** Filtro de la lista. `conAlcance` combina con AND: nadie ve a quien está fuera de su alcance. */
export async function filtroLista(db: PrismaClient, usuario: UsuarioConAlcance, sp: ParamsLista, vePII: boolean): Promise<Prisma.EmpleadoWhereInput> {
  return conAlcance(
    {
      AND: [
        await filtroBusquedaEmpleados(db, sp.search ?? "", { conIdentidad: vePII }),
        sp.sucursalId ? { sucursalId: sp.sucursalId } : {},
        sp.divisionId ? { departamento: { divisionId: sp.divisionId } } : {},
        filtroEstado(sp.estado),
      ],
    },
    usuario
  );
}

/** Los filtros de la lista como texto para `?lista=` (vacío si no hay ninguno). */
export function textoLista(sp: ParamsLista): string {
  const q = new URLSearchParams();
  for (const k of CLAVES) if (sp[k]) q.set(k, sp[k]!);
  return q.toString();
}

export function leerLista(texto: string | undefined | null): ParamsLista {
  const q = new URLSearchParams(texto ?? "");
  const sp: ParamsLista = {};
  for (const k of CLAVES) {
    const v = q.get(k);
    if (v) sp[k] = v.slice(0, 200);
  }
  return sp;
}

export interface Vecino {
  id: string;
  nombre: string;
}

export interface Vecinos {
  anterior: Vecino | null;
  siguiente: Vecino | null;
  /** 1 = el primero. */
  posicion: number;
  total: number;
}

/** El anterior y el siguiente en una lista ya ordenada; null si el empleado no está en ella. */
export function vecinosEn(lista: readonly { id: string; nombre: string }[], id: string): Vecinos | null {
  const i = lista.findIndex((e) => e.id === id);
  if (i < 0) return null;
  return { anterior: lista[i - 1] ?? null, siguiente: lista[i + 1] ?? null, posicion: i + 1, total: lista.length };
}

/**
 * El anterior y el siguiente de un empleado en la lista tal como se veía. Si con esos filtros
 * ya no aparece (llegó por otro camino, o cambió), se usa la lista sin filtros.
 */
export async function vecinosEmpleado(
  db: PrismaClient,
  usuario: UsuarioConAlcance,
  id: string,
  sp: ParamsLista,
  vePII: boolean
): Promise<Vecinos | null> {
  const buscar = async (p: ParamsLista) => {
    const filas = await db.empleado.findMany({
      where: await filtroLista(db, usuario, p, vePII),
      orderBy: ordenDeConsulta(ordenLista(p, vePII)),
      select: { id: true, primerNombre: true, primerApellido: true },
      take: 20_000,
    });
    return vecinosEn(filas.map((f) => ({ id: f.id, nombre: `${f.primerNombre} ${f.primerApellido}` })), id);
  };
  return (await buscar(sp)) ?? (textoLista(sp) ? await buscar({}) : null);
}
