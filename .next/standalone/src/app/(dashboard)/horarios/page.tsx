import { prisma } from "@/lib/prisma";
import { filtroSucursales } from "@/lib/auth/alcance";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { etiquetasNiveles } from "@/lib/organizacion/estructura";
import { jerarquiaNominaHabilitada } from "@/lib/organizacion/estructura-bd";
import HorariosClient from "@/components/horarios/HorariosClient";

export const metadata = { title: "Horarios rotativos" };

export default async function HorariosPage() {
  const usuario = await requerirPermisoPagina(["asistencia.turnos", "asistencia.ver"]);
  const [sucursales, jerarquia] = await Promise.all([
    prisma.sucursal.findMany({ where: { activa: true, ...filtroSucursales(usuario) }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    jerarquiaNominaHabilitada(prisma),
  ]);
  return <HorariosClient puedeEditar={puede(usuario, "asistencia.turnos")} sucursales={sucursales} niveles={etiquetasNiveles(jerarquia)} />;
}
