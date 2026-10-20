import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { cargarMapeoCompleto, listarCuentasAsignables } from "@/lib/payroll/plan-cuentas";
import ConfiguracionContableClient from "@/components/payroll/ConfiguracionContableClient";

export const metadata = { title: "Configuración contable" };

export default async function ConfiguracionContablePage() {
  const usuario = await requerirPermisoPagina(["planillas.plan_cuentas", "planillas.contabilidad"]);
  const [conceptos, cuentas] = await Promise.all([cargarMapeoCompleto(prisma), listarCuentasAsignables(prisma)]);

  return (
    <ConfiguracionContableClient
      conceptos={conceptos}
      cuentas={cuentas}
      puedeEditar={puede(usuario, "planillas.plan_cuentas")}
    />
  );
}
