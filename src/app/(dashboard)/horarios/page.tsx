import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import HorariosClient from "@/components/horarios/HorariosClient";

export const metadata = { title: "Horarios rotativos" };

export default async function HorariosPage() {
  const usuario = await requerirPermisoPagina(["asistencia.turnos", "asistencia.ver"]);
  const sucursales = await prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  return <HorariosClient puedeEditar={puede(usuario, "asistencia.turnos")} sucursales={sucursales} />;
}
