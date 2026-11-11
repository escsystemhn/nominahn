/**
 * Montos del período, fase 1: VALIDAR. No escribe nada.
 *
 * Recibe el archivo por empleado (una columna por tipo de deducción) y el período al
 * que se aplica, y devuelve qué celdas cambian contra lo que hay hoy: nuevos, que
 * cambian, que se quitan y sin cambio. Ver `lib/importacion/montos-periodo.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { crearLote, leerArchivo } from "@/lib/importacion/lote";
import { ACEPTA_PLANTILLA, textoDeArchivo } from "@/lib/importacion/xlsx";
import { cargarContexto, sugerirTiposNuevos, validarMontos } from "@/lib/importacion/montos-periodo";
import {
  TIPOS_PLANILLA,
  errorDePeriodo,
  frasePeriodo,
  periodoDeNombreArchivo,
  rangoPeriodo,
  type TipoPlanillaPeriodo,
} from "@/lib/payroll/periodos-planilla";
import type { InformeValidacion } from "@/lib/importacion/tipos";

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("deducciones.importar");
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "La petición no trae un archivo válido." }, { status: 400 });
  }

  const tipo = String(form.get("tipoPlanilla") ?? "") as TipoPlanillaPeriodo;
  const desde = String(form.get("desde") ?? "");
  const hasta = String(form.get("hasta") ?? "");
  if (!TIPOS_PLANILLA.includes(tipo)) return NextResponse.json({ error: "Elija el tipo de planilla." }, { status: 400 });
  const errorPeriodo = errorDePeriodo({ desde, hasta });
  if (errorPeriodo) return NextResponse.json({ error: errorPeriodo }, { status: 400 });
  const periodo = { tipo, desde, hasta };

  const archivo = await leerArchivo(form, "archivo", ACEPTA_PLANTILLA);
  if (!archivo.ok) return NextResponse.json({ error: archivo.error }, { status: 400 });
  const lectura = await textoDeArchivo(archivo.nombre, archivo.bytes);
  if (!lectura.ok) return NextResponse.json({ error: lectura.error }, { status: 400 });

  const [ctx, codigos] = await Promise.all([
    cargarContexto(prisma, periodo),
    prisma.tipoDeduccionConfig.findMany({ select: { codigo: true } }),
  ]);
  const r = validarMontos(lectura.texto, ctx, (e) => alcanzaEmpleado(g.usuario, e));
  const tiposNuevos = sugerirTiposNuevos(lectura.texto, r.columnasDesconocidas, codigos.map((c) => c.codigo));

  // El archivo exportado lleva sus fechas en el nombre: si no coinciden con las elegidas, se avisa.
  const delNombre = periodoDeNombreArchivo(archivo.nombre);
  if (delNombre && (delNombre.desde !== desde || delNombre.hasta !== hasta)) {
    r.incidencias.unshift({
      linea: 1,
      severidad: "AVISO",
      mensaje: `El archivo se exportó para el período ${rangoPeriodo(delNombre.desde, delNombre.hasta)}, pero eligió ${rangoPeriodo(desde, hasta)}. Los montos se aplicarán al período elegido.`,
    });
  }

  const totalErrores = r.incidencias.filter((i) => i.severidad === "ERROR").length;
  const aplicable = totalErrores === 0 && r.operaciones.length > 0;
  const lote = await crearLote(prisma, {
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    filas: r.operaciones.map((o) => ({ ...o, ...periodo })),
    incidencias: r.incidencias,
    previsualizacion: r.previsualizacion,
    totalCrear: r.nuevos,
    totalActualizar: r.cambian + r.seQuitan,
    totalErrores,
    usuario: g.usuario,
  });

  const informe: InformeValidacion = {
    loteId: aplicable ? lote.id : null,
    tipo: "DEDUCCIONES",
    nombreArchivo: archivo.nombre,
    totalFilas: r.totalFilas,
    totalCrear: r.nuevos,
    totalActualizar: r.cambian + r.seQuitan,
    totalOmitir: r.sinCambio,
    totalErrores,
    incidencias: r.incidencias,
    filas: r.previsualizacion,
    columnasDesconocidas: r.columnasDesconocidas,
    expiraEn: lote.expiraEn.toISOString(),
    aplicable,
    cifras: [
      { label: "Nuevos", valor: r.nuevos },
      { label: "Cambian", valor: r.cambian },
      { label: "Se quitan", valor: r.seQuitan },
      { label: "Sin cambio", valor: r.sinCambio },
      { label: "Con errores", valor: totalErrores },
    ],
    resumen: r.operaciones.length
      ? `Se aplicarán sólo ${frasePeriodo(periodo, "a")}. Las deducciones de cada planilla no cambian: en este período, el monto nuevo las reemplaza.`
      : totalErrores === 0 ? "El archivo coincide con lo que ya hay en el período: no hay nada que cambiar." : undefined,
    tiposNuevos,
  };
  return NextResponse.json(informe);
}
