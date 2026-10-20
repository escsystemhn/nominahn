import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { audit, getClientInfo } from "@/lib/audit";
import { z } from "zod";
import { parsearBody, zId, zMontoPositivo, zEnteroNoNeg, zFecha } from "@/lib/http/validar";

const schema = z.object({
  tipoDeduccionId: zId,
  monto: zMontoPositivo, // antes: parseFloat(undefined) → NaN escrito como monto Y saldo
  cuotasMeses: zEnteroNoNeg.optional(),
  fechaInicio: zFecha,
  observacion: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("deducciones.asignar");
  if (!g.ok) return g.response;

  const { id } = await params;

  // El empleado debe existir: sin esto, un id inválido crea una deducción huérfana.
  const empleado = await prisma.empleado.findUnique({ where: { id }, select: { id: true } });
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { tipoDeduccionId, monto, cuotasMeses, fechaInicio, observacion } = parsed.data;

  const deduccion = await prisma.deduccionEmpleado.create({
    data: {
      empleadoId: id,
      tipoDeduccionId,
      monto,
      saldo: monto,
      cuotasMeses: cuotasMeses ?? null,
      fechaInicio,
      observacion,
    },
  });

  // Una deducción manual descuenta del salario de un trabajador (Art. 371 C.T.:
  // toda deducción requiere causa vigente). Debe quedar quién la impuso.
  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE",
    tabla: "DeduccionEmpleado",
    registroId: deduccion.id,
    usuarioId: g.usuario.id,
    usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { empleadoId: id, tipoDeduccionId, monto, cuotasMeses, fechaInicio, observacion },
    ip,
    userAgent,
  });

  return NextResponse.json(deduccion, { status: 201 });
}
