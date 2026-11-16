/**
 * La lista de Empleados: su filtro y su orden, en un solo lugar. Los usan la lista y las
 * flechas ‹ › de la ficha y de Editar, que recorren a los empleados en el MISMO orden y con
 * los MISMOS filtros con que se veía la lista (pedido de Edbin, 2026-11-16). La lista le pasa
 * a la ficha sus filtros en `?lista=` (búsqueda, sucursal, orden; no la página).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { conAlcance, type UsuarioConAlcance } from "@/lib/auth/alcance";
import { leerOrden, type Orden } from "@/lib/http/orden";
import { filtroBusquedaEmpleados } from "@/lib/empleados/busqueda";

export const COLUMNAS_LISTA = ["codigo", "empleado", "sucursal", "departamento", "puesto", "salario", "ingreso", "estado"] as const;
export type ColumnaLista = (typeof COLUMNAS_LISTA)[number];

export interface ParamsLista {
  search?: string;
  sucursalId?: string;
  orden?: string;
  dir?: string;
}

const CLAVES: readonly (keyof ParamsLista)[] = ["search", "sucursalId", "orden", "dir"];

export function ordenDeConsulta({ campo, dir }: Orden<ColumnaLista>): Prisma.EmpleadoOrderByWithRelationInput[] {
  const principal: Record<ColumnaLista, Prisma.EmpleadoOrderByWithRelationInput[]> = {
    codigo: [{ codigo: dir }],
    empleado: [{ primerApellido: dir }, { primerNombre: dir }],
    sucursal: [{ sucursal: { nombre: dir } }],
    departamento: [{ departamento: { nombre: dir } }],
    puesto: [{ puesto: { nombre: dir } }],
    salario: [{ salarioBase: dir }],
    ingreso: [{ fechaIngreso: dir }],
    estado: [{ estado: dir }],
  };
  // El `id` desempata: sin él, dos filas iguales pueden saltar de una página a otra.
  return [...principal[campo], { id: "asc" }];
}

/** El orden pedido; sin permiso para ver salarios, tampoco se ordena por salario. */
export function ordenLista(sp: ParamsLista, vePII: boolean): Orden<ColumnaLista> {
  return leerOrden(sp, vePII ? COLUMNAS_LISTA : COLUMNAS_LISTA.filter((c) => c !== "salario"), { campo: "empleado", dir: "asc" });
}

/** Filtro de la lista. `conAlcance` combina con AND: nadie ve a quien está fuera de su alcance. */
export async function filtroLista(db: PrismaClient, usuario: UsuarioConAlcance, sp: ParamsLista, vePII: boolean): Promise<Prisma.EmpleadoWhereInput> {
  return conAlcance(
    { AND: [await filtroBusquedaEmpleados(db, sp.search ?? "", { conIdentidad: vePII }), sp.sucursalId ? { sucursalId: sp.sucursalId } : {}] },
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
