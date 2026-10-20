/**
 * Cambiar el jefe directo de un empleado desde el organigrama.
 *
 * PERMISO PROPIO Y NO `empleados.editar`. Reorganizar equipos y editar el
 * expediente son actos distintos: mover a alguien de jefe no debería exigir
 * acceso a su salario, su identidad ni su cuenta bancaria. Con `empleados.editar`
 * sí se puede hacer también desde la ficha; aquí basta `organizacion.reasignar`.
 *
 * NO ES COSMÉTICO: la línea de reporte decide quién aprueba los permisos del
 * empleado y quién lo evalúa como `JEFE_DIRECTO`. Por eso queda en auditoría con
 * el antes y el después.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zId } from "@/lib/http/validar";
import { z } from "zod";
import { creariaCiclo } from "@/lib/organizacion/jerarquia";

const schema = z.object({
  empleadoId: zId,
  /** `null` deja al empleado sin jefe: pasa a ser raíz del organigrama. */
  supervisorId: zId.nullable(),
});

const IDENTIDAD = {
  id: true,
  codigo: true,
  primerNombre: true,
  primerApellido: true,
  sucursalId: true,
  departamentoId: true,
  supervisorId: true,
} as const;

export async function PATCH(req: NextRequest) {
  const g = await requerirPermiso("organizacion.reasignar");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { empleadoId, supervisorId } = parsed.data;

  const empleado = await prisma.empleado.findUnique({
    where: { id: empleadoId },
    select: IDENTIDAD,
  });
  // 404 y no 403: confirmar que existe ya diría más de lo que el alcance permite.
  if (!empleado || !alcanzaEmpleado(g.usuario, empleado)) {
    return NextResponse.json({ error: "El empleado no existe." }, { status: 404 });
  }

  if (supervisorId === empleadoId) {
    return NextResponse.json(
      { error: "Un empleado no puede ser su propio jefe." },
      { status: 400 }
    );
  }

  let supervisor: { codigo: string; primerNombre: string; primerApellido: string } | null = null;
  if (supervisorId) {
    const encontrado = await prisma.empleado.findUnique({
      where: { id: supervisorId },
      select: { ...IDENTIDAD, estado: true },
    });
    if (!encontrado) {
      return NextResponse.json({ error: "El jefe indicado no existe." }, { status: 400 });
    }
    if (encontrado.estado === "INACTIVO") {
      return NextResponse.json(
        { error: "No se puede asignar como jefe a un empleado inactivo." },
        { status: 409 }
      );
    }
    /**
     * El jefe también tiene que estar dentro del alcance. Sin esto, alguien con
     * alcance de una sucursal podría colgar a su gente de un jefe de otra y sacar
     * a esos empleados de su propia vista —o meterlos en la ajena—.
     */
    if (!alcanzaEmpleado(g.usuario, encontrado)) {
      return NextResponse.json(
        { error: "El jefe indicado está fuera de su alcance de datos." },
        { status: 403 }
      );
    }
    supervisor = encontrado;

    // ─── Ciclos ─────────────────────────────────────────────────────────────
    const plantilla = await prisma.empleado.findMany({
      select: { id: true, supervisorId: true },
    });
    const padreDe = new Map(plantilla.map((e) => [e.id, e.supervisorId]));

    if (creariaCiclo(padreDe, empleadoId, supervisorId)) {
      return NextResponse.json(
        {
          error: `${encontrado.codigo} (${encontrado.primerNombre} ${encontrado.primerApellido}) ya depende de este empleado, directa o indirectamente. Asignarlo como jefe cerraría un ciclo.`,
          codigo: "CICLO_JERARQUIA",
        },
        { status: 409 }
      );
    }
  }

  if (empleado.supervisorId === supervisorId) {
    return NextResponse.json({ ok: true, sinCambios: true });
  }

  const anterior = empleado.supervisorId
    ? await prisma.empleado.findUnique({
        where: { id: empleado.supervisorId },
        select: { codigo: true, primerNombre: true, primerApellido: true },
      })
    : null;

  await prisma.empleado.update({ where: { id: empleadoId }, data: { supervisorId } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "Empleado",
    registroId: empleadoId,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { supervisorId: empleado.supervisorId, supervisor: anterior?.codigo ?? null },
    valorNuevo: {
      accion: "REASIGNAR_JEFE",
      supervisorId,
      supervisor: supervisor?.codigo ?? null,
      empleado: empleado.codigo,
    },
    ip,
    userAgent,
  });

  return NextResponse.json({
    ok: true,
    empleado: empleado.codigo,
    supervisor: supervisor ? `${supervisor.codigo} · ${supervisor.primerNombre} ${supervisor.primerApellido}` : null,
  });
}
