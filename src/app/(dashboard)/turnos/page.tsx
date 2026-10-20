import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import TurnosClient from "@/components/attendance/TurnosClient";

export const metadata = { title: "Horarios y turnos" };

export default async function TurnosPage() {
  const usuario = await requerirPermisoPagina(["asistencia.turnos", "asistencia.ver"]);
  const [departamentos, sucursales] = await Promise.all([
    prisma.departamento.findMany({ where: { activo: true }, select: { id: true, nombre: true, sucursal: { select: { nombre: true } } }, orderBy: { nombre: "asc" } }),
    prisma.sucursal.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
  ]);
  return (
    <TurnosClient
      puedeEditar={puede(usuario, "asistencia.turnos")}
      departamentos={departamentos.map((d) => ({ id: d.id, nombre: `${d.nombre} (${d.sucursal.nombre})` }))}
      sucursales={sucursales}
    />
  );
}
