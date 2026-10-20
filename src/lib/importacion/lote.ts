/**
 * Ciclo de vida de un lote de importación.
 *
 * El lote es lo que une las dos fases: `validar` lo crea con las filas ya
 * normalizadas, y `confirmar` lo lee y lo aplica. Vive en la base y no en
 * memoria porque entre una fase y otra puede reiniciarse el proceso o atender la
 * petición otra instancia; un caché en memoria haría que el usuario confirmara
 * un lote que ya no existe.
 *
 * Además impone las tres condiciones que hacen que confirmar sea seguro:
 * es SUYO, no ha CADUCADO y no se ha APLICADO ya.
 */

import type { Prisma, PrismaClient, TipoImportacion } from "@prisma/client";
import type { Incidencia, FilaPrevisualizada } from "./tipos";

/**
 * Cuánto vive un lote sin confirmar.
 *
 * Corto a propósito: las filas se validaron contra un estado de la base (qué
 * empleados existen, qué salario tienen, qué períodos están cerrados) que cambia.
 * Aplicar horas después un archivo validado con datos viejos es justo el tipo de
 * escritura que nadie sabe explicar luego.
 */
export const VIDA_LOTE_MS = 30 * 60 * 1000; // 30 minutos

/** Tope de filas por archivo. Más que esto conviene partirlo por sucursal. */
export const MAX_FILAS_ARCHIVO = 5_000;

/** Tamaño máximo del archivo subido. Un CSV de 5.000 filas no llega a 2 MB. */
export const MAX_BYTES_ARCHIVO = 5 * 1024 * 1024;

export interface DatosLote {
  tipo: TipoImportacion;
  nombreArchivo: string;
  filas: unknown[];
  incidencias: Incidencia[];
  previsualizacion: FilaPrevisualizada[];
  totalCrear: number;
  totalActualizar: number;
  totalErrores: number;
  usuario: { id?: string; email?: string | null };
}

export async function crearLote(db: PrismaClient, datos: DatosLote) {
  return db.loteImportacion.create({
    data: {
      tipo: datos.tipo,
      estado: datos.totalErrores > 0 ? "RECHAZADO" : "VALIDADO",
      nombreArchivo: datos.nombreArchivo,
      filas: datos.filas as Prisma.InputJsonValue,
      incidencias: {
        incidencias: datos.incidencias,
        previsualizacion: datos.previsualizacion,
      } as unknown as Prisma.InputJsonValue,
      totalFilas: datos.filas.length,
      totalCrear: datos.totalCrear,
      totalActualizar: datos.totalActualizar,
      totalErrores: datos.totalErrores,
      expiraEn: new Date(Date.now() + VIDA_LOTE_MS),
      usuarioId: datos.usuario.id,
      usuarioEmail: datos.usuario.email ?? undefined,
    },
  });
}

export type LoteUtilizable =
  | { ok: true; lote: Awaited<ReturnType<typeof crearLote>> }
  | { ok: false; motivo: string; codigo: 404 | 409 | 410 };

/**
 * Recupera un lote que se puede aplicar.
 *
 * QUE SEA SUYO NO ES UNA FORMALIDAD: sin esa comprobación, cualquiera con el
 * permiso de importar podría confirmar el lote que otra persona dejó a medias
 * tras ver que estaba mal.
 *
 * Un lote de otro usuario devuelve 404, no 403: confirmar que ese identificador
 * existe ya diría más de lo necesario.
 */
export async function tomarLote(
  db: PrismaClient,
  id: string,
  tipo: TipoImportacion,
  usuarioId: string | undefined
): Promise<LoteUtilizable> {
  const lote = await db.loteImportacion.findUnique({ where: { id } });

  if (!lote || lote.tipo !== tipo || (usuarioId && lote.usuarioId !== usuarioId)) {
    return { ok: false, motivo: "El lote no existe o ya no está disponible.", codigo: 404 };
  }
  if (lote.estado === "APLICADO") {
    return { ok: false, motivo: "Este archivo ya se aplicó.", codigo: 409 };
  }
  if (lote.estado !== "VALIDADO") {
    return { ok: false, motivo: `El lote está en estado ${lote.estado} y no puede aplicarse.`, codigo: 409 };
  }
  if (lote.expiraEn < new Date()) {
    // Se marca al detectarlo, para que la lista de lotes refleje la realidad sin
    // necesidad de una tarea programada que los barra.
    await db.loteImportacion.update({ where: { id }, data: { estado: "EXPIRADO" } });
    return {
      ok: false,
      motivo: "La vista previa caducó porque los datos pueden haber cambiado. Vuelva a subir el archivo.",
      codigo: 410,
    };
  }

  return { ok: true, lote };
}

export async function marcarAplicado(
  db: PrismaClient,
  id: string,
  resultado: { creados: number; actualizados: number }
) {
  await db.loteImportacion.update({
    where: { id },
    data: { estado: "APLICADO", aplicadoEn: new Date(), resultado },
  });
}

/**
 * Lee el archivo de un `multipart/form-data` aplicando el tope de tamaño.
 *
 * El límite se comprueba sobre `file.size` ANTES de materializar el contenido:
 * leer primero y medir después ya habría cargado el archivo entero en memoria,
 * que es lo que el límite pretende evitar.
 */
export async function leerArchivo(
  form: FormData,
  campo = "archivo"
): Promise<{ ok: true; nombre: string; bytes: Uint8Array } | { ok: false; error: string }> {
  const entrada = form.get(campo);
  if (!(entrada instanceof File)) {
    return { ok: false, error: "No se recibió ningún archivo." };
  }
  if (entrada.size === 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (entrada.size > MAX_BYTES_ARCHIVO) {
    return {
      ok: false,
      error: `El archivo pesa ${(entrada.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${MAX_BYTES_ARCHIVO / 1024 / 1024} MB.`,
    };
  }
  const nombre = entrada.name || "importacion.csv";
  if (!/\.(csv|txt)$/i.test(nombre)) {
    return { ok: false, error: "Sólo se aceptan archivos .csv" };
  }

  return { ok: true, nombre, bytes: new Uint8Array(await entrada.arrayBuffer()) };
}
