/**
 * Edición y baja de una división.
 *
 * Una división (la «sucursal» de la jerarquía de nómina) cambia de sucursal (su «grupo») sólo
 * si no tiene movimientos: ni planillas ni líneas de planilla ya calculadas o cerradas, que
 * cuelgan de la sucursal en que se emitieron (pedido de Edbin, 2026-11-16). Los borradores
 * no cuentan: los que la incluyen se descartan (2026-11-16). Se mueve con sus departamentos
 * y los empleados de ellos, en una sola transacción. Una división en uso no se borra (dejaría
 * planillas pagadas apuntando a nada): se DESACTIVA, lo que la retira de los desplegables
 * sin tocar el histórico.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { motivoParaNoMoverDivision } from "@/lib/organizacion/eliminar";
import { zRtnEmpresaOpcional } from "@/lib/organizacion/estructura-bd";
import { borradoresDeDivision, lineasConMovimiento, planillasConMovimiento } from "@/lib/organizacion/movimientos-division";

const schema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  codigo: z.string().trim().max(50).nullable().optional(),
  descripcion: z.string().trim().max(300).nullable().optional(),
  rtn: zRtnEmpresaOpcional,
  activa: z.boolean().optional(),
  /** Otro grupo (sucursal) de la misma empresa principal; sólo sin planillas. */
  sucursalId: zId.optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const c = parsed.data;

  const actual = await prisma.division.findUnique({
    where: { id },
    select: { nombre: true, codigo: true, descripcion: true, rtn: true, activa: true, sucursalId: true, sucursal: { select: { empresaId: true } } },
  });
  if (!actual) return NextResponse.json({ error: "La división no existe." }, { status: 404 });
  const { sucursal: sucursalActual, ...antes } = actual;

  // ¿Cambia de grupo? Sólo sin movimientos, y a otro grupo activo de la misma empresa principal.
  const nuevaSucursal = c.sucursalId !== undefined && c.sucursalId !== actual.sucursalId ? c.sucursalId : null;
  if (nuevaSucursal) {
    const destino = await prisma.sucursal.findUnique({ where: { id: nuevaSucursal }, select: { activa: true, empresaId: true } });
    if (!destino || destino.empresaId !== sucursalActual.empresaId) return NextResponse.json({ error: "El grupo elegido no existe." }, { status: 404 });
    if (!destino.activa) return NextResponse.json({ error: "El grupo elegido está inactivo." }, { status: 409 });
    const [planillas, lineasPlanilla, coberturasPuestos] = await Promise.all([
      prisma.planilla.count({ where: planillasConMovimiento(id) }),
      prisma.planillaDetalle.count({ where: lineasConMovimiento(id) }),
      prisma.coberturaSucursal.count({ where: { sucursalId: actual.sucursalId, puesto: { departamento: { divisionId: id } } } }),
    ]);
    const motivo = motivoParaNoMoverDivision({ planillas, lineasPlanilla, coberturasPuestos });
    if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
    const conSap = await prisma.planilla.count({ where: { AND: [borradoresDeDivision(id), { enviosSap: { some: {} } }] } });
    if (conSap) {
      return NextResponse.json({ error: "No se puede cambiar de grupo: un borrador que la incluye tiene envíos a SAP. Anúlelo primero." }, { status: 409 });
    }
  }

  try {
    const { division, movidos } = await prisma.$transaction(async (tx) => {
      // Los borradores que la incluyen se descartan antes de moverla, igual que «Descartar borrador».
      const borradores = nuevaSucursal
        ? await tx.planilla.findMany({ where: borradoresDeDivision(id), select: { id: true, tipo: true, fechaInicio: true, fechaFin: true } })
        : [];
      if (borradores.length) {
        const ids = borradores.map((b) => b.id);
        await tx.planillaDetalle.deleteMany({ where: { planillaId: { in: ids } } });
        await tx.planilla.deleteMany({ where: { id: { in: ids }, estado: "BORRADOR" } });
      }
      const division = await tx.division.update({
        where: { id },
        data: {
          ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
          ...(c.codigo !== undefined ? { codigo: c.codigo || null } : {}),
          ...(c.descripcion !== undefined ? { descripcion: c.descripcion || null } : {}),
          ...(c.rtn !== undefined ? { rtn: c.rtn || null } : {}),
          ...(c.activa !== undefined ? { activa: c.activa } : {}),
          ...(nuevaSucursal ? { sucursalId: nuevaSucursal } : {}),
        },
      });
      if (!nuevaSucursal) return { division, movidos: null };
      // Sus departamentos y la gente de ellos se van con ella; la puesta en planilla no
      // cambia nada del pasado porque no hay planillas.
      const departamentos = await tx.departamento.updateMany({ where: { divisionId: id }, data: { sucursalId: nuevaSucursal } });
      const empleados = await tx.empleado.updateMany({ where: { departamento: { divisionId: id } }, data: { sucursalId: nuevaSucursal } });
      // Por si alguien calculó una planilla mientras tanto: se deshace todo.
      const [planillas, lineas] = await Promise.all([
        tx.planilla.count({ where: { divisionId: id } }),
        tx.planillaDetalle.count({ where: { divisionId: id } }),
      ]);
      if (planillas + lineas) throw new Error("CON_PLANILLAS");
      return {
        division,
        movidos: {
          departamentos: departamentos.count, empleados: empleados.count, borradoresDescartados: borradores.length,
          ...(borradores.length ? { borradores: borradores.map((b) => ({ id: b.id, tipo: b.tipo, fechaInicio: b.fechaInicio, fechaFin: b.fechaFin })) } : {}),
        },
      };
    });
    const { ip, userAgent } = getClientInfo(req);
    await audit({
      accion: "UPDATE", tabla: "Division", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
      valorAnterior: antes,
      valorNuevo: {
        nombre: division.nombre, codigo: division.codigo, descripcion: division.descripcion, rtn: division.rtn, activa: division.activa,
        sucursalId: division.sucursalId, ...(movidos ? { seMovieron: movidos } : {}),
      },
      ip, userAgent,
    });
    return NextResponse.json({ ...division, movidos });
  } catch (e) {
    if (e instanceof Error && e.message === "CON_PLANILLAS") {
      return NextResponse.json({ error: "No se puede cambiar de grupo: acaba de generarse una planilla que la incluye." }, { status: 409 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: `Ya existe una división llamada «${c.nombre ?? antes.nombre}» en ${nuevaSucursal ? "el grupo elegido" : "esa sucursal"}.` }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("configuracion.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const division = await prisma.division.findUnique({
    where: { id },
    include: { _count: { select: { departamentos: true, planillas: true, detallesPlanilla: true } } },
  });
  if (!division) return NextResponse.json({ error: "La división no existe." }, { status: 404 });

  const { departamentos, planillas, detallesPlanilla } = division._count;
  if (departamentos + planillas + detallesPlanilla > 0) {
    const motivo = departamentos > 0 ? `tiene ${departamentos} departamento(s)` : "aparece en planillas emitidas";
    return NextResponse.json({ error: `No se puede eliminar: ${motivo}. Desactívela para retirarla de las listas.` }, { status: 409 });
  }

  await prisma.division.delete({ where: { id } });
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE", tabla: "Division", registroId: id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { nombre: division.nombre, sucursalId: division.sucursalId }, ip, userAgent,
  });
  return NextResponse.json({ ok: true });
}
