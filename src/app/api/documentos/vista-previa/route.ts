/**
 * Texto resuelto de una plantilla para un empleado, sin emitir nada. Sirve a la
 * pantalla de emisión y al editor de plantillas (que manda el texto en edición).
 */

import { NextRequest, NextResponse } from "next/server";
import { empleadoAlAlcance } from "@/lib/auth/alcance-bd";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { parsearBody, zId } from "@/lib/http/validar";
import { previsualizar, ErrorDocumento } from "@/lib/documentos/emision";

const schema = z.object({
  empleadoId: zId,
  plantillaId: zId.optional(),
  contenido: z.string().max(20000).optional(),
  titulo: z.string().max(150).optional(),
  destinatario: z.string().trim().max(200).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso(["documentos.emitir", "documentos.plantillas"]);
  if (!g.ok) return g.response;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  // El texto resuelto lleva salario, identidad y cuenta: fuera de su alcance, como si no existiera.
  if (!(await empleadoAlAlcance(g.usuario, parsed.data.empleadoId))) {
    return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  }
  try {
    return NextResponse.json(await previsualizar(prisma, parsed.data));
  } catch (e) {
    if (e instanceof ErrorDocumento) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
