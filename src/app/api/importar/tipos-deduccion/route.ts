/**
 * Catálogo de tipos de deducción por plantilla, fase 1: VALIDAR. No escribe nada.
 * Cambiar el catálogo es configurar: pide `deducciones.configurar`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { crearLote, leerArchivo, MAX_FILAS_ARCHIVO } from "@/lib/importacion/lote";
import { ACEPTA_PLANTILLA, textoDeArchivo } from "@/lib/importacion/xlsx";
import { cargarTiposExistentes, validarTipos } from "@/lib/importacion/tipos-deduccion";
import type { InformeValidacion, ModoImportacion } from "@/lib/importacion/tipos";
import { filasLeidas } from "@/lib/importacion/tipos";

const MODOS: ModoImportacion[] = ["CREAR", "ACTUALIZAR", "CREAR_O_ACTUALIZAR"];

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.configurar");
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "La petición no trae un archivo válido." }, { status: 400 });
  }
  const archivo = await leerArchivo(form, "archivo", ACEPTA_PLANTILLA);
  if (!archivo.ok) return NextResponse.json({ error: archivo.error }, { status: 400 });
  const modoBruto = String(form.get("modo") ?? "CREAR_O_ACTUALIZAR") as ModoImportacion;
  const modo: ModoImportacion = MODOS.includes(modoBruto) ? modoBruto : "CREAR_O_ACTUALIZAR";

  const lectura = await textoDeArchivo(archivo.nombre, archivo.bytes);
  if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: 400 });

  const r = validarTipos(lectura.texto, await cargarTiposExistentes(prisma), modo);
  const totalFilas = filasLeidas(r);
  if (totalFilas > MAX_FILAS_ARCHIVO) {
    return NextResponse.json({ error: `El archivo trae ${totalFilas} filas y el máximo por lote es ${MAX_FILAS_ARCHIVO}.` }, { status: 413 });
  }

  const totalErrores = r.incidencias.filter((i) => i.severidad === "ERROR").length;
  const totalCrear = r.filas.filter((f) => f.accion === "CREAR").length;
  const totalActualizar = r.filas.length - totalCrear;
  const aplicable = totalErrores === 0 && r.filas.length > 0;
  const lote = await crearLote(prisma, {
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    filas: r.filas,
    incidencias: r.incidencias,
    previsualizacion: r.previsualizacion,
    totalCrear,
    totalActualizar,
    totalErrores,
    usuario: g.usuario,
  });

  const informe: InformeValidacion = {
    loteId: aplicable ? lote.id : null,
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    totalFilas,
    totalCrear,
    totalActualizar,
    totalOmitir: r.totalOmitir,
    totalErrores,
    incidencias: r.incidencias,
    filas: r.previsualizacion,
    columnasDesconocidas: r.columnasDesconocidas,
    expiraEn: lote.expiraEn.toISOString(),
    aplicable,
  };
  return NextResponse.json(informe);
}
