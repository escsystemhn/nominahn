import { redirect } from "next/navigation";

// El catálogo de competencias se movió a Gestión de Talento (/talento/competencias).
// Esta ruta se conserva para no romper enlaces guardados por los usuarios.
export default function CompetenciasRedirect() {
  redirect("/talento/competencias");
}
