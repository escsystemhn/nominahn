import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { filtroSucursales } from "@/lib/auth/alcance";
import PrestacionesClient from "@/components/payroll/PrestacionesClient";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";

export const metadata = { title: "Prestaciones" };

export default async function PrestacionesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const usuario = await requerirPermisoPagina("prestaciones.ver");
  const { tab } = await searchParams;

  // Los empleados ya no se cargan aquí (2026-11-27): «Nueva liquidación» los busca en el servidor
  // (`/api/empleados/buscar?para=liquidaciones`), con los mismos estados, el mismo alcance y su
  // ingreso y salario base.
  const [sucursales, jerarquia] = await Promise.all([
    prisma.sucursal.findMany({ where: { AND: [{ activa: true }, filtroSucursales(usuario)] }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    jerarquiaNominaHabilitada(prisma),
  ]);

  return (
    <PrestacionesClient
      tabInicial={tab === "decimos" ? "decimos" : "liquidaciones"}
      permisos={[...(usuario.permisos ?? [])]}
      sucursales={sucursales}
      niveles={etiquetasNiveles(jerarquia)}
    />
  );
}
