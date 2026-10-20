/** Préstamos en autoservicio: lo que necesita la base. */

import type { PrismaClient, Prisma } from "@prisma/client";
import { limiteDescuento, type LimiteDescuento, type TipoPlanilla } from "./prestamos";

type Db = PrismaClient | Prisma.TransactionClient;

/** Límite de descuento vigente de un empleado; `null` si falta el salario mínimo. */
export async function limiteDeEmpleado(db: Db, empleadoId: string): Promise<{ limite: LimiteDescuento | null; tipoPlanilla: TipoPlanilla; salarioMensual: number }> {
  const [emp, salMin, vigentes] = await Promise.all([
    db.empleado.findUnique({ where: { id: empleadoId }, select: { salarioBase: true, tipoPlanilla: true } }),
    db.salarioMinimo.findFirst({ where: { activo: true }, orderBy: { anio: "desc" }, select: { monto: true } }),
    db.deduccionEmpleado.findMany({
      where: { empleadoId, activo: true, tipoDeduccion: { tipo: { in: ["PRESTAMO", "ADELANTO"] } } },
      select: { monto: true },
    }),
  ]);
  if (!emp) throw new Error("Empleado no encontrado");
  const tipoPlanilla = emp.tipoPlanilla as TipoPlanilla;
  const salarioMensual = Number(emp.salarioBase);
  if (!salMin) return { limite: null, tipoPlanilla, salarioMensual };
  return {
    tipoPlanilla,
    salarioMensual,
    limite: limiteDescuento({
      salarioMensual,
      salarioMinimo: Number(salMin.monto),
      tipoPlanilla,
      cuotasVigentesPeriodo: vigentes.reduce((s, d) => s + Number(d.monto), 0),
    }),
  };
}

/** Tipo de deducción configurado para préstamos o anticipos (el primero activo). */
export async function tipoDeduccionPara(db: Db, tipo: "PRESTAMO" | "ADELANTO") {
  return db.tipoDeduccionConfig.findFirst({ where: { tipo, activo: true }, orderBy: { createdAt: "asc" } });
}
