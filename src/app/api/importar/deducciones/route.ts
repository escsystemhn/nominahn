/**
 * Fase 1 de la importación de deducciones: VALIDAR. No escribe nada.
 *
 * Mismo esquema que la de empleados. Lo propio de este archivo es que además de
 * validar formatos comprueba reglas de nómina: que el tipo de deducción no sea
 * uno legal (esos los calcula la planilla), que el monto de una deducción ya
 * amortizada no se reescriba, y que se avise cuando el descuento arranca dentro
 * de un período ya pagado.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { decodificar } from "@/lib/importacion/csv";
import { cargarCatalogos, validar } from "@/lib/importacion/deducciones";
import { crearLote, leerArchivo, MAX_FILAS_ARCHIVO } from "@/lib/importacion/lote";
import type { InformeValidacion, ModoImportacion } from "@/lib/importacion/tipos";

const MODOS: ModoImportacion[] = ["CREAR", "ACTUALIZAR", "CREAR_O_ACTUALIZAR"];

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.importar");
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "La petición no trae un archivo válido." }, { status: 400 });
  }

  const archivo = await leerArchivo(form);
  if (!archivo.ok) return NextResponse.json({ error: archivo.error }, { status: 400 });

  const modoBruto = String(form.get("modo") ?? "CREAR_O_ACTUALIZAR") as ModoImportacion;
  const modo: ModoImportacion = MODOS.includes(modoBruto) ? modoBruto : "CREAR_O_ACTUALIZAR";

  const texto = decodificar(archivo.bytes);
  const catalogos = await cargarCatalogos(prisma);
  const alcanza = (empleado: { id: string; sucursalId: string; departamentoId: string }) =>
    alcanzaEmpleado(g.usuario, empleado);

  const resultado = validar(texto, catalogos, modo, alcanza);

  const totalFilas = resultado.filas.length + resultado.totalOmitir;
  if (totalFilas > MAX_FILAS_ARCHIVO) {
    return NextResponse.json(
      { error: `El archivo trae ${totalFilas} filas y el máximo por lote es ${MAX_FILAS_ARCHIVO}.` },
      { status: 413 }
    );
  }

  const totalErrores = resultado.incidencias.filter((i) => i.severidad === "ERROR").length;
  const totalCrear = resultado.filas.filter((f) => f.accion === "CREAR").length;
  const totalActualizar = resultado.filas.length - totalCrear;

  const lote = await crearLote(prisma, {
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    filas: resultado.filas,
    incidencias: resultado.incidencias,
    previsualizacion: resultado.previsualizacion,
    totalCrear,
    totalActualizar,
    totalErrores,
    usuario: g.usuario,
  });

  const informe: InformeValidacion = {
    loteId: totalErrores === 0 && resultado.filas.length > 0 ? lote.id : null,
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    totalFilas,
    totalCrear,
    totalActualizar,
    totalOmitir: resultado.totalOmitir,
    totalErrores,
    incidencias: resultado.incidencias,
    filas: resultado.previsualizacion,
    columnasDesconocidas: resultado.columnasDesconocidas,
    expiraEn: lote.expiraEn.toISOString(),
    aplicable: totalErrores === 0 && resultado.filas.length > 0,
  };

  return NextResponse.json(informe);
}
