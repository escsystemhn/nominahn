/**
 * Fase 1 de la importación de un plan de horarios: VALIDAR. No escribe nada.
 * Lo propio está en `lib/importacion/horarios.ts`; la forma, igual que las demás
 * importaciones (vista previa con un lote que vence a los 30 minutos).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { vistaDePlan } from "@/lib/horarios/alcance";
import { cargarCatalogos, validar } from "@/lib/importacion/horarios";
import { crearLote, leerArchivo, MAX_FILAS_ARCHIVO } from "@/lib/importacion/lote";
import { ACEPTA_PLANTILLA, textoDeArchivo } from "@/lib/importacion/xlsx";
import type { InformeValidacion, ModoImportacion } from "@/lib/importacion/tipos";
import { filasLeidas } from "@/lib/importacion/tipos";

const MODOS: ModoImportacion[] = ["CREAR", "ACTUALIZAR", "CREAR_O_ACTUALIZAR"];

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "La petición no trae un archivo válido." }, { status: 400 });
  }
  const planId = String(form.get("planId") ?? "");
  const vista = planId ? await vistaDePlan(prisma, g.usuario, planId) : { acceso: "ninguno" as const };
  if (vista.acceso === "ninguno") return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const archivo = await leerArchivo(form, "archivo", ACEPTA_PLANTILLA);
  if (!archivo.ok) return NextResponse.json({ error: archivo.error }, { status: 400 });
  const modoBruto = String(form.get("modo") ?? "CREAR_O_ACTUALIZAR") as ModoImportacion;
  const modo: ModoImportacion = MODOS.includes(modoBruto) ? modoBruto : "CREAR_O_ACTUALIZAR";

  const lectura = await textoDeArchivo(archivo.nombre, archivo.bytes);
  if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: 400 });

  const catalogos = await cargarCatalogos(prisma, planId);
  if (!catalogos) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  const resultado = validar(
    lectura.texto,
    catalogos,
    modo,
    (empleado) => alcanzaEmpleado(g.usuario, empleado),
    // Con acceso parcial al plan, sólo sus sucursales.
    (sucursalId) => vista.acceso === "total" || vista.sucursales.has(sucursalId)
  );

  const totalFilas = filasLeidas(resultado);
  if (totalFilas > MAX_FILAS_ARCHIVO) {
    return NextResponse.json({ error: `El archivo trae ${totalFilas} filas y el máximo por lote es ${MAX_FILAS_ARCHIVO}.` }, { status: 413 });
  }

  const totalErrores = resultado.incidencias.filter((i) => i.severidad === "ERROR").length;
  const totalCrear = resultado.filas.filter((f) => f.accion === "CREAR").length;
  const totalActualizar = resultado.filas.length - totalCrear;
  const traslados = new Set(resultado.filas.filter((f) => f.crearTrasladoA).map((f) => f.empleadoId)).size;

  const lote = await crearLote(prisma, {
    tipo: "HORARIOS",
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
    tipo: "HORARIOS",
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
    ...(traslados > 0 ? { resumen: `Se crearán traslados temporales para ${traslados} ${traslados === 1 ? "persona" : "personas"} de otras sucursales.` } : {}),
  };
  return NextResponse.json(informe);
}
