import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { conAlcance, filtroSucursales } from "@/lib/auth/alcance";
import { nombreCompleto } from "@/lib/utils";
import PrestacionesClient from "@/components/payroll/PrestacionesClient";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";

export const metadata = { title: "Prestaciones" };

export default async function PrestacionesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const usuario = await requerirPermisoPagina("prestaciones.ver");
  const { tab } = await searchParams;

  const [empleados, sucursales, jerarquia] = await Promise.all([
    prisma.empleado.findMany({
      where: conAlcance({ estado: { in: ["ACTIVO", "VACACIONES", "PERMISO", "SUSPENDIDO"] } }, usuario),
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        fechaIngreso: true, salarioBase: true,
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    }),
    prisma.sucursal.findMany({ where: { AND: [{ activa: true }, filtroSucursales(usuario)] }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    jerarquiaNominaHabilitada(prisma),
  ]);

  return (
    <PrestacionesClient
      tabInicial={tab === "decimos" ? "decimos" : "liquidaciones"}
      permisos={[...(usuario.permisos ?? [])]}
      empleados={empleados.map((e) => ({
        id: e.id,
        codigo: e.codigo,
        nombre: nombreCompleto(e),
        fechaIngreso: e.fechaIngreso.toISOString().slice(0, 10),
        salarioBase: Number(e.salarioBase),
      }))}
      sucursales={sucursales}
      niveles={etiquetasNiveles(jerarquia)}
    />
  );
}
