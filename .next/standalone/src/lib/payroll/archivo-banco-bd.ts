/** Formatos de archivo bancario: esquema, lectura y siembra del genérico. */

import { z } from "zod";
import type { PrismaClient, FormatoBanco } from "@prisma/client";
import { FORMATO_GENERICO, type FormatoArchivoBanco, type ColumnaBanco } from "./archivo-banco";

const CAMPO = z.enum(["cuenta", "identidad", "nombre", "codigo", "banco", "monto", "referencia", "concepto", "fechaPago", "secuencia", "constante"]);

export const schemaColumna = z.object({
  campo: CAMPO,
  titulo: z.string().trim().max(60).optional(),
  ancho: z.coerce.number().int().min(1).max(200).optional(),
  alinear: z.enum(["IZQUIERDA", "DERECHA"]).optional(),
  relleno: z.enum(["ESPACIO", "CERO"]).optional(),
  valor: z.string().max(100).optional(),
  formato: z.string().max(40).optional(),
});

export const schemaFormatoBanco = z.object({
  nombre: z.string().trim().min(1, "requerido").max(80),
  filtroBanco: z.string().trim().max(80).optional().nullable(),
  tipo: z.enum(["DELIMITADO", "ANCHO_FIJO"]),
  delimitador: z.string().max(3),
  encabezado: z.boolean(),
  columnas: z.array(schemaColumna).min(1).max(40),
  extension: z.string().trim().regex(/^[a-z0-9]{1,5}$/, "sólo letras y números, hasta 5"),
  codificacion: z.enum(["utf8", "latin1"]),
  finLinea: z.enum(["CRLF", "LF"]),
  lineaTotal: z.boolean(),
  activo: z.boolean().optional(),
});

export type CuerpoFormatoBanco = z.infer<typeof schemaFormatoBanco>;

/** Fila de la base → formato que entiende el generador. */
export function aFormato(f: Pick<FormatoBanco, "tipo" | "delimitador" | "encabezado" | "columnas" | "finLinea" | "lineaTotal" | "filtroBanco">): FormatoArchivoBanco {
  return {
    tipo: f.tipo === "ANCHO_FIJO" ? "ANCHO_FIJO" : "DELIMITADO",
    delimitador: f.delimitador === "\\t" ? "\t" : f.delimitador,
    encabezado: f.encabezado,
    columnas: (Array.isArray(f.columnas) ? f.columnas : []) as unknown as ColumnaBanco[],
    finLinea: f.finLinea === "LF" ? "LF" : "CRLF",
    lineaTotal: f.lineaTotal,
    filtroBanco: f.filtroBanco,
  };
}

/** Siembra el formato genérico si no hay ninguno. Idempotente. */
export async function asegurarFormatos(db: PrismaClient): Promise<void> {
  if ((await db.formatoBanco.count()) > 0) return;
  const { nombre, extension, codificacion, columnas, ...resto } = FORMATO_GENERICO;
  await db.formatoBanco.create({
    data: { nombre, extension, codificacion, ...resto, filtroBanco: null, columnas: columnas as unknown as object, esSistema: true },
  });
}
