import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import IncapacidadesClient from "@/components/attendance/IncapacidadesClient";

export const metadata = { title: "Incapacidades" };

export default async function IncapacidadesPage() {
  const usuario = await requerirPermisoPagina("asistencia.incapacidades");
  // Los empleados ya no se cargan aquí: los buscadores del registro y del filtro los piden a
  // /api/empleados/buscar?para=incapacidades, con el mismo filtro (no dados de baja, alcance).
  return <IncapacidadesClient puedeReglas={puede(usuario, "configuracion.parametros")} />;
}
