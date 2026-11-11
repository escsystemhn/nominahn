/** Préstamos en autoservicio: lo que necesita la base. */

import type { PrismaClient, Prisma } from "@prisma/client";
import { cuotaDelPeriodo } from "./deducciones";
import { aNumero } from "./money";
import { hoyHN } from "@/lib/utils";
import { limiteDescuento, type LimiteDescuento, type TipoPlanilla } from "./prestamos";

type Db = PrismaClient | Prisma.TransactionClient;

/** Límite de descuento vigente de un empleado; `null` si falta el salario mínimo. */
export async function limiteDeEmpleado(db: Db, empleadoId: string): Promise<{ limite: LimiteDescuento | null; tipoPlanilla: TipoPlanilla; salarioMensual: number }> {
  const [emp, salMin, vigentes] = await Promise.all([
    db.empleado.findUnique({ where: { id: empleadoId }, select: { salarioBase: true, tipoPlanilla: true } }),
    db.salarioMinimo.findFirst({ where: { activo: true }, orderBy: { anio: "desc" }, select: { monto: true } }),
    db.deduccionEmpleado.findMany({
      // Sólo las vigentes: un monto del período de una quincena pasada ya no se descuenta.
      where: { empleadoId, activo: true, tipoDeduccion: { tipo: { in: ["PRESTAMO", "ADELANTO"] } }, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyHN() } }] },
      select: { monto: true, saldo: true, cuotasMeses: true, cuotasPagadas: true },
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
      // Lo que de verdad se descuenta: `monto` puede ser el total de la deuda.
      cuotasVigentesPeriodo: vigentes.reduce((s, d) => s + aNumero(cuotaDelPeriodo(d)), 0),
    }),
  };
}

/** Tipo de deducción configurado para préstamos o anticipos (el primero activo). */
export async function tipoDeduccionPara(db: Db, tipo: "PRESTAMO" | "ADELANTO") {
  return db.tipoDeduccionConfig.findFirst({ where: { tipo, activo: true }, orderBy: { createdAt: "asc" } });
}
