import { requerirPermisoPagina, puede } from "@/lib/auth/guard";
import CapacitacionesClient from "@/components/employees/CapacitacionesClient";

export default async function CapacitacionesPage() {
  const usuario = await requerirPermisoPagina("talento.capacitaciones");

  // El empleado a inscribir se busca en el servidor al escribir
  // (`/api/empleados/buscar?para=capacitaciones`): ya no se cargan todos aquí.
  return <CapacitacionesClient puedeGestionar={puede(usuario, "talento.capacitaciones_gestionar")} />;
}
