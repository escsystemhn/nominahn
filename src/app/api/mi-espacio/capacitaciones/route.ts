/**
 * GET /api/mi-espacio/capacitaciones — las capacitaciones en que está inscrita la persona,
 * con su resultado y su material (sin el archivo: se abre en el visor).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/auth/guard";

export async function GET() {
  const g = await requerirSesion();
  if (!g.ok) return g.response;
  const empleadoId = g.usuario.empleadoId;
  if (!empleadoId) return NextResponse.json([]);

  const filas = await prisma.participanteCapacitacion.findMany({
    where: { empleadoId, capacitacion: { estado: { not: "CANCELADA" } } },
    select: {
      asistio: true,
      aprobado: true,
      calificacion: true,
      capacitacion: {
        select: {
          id: true, nombre: true, descripcion: true, tipo: true, proveedor: true, fechaInicio: true, fechaFin: true, estado: true,
          materiales: {
            select: { id: true, titulo: true, descripcion: true, tipo: true, mime: true, tamano: true, vistas: { where: { empleadoId }, select: { ultimaVez: true } } },
            orderBy: [{ orden: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: { capacitacion: { fechaInicio: "desc" } },
  });

  return NextResponse.json(
    filas.map((f) => ({
      ...f.capacitacion,
      asistio: f.asistio,
      aprobado: f.aprobado,
      calificacion: f.calificacion === null ? null : Number(f.calificacion),
      materiales: f.capacitacion.materiales.map(({ vistas, ...m }) => ({ ...m, visto: vistas[0]?.ultimaVez ?? null })),
    }))
  );
}
