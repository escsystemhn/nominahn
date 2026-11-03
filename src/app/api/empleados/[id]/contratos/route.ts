/**
 * Registrar un contrato nuevo: renovación o cambio de condiciones. Cierra el que
 * estaba vigente y actualiza el tipo y el salario de la ficha en una sola
 * transacción. Las reglas viven en `lib/empleados/contratos.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { TipoContrato } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requerirPermiso } from "@/lib/auth/guard";
import { alcanzaEmpleado } from "@/lib/auth/alcance";
import { audit, getClientInfo } from "@/lib/audit";
import { parsearBody, zFecha, zMontoPositivo } from "@/lib/http/validar";
import { money, redondear } from "@/lib/payroll/money";
import { hoyHN } from "@/lib/utils";
import { finDelAnterior, motivoContratoInvalido } from "@/lib/empleados/contratos";

const schema = z.object({
  tipoContrato: z.enum(TipoContrato),
  fechaInicio: zFecha,
  fechaFin: z.union([z.null(), zFecha]).optional(),
  salario: zMontoPositivo,
  cargo: z.string().trim().min(1).max(150),
  jornada: z.string().trim().max(150).nullable().optional(),
  horario: z.string().trim().max(150).nullable().optional(),
  observaciones: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requerirPermiso("empleados.editar");
  if (!g.ok) return g.response;

  const { id } = await params;
  const parsed = await parsearBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  const fechaFin = d.fechaFin ?? null;

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    select: {
      id: true, sucursalId: true, departamentoId: true, estado: true, fechaIngreso: true, salarioBase: true,
      contratos: { orderBy: { fechaInicio: "desc" }, select: { id: true, activo: true, fechaInicio: true, fechaFin: true } },
    },
  });
  // Fuera de su alcance responde igual que si no existiera (ver alcanzaEmpleado).
  if (!empleado || !alcanzaEmpleado(g.usuario, empleado)) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });
  if (empleado.estado === "INACTIVO") {
    return NextResponse.json({ error: "El empleado está dado de baja. Reincorpórelo en su ficha antes de registrarle un contrato." }, { status: 409 });
  }

  const ultimo = empleado.contratos[0];
  const motivo = motivoContratoInvalido({
    tipo: d.tipoContrato,
    fechaInicio: d.fechaInicio,
    fechaFin,
    fechaIngreso: empleado.fechaIngreso,
    hoy: hoyHN(),
    ultimoInicio: ultimo?.fechaInicio ?? null,
    ultimoFinCerrado: ultimo && !ultimo.activo ? ultimo.fechaFin : null,
  });
  if (motivo) return NextResponse.json({ error: motivo }, { status: 400 });

  const nuevoSalario = redondear(d.salario);
  const cambiaSalario = !nuevoSalario.equals(money(empleado.salarioBase));

  const contrato = await prisma.$transaction(async (tx) => {
    for (const anterior of empleado.contratos.filter((c) => c.activo)) {
      await tx.contrato.update({ where: { id: anterior.id }, data: { activo: false, fechaFin: finDelAnterior(anterior, d.fechaInicio) } });
    }
    const creado = await tx.contrato.create({
      data: {
        empleadoId: id,
        tipoContrato: d.tipoContrato,
        fechaInicio: d.fechaInicio,
        fechaFin,
        salario: nuevoSalario,
        cargo: d.cargo,
        jornada: d.jornada || null,
        horario: d.horario || null,
        observaciones: d.observaciones || null,
      },
    });
    await tx.empleado.update({
      where: { id },
      data: {
        tipoContrato: d.tipoContrato,
        ...(cambiaSalario
          ? { salarioBase: nuevoSalario, salarioDiario: redondear(nuevoSalario.div(30)), salarioHora: redondear(nuevoSalario.div(30).div(8)) }
          : {}),
      },
    });
    if (cambiaSalario) {
      await tx.historialSalario.create({
        data: {
          empleadoId: id,
          salarioAnterior: empleado.salarioBase,
          salarioNuevo: nuevoSalario,
          fechaCambio: d.fechaInicio,
          motivo: "Nuevo contrato",
          usuarioId: g.usuario.id,
          usuarioEmail: g.usuario.email ?? undefined,
        },
      });
    }
    return creado;
  });

  const { ip, userAgent } = getClientInfo(req);
  await audit({
    accion: "CREATE", tabla: "Contrato", registroId: contrato.id, usuarioId: g.usuario.id, usuarioEmail: g.usuario.email ?? undefined,
    valorNuevo: { empleadoId: id, tipoContrato: d.tipoContrato, fechaInicio: d.fechaInicio, fechaFin, salario: nuevoSalario, cargo: d.cargo, cambiaSalario },
    ip, userAgent,
  });
  return NextResponse.json(contrato, { status: 201 });
}
