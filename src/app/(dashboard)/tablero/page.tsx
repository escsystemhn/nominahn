import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { hoyHN } from "@/lib/utils";
import TableroClient from "@/components/dashboard/TableroClient";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";

export const metadata = { title: "Tablero ejecutivo" };

export default async function TableroPage() {
  const usuario = await requerirPermisoPagina("reportes.ver");
  const [sucursales, departamentos, jerarquia] = await Promise.all([
    prisma.sucursal.findMany({ where: { AND: [filtroSucursales(usuario), { activa: true }] }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    prisma.departamento.findMany({
      where: { activo: true, empleados: { some: conAlcance({}, usuario) } },
      select: { id: true, nombre: true, sucursalId: true },
      orderBy: { nombre: "asc" },
    }),
    jerarquiaNominaHabilitada(prisma),
  ]);
  const hoy = hoyHN();
  return (
    <TableroClient
      sucursales={sucursales}
      departamentos={departamentos}
      niveles={etiquetasNiveles(jerarquia)}
      inicial={{ desde: new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10), hasta: hoy.toISOString().slice(0, 10) }}
    />
  );
}
