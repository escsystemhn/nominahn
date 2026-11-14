/**
 * Alta y edición de tipos de deducción: una sola validación para la ventana «Nuevo
 * tipo», la edición, la creación desde las columnas de un archivo y la plantilla del
 * catálogo. Ver `lib/deducciones/tipos.ts` para el porqué de las categorías.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { CODIGO_ISR_FIJO } from "@/lib/payroll/deducciones";
import { leerMonto } from "@/lib/formato/monto-texto";
import { PATRON_CODIGO, esCategoriaAsignable, normalizarCodigo, type CategoriaDeduccion } from "./tipos";

type Db = PrismaClient | Prisma.TransactionClient;

/** IHSS, RAP, INFOP y demás de ley, y la retención fija de ISR: los maneja Parámetros de ley. */
export function esTipoDelSistema(t: { esLegal: boolean; codigo: string }): boolean {
  return t.esLegal || t.codigo === CODIGO_ISR_FIJO;
}

export const MOTIVO_SISTEMA = "es de ley o del sistema: se configura en Configuración → Parámetros de ley.";

export interface DatosTipo {
  nombre: string;
  codigo: string;
  tipo: CategoriaDeduccion;
  /** Monto habitual: se propone al asignarlo. */
  montoFijo: string | null;
  descripcion: string | null;
}

export type Lectura<T> = { ok: true; valor: T } | { ok: false; error: string };

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const claveNombreTipo = plano;

export function leerNombre(v: unknown): Lectura<string> {
  const t = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (t.length < 2) return { ok: false, error: "Escriba el nombre del tipo de deducción." };
  if (t.length > 80) return { ok: false, error: "El nombre no puede pasar de 80 caracteres." };
  return { ok: true, valor: t };
}

export function leerCodigo(v: unknown): Lectura<string> {
  const c = normalizarCodigo(typeof v === "string" ? v : "");
  if (!c) return { ok: false, error: "Escriba el código, por ejemplo COOP-ELGA." };
  if (!PATRON_CODIGO.test(c)) return { ok: false, error: `El código «${c}» no sirve: use letras, números, guion o guion bajo, hasta 30.` };
  return { ok: true, valor: c };
}

export function leerTipo(v: unknown): Lectura<CategoriaDeduccion> {
  return typeof v === "string" && esCategoriaAsignable(v) ? { ok: true, valor: v } : { ok: false, error: "Elija la categoría." };
}

export function leerMontoHabitual(v: unknown): Lectura<string | null> {
  if (v === null || v === undefined || v === "") return { ok: true, valor: null };
  const r = leerMonto(String(v));
  if (!r.ok) return { ok: false, error: `Monto habitual: ${r.error}.` };
  if (r.valor === null || r.valor === 0) return { ok: true, valor: null };
  if (r.valor > 5_000_000) return { ok: false, error: "El monto habitual es demasiado alto." };
  return { ok: true, valor: r.valor.toFixed(2) };
}

export function leerDescripcion(v: unknown): Lectura<string | null> {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length > 500) return { ok: false, error: "La descripción no puede pasar de 500 caracteres." };
  return { ok: true, valor: t || null };
}

/** Lee los datos de un tipo nuevo; devuelve el primer error en palabras. */
export function leerDatosTipo(d: Record<string, unknown>): Lectura<DatosTipo> {
  const nombre = leerNombre(d.nombre);
  if (!nombre.ok) return nombre;
  const codigo = leerCodigo(d.codigo);
  if (!codigo.ok) return codigo;
  const tipo = leerTipo(d.tipo);
  if (!tipo.ok) return tipo;
  const monto = leerMontoHabitual(d.montoFijo);
  if (!monto.ok) return monto;
  const descripcion = leerDescripcion(d.descripcion);
  if (!descripcion.ok) return descripcion;
  return { ok: true, valor: { nombre: nombre.valor, codigo: codigo.valor, tipo: tipo.valor, montoFijo: monto.valor, descripcion: descripcion.valor } };
}

/**
 * Comprueba que códigos y nombres no choquen con el catálogo ni entre sí. Un nombre
 * repetido no es ilegal, pero en el archivo por empleado dos columnas se llamarían
 * igual y se confundirían.
 */
export async function conflictosDeTipos(db: Db, nuevos: readonly Pick<DatosTipo, "codigo" | "nombre">[], excluirId?: string): Promise<string | null> {
  const existentes = await db.tipoDeduccionConfig.findMany({ select: { id: true, codigo: true, nombre: true } });
  const codigos = new Map(existentes.filter((t) => t.id !== excluirId).map((t) => [t.codigo, t.nombre]));
  const nombres = new Map(existentes.filter((t) => t.id !== excluirId).map((t) => [plano(t.nombre), t.codigo]));
  const vistosC = new Set<string>(), vistosN = new Set<string>();
  for (const n of nuevos) {
    if (codigos.has(n.codigo)) return `El código ${n.codigo} ya es de «${codigos.get(n.codigo)}».`;
    if (nombres.has(plano(n.nombre))) return `Ya hay un tipo llamado «${n.nombre}» (${nombres.get(plano(n.nombre))}).`;
    if (vistosC.has(n.codigo)) return `El código ${n.codigo} viene dos veces.`;
    if (vistosN.has(plano(n.nombre))) return `El nombre «${n.nombre}» viene dos veces.`;
    vistosC.add(n.codigo); vistosN.add(plano(n.nombre));
  }
  return null;
}

/** Lo que se guarda al crear. Nunca de ley: esos son del sistema. */
export function datosParaCrear(d: DatosTipo): Prisma.TipoDeduccionConfigCreateInput {
  return {
    nombre: d.nombre, codigo: d.codigo, tipo: d.tipo, montoFijo: d.montoFijo, descripcion: d.descripcion,
    esLegal: false, aplicaEmpleado: true, aplicaEmpleador: false, activo: true,
  };
}
