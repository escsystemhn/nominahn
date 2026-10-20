import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { z } from "zod";
import { parsearBody, zPorcentaje, zMontoPositivo, zId } from "@/lib/http/validar";
import { money, redondear } from "@/lib/payroll/money";
import { audit, getClientInfo } from "@/lib/audit";

// El aumento afecta el salario de MUCHOS empleados a la vez: un valor basura aquí
// corrompía a los 200 de golpe (`parseFloat(undefined)` → NaN escrito como salario).
const schema = z
  .object({
    tipo: z.enum(["PORCENTAJE", "MONTO_FIJO"]),
    porcentaje: zPorcentaje.optional(),
    montoFijo: zMontoPositivo.optional(),
    sucursalId: zId.optional(),
    departamentoId: zId.optional(),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine((d) => (d.tipo === "PORCENTAJE" ? d.porcentaje !== undefined : d.montoFijo !== undefined), {
    error: "Falta el valor del aumento para el tipo elegido",
    path: ["valor"],
  });

export async function POST(req: NextRequest) {
  const g = await requerirPermiso("prestaciones.salarios");
  if (!g.ok) return g.response;

  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { tipo, porcentaje, montoFijo, sucursalId, departamentoId, motivo } = parsed.data;

  const empleados = await prisma.empleado.findMany({
    where: {
      estado: "ACTIVO",
      ...(sucursalId ? { sucursalId } : {}),
      ...(departamentoId ? { departamentoId } : {}),
    },
    select: { id: true, salarioBase: true },
  });

  if (empleados.length === 0) {
    return NextResponse.json({ error: "No hay empleados activos en el ámbito elegido" }, { status: 400 });
  }

  // Cálculo en Decimal exacto (es un salario que se escribe en BD).
  const factor = tipo === "PORCENTAJE" ? money(porcentaje!).div(100) : null;

  const updates = empleados.flatMap((emp) => {
    const actual = money(emp.salarioBase);
    const nuevo = factor ? redondear(actual.plus(actual.times(factor))) : redondear(actual.plus(money(montoFijo!)));
    return [
      prisma.empleado.update({
        where: { id: emp.id },
        data: {
          salarioBase: nuevo,
          salarioDiario: redondear(nuevo.div(30)),
          salarioHora: redondear(nuevo.div(30).div(8)),
        },
      }),
      prisma.historialSalario.create({
        data: {
          empleadoId: emp.id,
          salarioAnterior: actual,
          salarioNuevo: nuevo,
          fechaCambio: new Date(),
          motivo: motivo ?? "Aumento colectivo",
          tipo: "COLECTIVO",
        },
      }),
    ];
  });

  await prisma.$transaction(updates);

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "UPDATE", tabla: "Empleado", registroId: "aumento-colectivo",
    usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { tipo, porcentaje, montoFijo, sucursalId: sucursalId ?? null, departamentoId: departamentoId ?? null, empleados: empleados.length },
    ip, userAgent,
  });

  return NextResponse.json({ actualizados: empleados.length });
}
