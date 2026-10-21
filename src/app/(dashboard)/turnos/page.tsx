import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import TurnosClient from "@/components/attendance/TurnosClient";
import { etiquetaDepartamento } from "@/lib/organizacion/estructura";
import { divisionesHabilitadas } from "@/lib/organizacion/estructura-bd";

export const metadata = { title: "Horarios y turnos" };

export default async function TurnosPage() {
  const usuario = await requerirPermisoPagina(["asistencia.turnos", "asistencia.ver"]);
  const conDivisiones = await divisionesHabilitadas(prisma);
  const [departamentos, sucursales] = await Promise.all([
    prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true, sucursal: { select: { nombre: true } }, division: { select: { nombre: true } } }, orderBy: { nombre: "asc" } }),
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
  ]);
  return (
    <TurnosClient
      puedeEditar={puede(usuario, "asistencia.turnos")}
      departamentos={departamentos.map((d) => ({ id: d.id, nombre: etiquetaDepartamento({ ...d, division: conDivisiones ? d.division : null }) }))}
      sucursales={sucursales}
    />
  );
}
