import { requerirSesionPagina, puede } from "@/lib/auth/guard";
import PoliticasClient from "@/components/employees/PoliticasClient";

export default async function PoliticasPage() {
  // Las políticas internas las lee toda la plantilla; publicarlas, no.
  const usuario = await requerirSesionPagina();

  return <PoliticasClient puedeGestionar={puede(usuario, "comunicacion.politicas")} />;
}
