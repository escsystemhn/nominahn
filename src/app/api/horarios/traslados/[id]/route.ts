import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/horarios/traslados/[id] — anular un traslado. Se marca anulado (no se borra:
 * la asistencia de esos días pudo leerlo). Sus días en planes EN BORRADOR de la sucursal de
 * destino se quitan; los de un plan publicado quedan (no se edita) hasta volverlo a borrador.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("asistencia.turnos");
  if (!g.ok) return g.response;
  const { id } = await params;

  const t = await prisma.trasladoTemporal.findUnique({
    where: { id },
    include: { empleado: { select: { id: true, sucursalId: true, departamentoId: true } } },
  });
  if (!t || t.anulado || !alcanzaEmpleado(g.usuario, t.empleado)) return NextResponse.json({ error: "Traslado no encontrado" }, { status: 404 });

  // Turnos ya asignados en planes en borrador de esa sucursal: se quitan con el traslado.
  const quitados = await prisma.horarioDia.deleteMany({
    where: { empleadoId: t.empleadoId, sucursalId: t.sucursalDestinoId, fecha: { gte: t.desde, lte: t.hasta }, plan: { estado: "BORRADOR" } },
  });
  await prisma.trasladoTemporal.update({ where: { id }, data: { anulado: true } });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "DELETE",
    tabla: "TrasladoTemporal",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { empleadoId: t.empleadoId, a: t.sucursalDestinoId, desde: t.desde, hasta: t.hasta },
    valorNuevo: { anulado: true, diasQuitadosDeBorradores: quitados.count },
    ip,
    userAgent,
  });
  return NextResponse.json({ ok: true, diasQuitados: quitados.count });
}
