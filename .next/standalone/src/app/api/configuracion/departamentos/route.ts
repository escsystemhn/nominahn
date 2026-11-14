import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId, zIdOpcional } from "@/lib/http/validar";
import { divisionesHabilitadas, validarDivisionDeDepartamento } from "@/lib/organizacion/estructura-bd";
import { claveLugar, lugaresSinDepartamento, type LugarDepartamento } from "@/lib/organizacion/destinos-departamento";

/** Tope de destinos en una sola creación: holgado para cualquier estructura real. */
const MAX_DESTINOS = 300;

const schema = z.object({
  nombre: z.string().trim().min(1).max(150),
  codigo: z.string().trim().max(50).optional(),
  /**
   * Dónde crearlo: un departamento por destino, aunque sean de grupos distintos.
   * Son filas aparte a propósito: la empresa (división) de una persona sale de su
   * departamento, y de ahí dependen la planilla y lo que se imprime por empresa.
   */
  destinos: z.array(z.object({ sucursalId: zId, divisionId: zIdOpcional })).min(1).max(MAX_DESTINOS).optional(),
  /** Sólo para la auditoría: lo que la persona eligió en pantalla. */
  alcance: z.enum(["una", "todas", "elegir"]).optional(),
  // Forma anterior, que se sigue aceptando: una sucursal y una o varias de sus divisiones.
  sucursalId: zId.optional(),
  divisionId: zIdOpcional,
  divisionIds: z.array(zId).min(1).max(100).optional(),
}).refine((d) => d.destinos || d.sucursalId, { message: "Indique dónde crear el departamento.", path: ["destinos"] });

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;

  const pedidos: LugarDepartamento[] = d.destinos
    ?? (d.divisionIds
      ? d.divisionIds.map((divisionId) => ({ sucursalId: d.sucursalId!, divisionId }))
      : [{ sucursalId: d.sucursalId!, divisionId: d.divisionId }]);
  const unicos = [...new Map(pedidos.map((l) => [claveLugar(l), l])).values()];

  // Todo o nada: un destino ajeno, inactivo o inexistente detiene el lote antes de crear algo.
  const sucursalIds = [...new Set(unicos.map((l) => l.sucursalId))];
  const sucursales = await prisma.sucursal.findMany({ where: { id: { in: sucursalIds } }, select: { id: true, nombre: true, activa: true } });
  for (const id of sucursalIds) {
    const s = sucursales.find((x) => x.id === id);
    if (!s) return NextResponse.json({ error: "La sucursal no existe." }, { status: 400 });
    if (!s.activa) return NextResponse.json({ error: `La sucursal ${s.nombre} está inactiva.` }, { status: 400 });
  }
  const conDivisiones = await divisionesHabilitadas(prisma);
  for (const lugar of unicos) {
    const error = await validarDivisionDeDepartamento(prisma, lugar, conDivisiones);
    if (error) {
      const nombre = sucursales.find((s) => s.id === lugar.sucursalId)?.nombre;
      return NextResponse.json({ error: unicos.length > 1 && nombre ? `${nombre}: ${error}` : error }, { status: 400 });
    }
  }

  const existentes = await prisma.departamento.findMany({ where: { sucursalId: { in: sucursalIds } }, select: { nombre: true, sucursalId: true, divisionId: true } });
  const { crear, omitir } = lugaresSinDepartamento(d.nombre, unicos, existentes);
  if (crear.length === 0) {
    const error = unicos.length > 1 ? `«${d.nombre}» ya existe en todo lo que eligió.` : `«${d.nombre}» ya existe ahí.`;
    return NextResponse.json({ error, omitidos: omitir }, { status: 409 });
  }

  const creados = await prisma.$transaction(
    crear.map((l) => prisma.departamento.create({ data: { nombre: d.nombre, codigo: d.codigo || null, sucursalId: l.sucursalId, divisionId: l.divisionId } }))
  );
  const { ip, userAgent } = getClientInfo(req);
  for (const dept of creados) {
    await audit({
      accion: "CREATE", tabla: "Departamento", registroId: dept.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorNuevo: {
        nombre: dept.nombre, sucursalId: dept.sucursalId, divisionId: dept.divisionId,
        ...(creados.length > 1 || omitir.length ? { enLote: creados.length, omitidos: omitir.length } : {}),
        ...(d.alcance ? { alcance: d.alcance } : {}),
      },
      ip, userAgent,
    });
  }

  // La forma anterior de un solo departamento devolvía el registro creado.
  if (!d.destinos && !d.divisionIds) return NextResponse.json(creados[0], { status: 201 });
  return NextResponse.json({
    creados: creados.map((c) => ({ id: c.id, sucursalId: c.sucursalId, divisionId: c.divisionId })),
    omitidos: omitir,
    // Compatibilidad con quien leía la respuesta anterior.
    omitidas: omitir.map((l) => l.divisionId).filter(Boolean),
  }, { status: 201 });
}
