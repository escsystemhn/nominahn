import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina } from "@/lib/auth/guard";
import { nombreCompleto } from "@/lib/utils";
import PrestacionesClient from "@/components/payroll/PrestacionesClient";

export const metadata = { title: "Prestaciones" };

export default async function PrestacionesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const usuario = await requerirPermisoPagina("prestaciones.ver");
  const { tab } = await searchParams;

  const [empleados, sucursales] = await Promise.all([
    prisma.empleado.findMany({
      where: { estado: { in: ["ACTIVO", "VACACIONES", "PERMISO", "SUSPENDIDO"] } },
      select: {
        id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true,
        fechaIngreso: true, salarioBase: true,
      },
      orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
    }),
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
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
    />
  );
}
