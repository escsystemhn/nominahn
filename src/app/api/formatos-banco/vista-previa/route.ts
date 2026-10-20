/** Las primeras líneas que saldrían con un formato en edición, con datos de ejemplo. */

import { NextRequest, NextResponse } from "next/server";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody } from "@/lib/http/validar";
import { generarArchivoBanco } from "@/lib/payroll/archivo-banco";
import { schemaFormatoBanco, aFormato } from "@/lib/payroll/archivo-banco-bd";

const EJEMPLO = [
  { cuenta: "1234567890", identidad: "0501-1990-01234", nombre: "María José Núñez", codigo: "E-001", banco: "Banco de ejemplo", monto: 12500.5 },
  { cuenta: "0099887766", identidad: "0801-1985-00001", nombre: "Carlos Andrés López", codigo: "E-002", banco: "Banco de ejemplo", monto: 8000 },
];

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schemaFormatoBanco);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  // El filtro de banco no se aplica en la vista previa: los datos son de ejemplo.
  const r = generarArchivoBanco(aFormato({ ...d, columnas: d.columnas as unknown as never, filtroBanco: null }), EJEMPLO, {
    fechaPago: new Date(),
    referencia: "NOM-QUINCENAL-EJEMPLO",
    concepto: "Planilla quincenal",
  });
  return NextResponse.json({ contenido: r.contenido, errores: r.errores, avisos: r.avisos, total: r.total });
}
