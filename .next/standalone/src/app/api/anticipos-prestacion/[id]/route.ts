import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody } from "@/lib/http/validar";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  estado: z.literal("ANULADO"),
  motivo: z.string().trim().min(3, "Indique el motivo").max(500),
});

/**
 * PATCH /api/anticipos-prestacion/[id] — anular un anticipo registrado por error.
 * Sólo uno VIGENTE: uno ya rebajado se libera anulando la liquidación o el décimo que
 * lo tomó, y después se anula.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await requerirPermiso("prestaciones.generar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const actual = await prisma.anticipoPrestacion.findUnique({
    where: { id },
    include: { empleado: { select: { id: true, sucursalId: true, departamentoId: true } } },
  });
  if (!actual || !alcanzaEmpleado(g.usuario, actual.empleado)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (actual.estado !== "VIGENTE") {
    return NextResponse.json(
      { error: actual.estado === "APLICADO" ? "Ya se rebajó de una liquidación o de un décimo: anule ese documento primero." : "Ya está anulado." },
      { status: 409 }
    );
  }

  const r = await prisma.anticipoPrestacion.update({
    where: { id },
    data: { estado: "ANULADO", motivoAnulacion: parsed.data.motivo },
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE",
    tabla: "AnticipoPrestacion",
    registroId: id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorAnterior: { estado: actual.estado },
    valorNuevo: { estado: "ANULADO", motivo: parsed.data.motivo },
    ip,
    userAgent,
  });
  return NextResponse.json({ id: r.id, estado: r.estado });
}
