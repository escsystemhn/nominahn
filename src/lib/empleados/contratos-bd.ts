/**
 * Historial de contratos contra la base de datos. Reciben la transacción de quien
 * llama para que el contrato y el empleado cambien juntos o no cambien.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Cierra el contrato vigente al dar de baja al empleado. */
export async function cerrarContratoVigente(db: Db, empleadoId: string, fecha: Date): Promise<void> {
  const vigentes = await db.contrato.findMany({ where: { empleadoId, activo: true }, select: { id: true, fechaFin: true } });
  for (const c of vigentes) {
    await db.contrato.update({
      where: { id: c.id },
      data: { activo: false, fechaFin: c.fechaFin && c.fechaFin < fecha ? c.fechaFin : fecha },
    });
  }
}

/** Al anular una liquidación: vuelve a abrir el contrato que ella cerró. */
export async function reabrirContrato(db: Db, empleadoId: string, fechaSalida: Date): Promise<void> {
  const ultimo = await db.contrato.findFirst({
    where: { empleadoId, activo: false, fechaFin: fechaSalida },
    orderBy: { fechaInicio: "desc" },
    select: { id: true },
  });
  if (ultimo) await db.contrato.update({ where: { id: ultimo.id }, data: { activo: true, fechaFin: null } });
}

/** Primer contrato de un empleado nuevo, con los datos de su alta. */
export async function crearContratoInicial(db: Db, empleadoId: string): Promise<void> {
  const e = await db.empleado.findUnique({
    where: { id: empleadoId },
    select: { tipoContrato: true, fechaIngreso: true, salarioBase: true, puesto: { select: { nombre: true } } },
  });
  if (!e) return;
  await db.contrato.create({
    data: {
      empleadoId,
      tipoContrato: e.tipoContrato,
      fechaInicio: e.fechaIngreso,
      salario: e.salarioBase,
      cargo: e.puesto?.nombre ?? "Sin puesto asignado",
    },
  });
}
