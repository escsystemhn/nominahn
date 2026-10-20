/**
 * Fase 1 de la importación de empleados: VALIDAR.
 *
 * Esta ruta no escribe ni un registro de empleado. Lee el archivo, lo valida
 * contra el estado actual de la base y guarda el resultado como lote a la espera
 * de confirmación. Lo que devuelve es un informe: qué se creará, qué se
 * actualizará y qué está mal, con el número de línea del archivo.
 *
 * Separar validar de aplicar es lo que evita el peor escenario de una carga
 * masiva de nómina: descubrir el error en la fila 200 con las 199 anteriores ya
 * escritas.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { decodificar } from "@/lib/importacion/csv";
import { cargarCatalogos, validar, type ComprobadorAlcance } from "@/lib/importacion/empleados";
import { crearLote, leerArchivo, MAX_FILAS_ARCHIVO } from "@/lib/importacion/lote";
import type { InformeValidacion, ModoImportacion } from "@/lib/importacion/tipos";

const MODOS: ModoImportacion[] = ["CREAR", "ACTUALIZAR", "CREAR_O_ACTUALIZAR"];

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("empleados.importar");
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

  // El alcance de datos acompaña a la importación: quien sólo alcanza su
  // sucursal no puede actualizar el expediente de otra escribiendo su código en
  // un CSV, ni dar de alta personal fuera de ella.
  const alcanza = ((empleado) => alcanzaEmpleado(g.usuario, empleado)) as ComprobadorAlcance;
  alcanza.sucursal = (sucursalId: string) => {
    const alcance = g.usuario.alcance ?? "TODO";
    if (alcance === "TODO") return true;
    if (alcance === "SUCURSAL") return (g.usuario.sucursalesIds ?? []).includes(sucursalId);
    // Con alcance DEPARTAMENTO o PROPIO no se dan altas: no hay forma de acotar
    // el destino a un departamento desde una sola columna de sucursal, y el
    // fallo seguro es no permitirlo.
    return false;
  };

  const resultado = validar(texto, catalogos, modo, alcanza);

  // Un archivo enorme se rechaza tras validar y no antes, para poder decir
  // cuántas filas traía en vez de un "demasiado grande" a ciegas.
  const totalFilas = resultado.filas.length + resultado.totalOmitir;
  if (totalFilas > MAX_FILAS_ARCHIVO) {
    return NextResponse.json(
      {
        error: `El archivo trae ${totalFilas} filas y el máximo por lote es ${MAX_FILAS_ARCHIVO}. Divídalo, por ejemplo por sucursal.`,
      },
      { status: 413 }
    );
  }

  const totalErrores = resultado.incidencias.filter((i) => i.severidad === "ERROR").length;
  const totalCrear = resultado.filas.filter((f) => f.accion === "CREAR").length;
  const totalActualizar = resultado.filas.length - totalCrear;

  // Con errores el lote se guarda igualmente, marcado como RECHAZADO: deja
  // constancia del intento y permite volver sobre el informe.
  const lote = await crearLote(prisma, {
    tipo: "EMPLEADOS",
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
    // Sin nada aplicable no se ofrece identificador: no hay nada que confirmar.
    loteId: totalErrores === 0 && resultado.filas.length > 0 ? lote.id : null,
    tipo: "EMPLEADOS",
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
