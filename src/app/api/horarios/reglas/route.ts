/**
 * Reglas del planificador de horarios.
 *   GET → reglas vigentes (con puestos para elegir los de dirección o confianza)
 *   PUT → { descansoEntreJornadasH, vispera, rotacion, permitirExtra, puestosExentos }
 */

import { NextRequest, NextResponse } from "next/server";
import { alcanceEsTotal, filtroSucursales } from "@/lib/auth/alcance";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";
import { leerReglas, guardarReglas } from "@/lib/horarios/bd";
import { etiquetaPuesto } from "@/lib/organizacion/estructura";

const schema = z.object({
  descansoEntreJornadasH: z.coerce.number().min(10, "El mínimo legal es de 10 horas (Art. 327)").max(24),
  vispera: z.enum(["EXIGIR", "ADVERTIR", "NO_APLICAR"]),
  rotacion: z.enum(["SEMANAL", "EQUITATIVA", "FIJA"]),
  permitirExtra: z.boolean(),
  puestosExentos: z.array(z.string().trim().min(1)).max(200),
});

export async function GET() {
  const g = await requerirPermiso(["asistencia.turnos", "asistencia.ver"]);
  if (!g.ok) return g.response;
  const [reglas, puestos] = await Promise.all([
    leerReglas(prisma),
    prisma.puesto.findMany({ where: { activo: true, departamento: { sucursal: filtroSucursales(g.usuario) } }, select: { id: true, nombre: true, departamento: { select: { nombre: true, sucursal: { select: { nombre: true } } } } }, orderBy: { nombre: "asc" } }),
  ]);
  return NextResponse.json({ reglas, puestos: puestos.map((p) => ({ id: p.id, nombre: etiquetaPuesto(p) })) });
}

export async function PUT(req: NextRequest) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  if (!alcanceEsTotal(g.usuario)) {
    return NextResponse.json({ error: "Estas reglas valen para toda la empresa: sólo las cambia una cuenta con alcance total." }, { status: 403 });
  }
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const anterior = await leerReglas(prisma);
  await guardarReglas(prisma, parsed.data);
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "ConfiguracionSistema", registroId: "HORARIOS_REGLAS", usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined, valorAnterior: anterior, valorNuevo: parsed.data, ip, userAgent,
  });
  return NextResponse.json({ ok: true, reglas: await leerReglas(prisma) });
}
