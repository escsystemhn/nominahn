import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { listarCatalogo } from "@/lib/payroll/plan-cuentas";
import CatalogoContableClient from "@/components/payroll/CatalogoContableClient";

export const metadata = { title: "Plan de cuentas" };

export default async function PlanCuentasPage() {
  const usuario = await requerirPermisoPagina(["planillas.plan_cuentas", "planillas.contabilidad"]);
  const [cuentas, sap] = await Promise.all([
    listarCatalogo(prisma),
    prisma.integracionSap.findUnique({ where: { id: "default" }, select: { catalogoOrigen: true, catalogoImportadoAt: true, catalogoCuentas: true } }),
  ]);
  // Con el catálogo importado de SAP, SAP manda: aquí sólo se consulta.
  const origenSap = sap?.catalogoOrigen === "SAP" ? { importadoAt: sap.catalogoImportadoAt?.toISOString() ?? null, cuentas: sap.catalogoCuentas } : null;

  return <CatalogoContableClient cuentas={cuentas} puedeEditar={puede(usuario, "planillas.plan_cuentas")} origenSap={origenSap} />;
}
