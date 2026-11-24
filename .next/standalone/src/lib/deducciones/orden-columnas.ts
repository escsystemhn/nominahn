/**
 * El orden de las columnas de deducción de la planilla, en pantalla y al imprimir (pedido
 * de Edbin, 2026-11-23): uno solo, para todos y para los dos. Se guarda por código de tipo
 * (así sobrevive a un cambio de nombre) en ConfiguracionSistema.
 *
 * Sin guardar, el del formato de captura por sucursal si se recordó uno (la planilla de la
 * empresa ya tiene su orden); si tampoco, por nombre. Un tipo que no está en la lista va
 * al final, por nombre. El ISR fijo y el vecinal no cuentan: tienen su columna de ley.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { CODIGO_ISR_FIJO } from "@/lib/payroll/deducciones";
import { CODIGO_VECINAL } from "@/lib/payroll/vecinal-anual";
import { leerFormatoGuardado } from "@/lib/importacion/formato-captura";

type Db = PrismaClient | Prisma.TransactionClient;

export const CLAVE_ORDEN_DEDUCCIONES = "PLANILLA_ORDEN_DEDUCCIONES";
/** Van en sus columnas de ley, no entre las deducciones por tipo. */
export const FUERA_DEL_ORDEN: ReadonlySet<string> = new Set([CODIGO_ISR_FIJO, CODIGO_VECINAL]);

export type OrigenOrden = "GUARDADO" | "FORMATO" | "NOMBRE";

const listaDeCodigos = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((c): c is string => typeof c === "string" && !FUERA_DEL_ORDEN.has(c)))] : [];

export async function leerOrdenGuardado(db: Db): Promise<string[] | null> {
  const fila = await db.configuracionSistema.findUnique({ where: { clave: CLAVE_ORDEN_DEDUCCIONES }, select: { valor: true } });
  if (!fila) return null;
  try {
    return listaDeCodigos(JSON.parse(fila.valor));
  } catch {
    // Un valor dañado no debe impedir ver la planilla: se usa el orden de siempre.
    return null;
  }
}

/** El orden que rige, en códigos, y de dónde sale. */
export async function ordenDeDeducciones(db: Db): Promise<{ codigos: string[]; origen: OrigenOrden }> {
  const guardado = await leerOrdenGuardado(db);
  if (guardado) return { codigos: guardado, origen: "GUARDADO" };
  const formato = await leerFormatoGuardado(db);
  const delFormato = listaDeCodigos(formato?.columnas);
  return delFormato.length ? { codigos: delFormato, origen: "FORMATO" } : { codigos: [], origen: "NOMBRE" };
}

/**
 * El orden en NOMBRES de tipo, que es como las líneas guardan sus deducciones
 * (`deduccionesPorNombre`). Para `columnasDeDeducciones` y `columnasDetalle`.
 */
export async function nombresEnOrden(db: Db): Promise<string[]> {
  const { codigos } = await ordenDeDeducciones(db);
  if (!codigos.length) return [];
  const tipos = await db.tipoDeduccionConfig.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true, nombre: true } });
  const nombre = new Map(tipos.map((t) => [t.codigo, t.nombre]));
  return codigos.map((c) => nombre.get(c)).filter((n): n is string => !!n);
}

export async function guardarOrden(db: Db, codigos: readonly string[]): Promise<void> {
  const valor = JSON.stringify(listaDeCodigos(codigos));
  await db.configuracionSistema.upsert({
    where: { clave: CLAVE_ORDEN_DEDUCCIONES },
    update: { valor },
    create: { clave: CLAVE_ORDEN_DEDUCCIONES, valor, descripcion: "Orden de las columnas de deducción en la planilla, en pantalla y al imprimir" },
  });
}

export async function quitarOrden(db: Db): Promise<boolean> {
  const r = await db.configuracionSistema.deleteMany({ where: { clave: CLAVE_ORDEN_DEDUCCIONES } });
  return r.count > 0;
}

/** Para editarlo: los tipos en el orden que rige; los que no están en él, al final y por nombre. Pura. */
export function ordenarTipos<T extends { codigo: string; nombre: string }>(tipos: readonly T[], codigos: readonly string[]): T[] {
  const pos = new Map(codigos.map((c, i) => [c, i]));
  return [...tipos].sort((a, b) =>
    (pos.get(a.codigo) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.codigo) ?? Number.MAX_SAFE_INTEGER) || a.nombre.localeCompare(b.nombre, "es"));
}
