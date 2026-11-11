/**
 * Catálogo de tipos de deducción en archivo: el de hoy (para corregirlo y volver a
 * importarlo) o la plantilla vacía. La categoría y «Activo» van con lista
 * desplegable en Excel. Los de ley y la retención fija de ISR no salen: no se
 * cambian por aquí.
 *   GET ?formato=xlsx | ?delimitador=;      el catálogo
 *   GET ?plantilla=1[&formato=xlsx]         la plantilla
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { generarCsv, cabecerasDescarga, delimitadorPedido } from "@/lib/importacion/csv";
import { cabecerasXlsx, plantillaXlsx } from "@/lib/importacion/xlsx";
import { COLUMNAS_TIPO_DEDUCCION, etiquetas, filaEjemplo } from "@/lib/importacion/columnas";
import { LISTAS_TIPO_DEDUCCION } from "@/lib/importacion/tipos-deduccion";
import { etiquetaCategoria } from "@/lib/deducciones/tipos";
import { esTipoDelSistema } from "@/lib/deducciones/tipos-bd";

const NOTAS = [
  "Una fila por tipo de deducción. El código es la clave: si existe se actualiza, si no se crea.",
  "La categoría decide hasta cuánto se cobra (Código del Trabajo, Arts. 371 a 373): elíjala de la lista.",
  "Los tipos de ley (IHSS, RAP, INFOP) y la retención fija de ISR no van aquí: se configuran en Parámetros de ley.",
  "Después, los montos por empleado se cargan en Deducciones → Importar → Montos del período, donde cada tipo es una columna.",
];

export async function GET(req: NextRequest) {
  const g = await requerirPermiso(["deducciones.exportar", "deducciones.configurar"]);
  if (!g.ok) return g.response;
  const { searchParams } = new URL(req.url);
  const excel = searchParams.get("formato") === "xlsx";
  const delimitador = delimitadorPedido(searchParams.get("delimitador"));
  const columnas = [...COLUMNAS_TIPO_DEDUCCION];

  let filas: string[][] = [];
  let archivo = "plantilla_tipos_deduccion";
  if (searchParams.get("plantilla") !== "1") {
    const tipos = await prisma.tipoDeduccionConfig.findMany({ orderBy: { nombre: "asc" } });
    filas = tipos.filter((t) => !esTipoDelSistema(t)).map((t) => [
      t.codigo, t.nombre, etiquetaCategoria(t.tipo), t.montoFijo?.toFixed(2) ?? "", t.descripcion ?? "", t.activo ? "Sí" : "No",
    ]);
    archivo = `tipos_deduccion_${new Date().toISOString().slice(0, 10)}`;
  }

  if (excel) {
    const xlsx = await plantillaXlsx(columnas, filas, { notas: NOTAS, listas: LISTAS_TIPO_DEDUCCION });
    return new NextResponse(new Uint8Array(xlsx), { headers: cabecerasXlsx(`${archivo}.xlsx`) });
  }
  const cuerpo = filas.length || searchParams.get("plantilla") !== "1" ? filas : [filaEjemplo(columnas)];
  return new NextResponse(generarCsv(etiquetas(columnas), cuerpo, delimitador), { headers: cabecerasDescarga(`${archivo}.csv`) });
}
