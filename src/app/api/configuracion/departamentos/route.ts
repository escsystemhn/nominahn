import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId, zIdOpcional } from "@/lib/http/validar";
import { divisionesHabilitadas, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";
import { divisionesSinDepartamento } from "@/lib/organizacion/puestos";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  codigo: z.string().trim().max(50).optional(),
  sucursalId: zId,
  /** Sólo con las divisiones habilitadas; obligatoria si la sucursal ya tiene divisiones. */
  divisionId: zIdOpcional,
  /**
   * Varias divisiones de una vez: se crea un departamento en cada una. Son filas
   * aparte a propósito: la división (la empresa) de una persona sale de su
   * departamento, y de ahí dependen la planilla y lo que se imprime por empresa.
   */
  divisionIds: z.array(zId).min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const sucursal = await prisma.sucursal.findUnique({ where: { id: d.sucursalId }, select: { nombre: true, activa: true } });
  if (!sucursal) return NextResponse.json({ error: "La sucursal no existe." }, { status: 400 });
  if (!sucursal.activa) return NextResponse.json({ error: `La sucursal ${sucursal.nombre} está inactiva.` }, { status: 400 });

  const conDivisiones = await divisionesHabilitadas(prisma);
  const { ip, userAgent } = getClientInfo(req);

  if (d.divisionIds) {
    // Todas o ninguna: una división ajena o inactiva detiene el lote antes de crear nada.
    for (const divisionId of new Set(d.divisionIds)) {
      const error = await validarDivisionDeDepartamento(prisma, { sucursalId: d.sucursalId, divisionId }, conDivisiones);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    const existentes = await prisma.departamento.findMany({ where: { sucursalId: d.sucursalId }, select: { nombre: true, divisionId: true } });
    const { crear, omitir } = divisionesSinDepartamento(d.nombre, d.divisionIds, existentes);
    if (crear.length === 0) return NextResponse.json({ error: `«${d.nombre}» ya existe en todo lo que eligió.` }, { status: 409 });

    const creados = await prisma.$transaction(
      crear.map((divisionId) => prisma.departamento.create({ data: { nombre: d.nombre, codigo: d.codigo || null, sucursalId: d.sucursalId, divisionId } }))
    );
    for (const dept of creados) {
      await audit({
        accion: "CREATE", tabla: "Departamento", registroId: dept.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
        valorNuevo: { nombre: dept.nombre, sucursalId: dept.sucursalId, divisionId: dept.divisionId, enLote: creados.length }, ip, userAgent,
      });
    }
    return NextResponse.json({ creados: creados.map((c) => c.id), omitidas: omitir }, { status: 201 });
  }

  const error = await validarDivisionDeDepartamento(prisma, d, conDivisiones);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const dept = await prisma.departamento.create({
    data: { nombre: d.nombre, codigo: d.codigo || null, sucursalId: d.sucursalId, divisionId: d.divisionId },
  });
  await audit({
    accion: "CREATE", tabla: "Departamento", registroId: dept.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { nombre: dept.nombre, sucursalId: dept.sucursalId, divisionId: dept.divisionId }, ip, userAgent,
  });
  return NextResponse.json(dept, { status: 201 });
}
