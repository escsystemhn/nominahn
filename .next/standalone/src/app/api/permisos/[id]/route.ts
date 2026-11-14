import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanceEsTotal } from "@/lib/auth/alcance";
import { calcularVacacionesDevengadas } from "@/lib/payroll/calculos-hn";
import { z } from "zod";
import { parsearBody, zEnteroNoNeg } from "@/lib/http/validar";

const schema = z.object({
  estado: z.enum(["APROBADO", "RECHAZADO"]),
  // Antes: Number(diasAprobados) sin control → NaN al saldo de vacaciones.
  diasAprobados: zEnteroNoNeg.optional(),
  observacion: z.string().trim().max(500).optional(),
});

// PATCH: aprobar o rechazar una solicitud. Al aprobar VACACIONES se ajusta el
// saldo de vacaciones del empleado.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("asistencia.aprobar_permisos");
  if (!g.ok) return g.response;

  const role = g.usuario.role as string;
  const aprobadorEmpleadoId = g.usuario.empleadoId ?? null;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { estado, diasAprobados, observacion } = parsed.data;

  const permiso = await prisma.permiso.findUnique({ where: { id }, include: { empleado: true } });
  if (!permiso) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (permiso.estado !== "PENDIENTE") {
    return NextResponse.json({ error: "La solicitud ya fue resuelta" }, { status: 409 });
  }

  /**
   * Quien no alcanza a toda la empresa sólo resuelve solicitudes de su equipo
   * directo. Se mantiene además el criterio por rol para las cuentas sin perfil,
   * que tienen alcance TODO por omisión: sin él, un gerente heredado pasaría a
   * poder aprobar permisos de cualquiera.
   */
  const soloEquipo = !alcanceEsTotal(g.usuario) || role === "GERENTE" || role === "SUPERVISOR";
  if (soloEquipo && permiso.empleado.supervisorId !== aprobadorEmpleadoId) {
    return NextResponse.json({ error: "Sólo puede aprobar solicitudes de su equipo" }, { status: 403 });
  }

  const dias = estado === "APROBADO" ? (diasAprobados ?? permiso.diasSolicitados) : 0;

  const actualizado = await prisma.$transaction(async (tx) => {
    const p = await tx.permiso.update({
      where: { id },
      data: {
        estado,
        diasAprobados: estado === "APROBADO" ? dias : null,
        aprobadoPor: g.usuario.id ?? null,
        observacion: observacion || null,
      },
    });

    if (estado === "APROBADO" && permiso.tipo === "VACACIONES" && dias > 0) {
      const anio = new Date().getFullYear();
      const saldo = await tx.saldoVacaciones.findUnique({ where: { empleadoId: permiso.empleadoId } });
      const tomados = (saldo ? Number(saldo.diasTomados) : 0) + dias;
      // Disponibles derivados del devengo (Art. 346) menos lo tomado.
      const devengado = calcularVacacionesDevengadas(permiso.empleado.fechaIngreso);
      const disponibles = Math.round((devengado - tomados) * 100) / 100;

      await tx.saldoVacaciones.upsert({
        where: { empleadoId: permiso.empleadoId },
        update: { diasTomados: tomados, diasDisponibles: disponibles, anio },
        create: { empleadoId: permiso.empleadoId, diasTomados: tomados, diasDisponibles: disponibles, anio },
      });
    }

    return p;
  });

  return NextResponse.json(actualizado);
}
