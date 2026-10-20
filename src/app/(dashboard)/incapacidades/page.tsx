import { prisma } from "@/lib/prisma";
import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import { nombreCompleto } from "@/lib/utils";
import IncapacidadesClient from "@/components/attendance/IncapacidadesClient";

export const metadata = { title: "Incapacidades" };

export default async function IncapacidadesPage() {
  const usuario = await requerirPermisoPagina("asistencia.incapacidades");
  const empleados = await prisma.empleado.findMany({
    where: { estado: { not: "INACTIVO" } },
    select: { id: true, codigo: true, primerNombre: true, segundoNombre: true, primerApellido: true, segundoApellido: true, genero: true },
    orderBy: [{ primerApellido: "asc" }, { primerNombre: "asc" }],
  });
  return (
    <IncapacidadesClient
      empleados={empleados.map((e) => ({ id: e.id, codigo: e.codigo, nombre: nombreCompleto(e), femenino: /^f/i.test(e.genero ?? "") }))}
      puedeReglas={puede(usuario, "configuracion.parametros")}
    />
  );
}
